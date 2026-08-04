import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4600'
const headers = { Authorization: 'Bearer e2e:e2e-host' }
const guestHeaders = { Authorization: 'Bearer e2e:e2e-guest' }

type DashboardSummary = {
  summary: {
    totalSessions: number
    totalXp: number
  }
}

type SoloRunResponse = {
  run: {
    id: string
    status: string
    question: { index: number; prompt: string } | null
    nextQuestion: { index: number; prompt: string } | null
    progress: { correctAnswers: number; totalQuestions: number }
    result: unknown
  }
  correction?: {
    correctAnswer: number
    isCorrect: boolean
    userAnswer: number | null
  } | null
}

function solve(prompt: string) {
  const [left, operator, right] = prompt.split(' ')
  const first = Number(left)
  const second = Number(right)

  if (operator === '+') return first + second
  if (operator === '-') return first - second
  if (operator === 'x') return first * second
  if (operator === '/') return first / second
  throw new Error(`Opérateur inattendu: ${operator}`)
}

test('le run Solo est corrigé et finalisé par le serveur sans double récompense', async ({ request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)

  const baselineResponse = await request.get(`${API_URL}/api/dashboard`, { headers })
  expect(baselineResponse.ok()).toBe(true)
  const baseline = await baselineResponse.json() as DashboardSummary

  const legacyResponse = await request.post(`${API_URL}/api/sessions`, {
    headers,
    data: { correctAnswers: 999, totalQuestions: 999 },
  })
  expect(legacyResponse.status()).toBe(410)
  expect(await legacyResponse.json()).toMatchObject({ code: 'legacy_session_submission_disabled' })

  const clientRunId = randomUUID()
  const startPayload = {
    clientRunId,
    mode: 'tempo',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    sprintDurationSeconds: 60,
    tempoQuestionCount: 10,
    tempoQuestionSeconds: 10,
  }
  const startResponse = await request.post(`${API_URL}/api/solo-runs`, { headers, data: startPayload })
  expect(startResponse.status()).toBe(201)
  const started = await startResponse.json() as SoloRunResponse
  expect(started.run.question).not.toBeNull()
  expect(started.run).not.toHaveProperty('questionSeed')
  expect(started.run.question).not.toHaveProperty('answer')
  expect(started.run.question).not.toHaveProperty('correctAnswer')
  expect(started.run.nextQuestion).toMatchObject({ index: 1 })
  expect(started.run.nextQuestion).not.toHaveProperty('answer')
  expect(started.run.nextQuestion).not.toHaveProperty('correctAnswer')

  const startRetry = await request.post(`${API_URL}/api/solo-runs`, { headers, data: startPayload })
  expect(startRetry.status()).toBe(201)
  const retriedStart = await startRetry.json() as SoloRunResponse
  expect(retriedStart.run.id).toBe(started.run.id)
  expect(retriedStart.run.question).toEqual(started.run.question)

  const conflictingStart = await request.post(`${API_URL}/api/solo-runs`, {
    headers,
    data: { ...startPayload, level: 'expert' },
  })
  expect(conflictingStart.status()).toBe(409)

  const outOfOrder = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers,
    data: { questionIndex: 1, userAnswer: 0 },
  })
  expect(outOfOrder.status()).toBe(409)
  expect(await outOfOrder.json()).toMatchObject({ code: 'solo_answer_out_of_sequence' })

  const firstQuestion = started.run.question
  if (!firstQuestion) throw new Error('Première question absente.')
  const expectedFirstAnswer = solve(firstQuestion.prompt)
  const wrongResponse = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers,
    data: {
      questionIndex: firstQuestion.index,
      userAnswer: expectedFirstAnswer + 1,
      correctAnswer: expectedFirstAnswer + 1,
      isCorrect: true,
      scorePoints: 999_999,
      bestStreak: 999,
    },
  })
  expect(wrongResponse.ok()).toBe(true)
  const afterWrong = await wrongResponse.json() as SoloRunResponse
  expect(afterWrong.correction).toMatchObject({ correctAnswer: expectedFirstAnswer, isCorrect: false })
  expect(afterWrong.run.progress).toMatchObject({ correctAnswers: 0, totalQuestions: 1 })

  const identicalReplay = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers,
    data: { questionIndex: firstQuestion.index, userAnswer: expectedFirstAnswer + 1 },
  })
  expect(identicalReplay.ok()).toBe(true)
  expect((await identicalReplay.json() as SoloRunResponse).run.progress.totalQuestions).toBe(1)

  const conflictingReplay = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers,
    data: { questionIndex: firstQuestion.index, userAnswer: expectedFirstAnswer },
  })
  expect(conflictingReplay.status()).toBe(409)
  expect(await conflictingReplay.json()).toMatchObject({ code: 'solo_answer_conflict' })

  const foreignRead = await request.get(`${API_URL}/api/solo-runs/${started.run.id}`, { headers: guestHeaders })
  expect(foreignRead.status()).toBe(404)

  const secondQuestion = afterWrong.run.question
  if (!secondQuestion) throw new Error('Deuxième question absente.')
  const secondAnswerPayload = {
    questionIndex: secondQuestion.index,
    userAnswer: solve(secondQuestion.prompt),
    isCorrect: false,
    responseTimeMs: 1,
  }
  const [correctResponse, concurrentRetry] = await Promise.all([
    request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
      headers,
      data: secondAnswerPayload,
    }),
    request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
      headers,
      data: secondAnswerPayload,
    }),
  ])
  expect(correctResponse.ok()).toBe(true)
  expect(concurrentRetry.ok()).toBe(true)
  const afterCorrect = await correctResponse.json() as SoloRunResponse
  const afterConcurrentRetry = await concurrentRetry.json() as SoloRunResponse
  expect(afterCorrect.correction?.isCorrect).toBe(true)
  expect(afterCorrect.run.progress).toMatchObject({ correctAnswers: 1, totalQuestions: 2 })
  expect(afterConcurrentRetry.run.progress).toMatchObject({ correctAnswers: 1, totalQuestions: 2 })

  const finishResponse = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/finish`, { headers })
  expect(finishResponse.ok()).toBe(true)
  const firstReceipt = await finishResponse.json() as SoloRunResponse
  expect(firstReceipt.run.status).toBe('completed')
  expect(firstReceipt.run.result).not.toBeNull()

  const afterFirstResponse = await request.get(`${API_URL}/api/dashboard`, { headers })
  expect(afterFirstResponse.ok()).toBe(true)
  const afterFirst = await afterFirstResponse.json() as DashboardSummary

  const finishRetry = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/finish`, { headers })
  expect(finishRetry.ok()).toBe(true)
  const retryReceipt = await finishRetry.json() as SoloRunResponse
  expect(retryReceipt.run.result).toEqual(firstReceipt.run.result)

  const afterRetryResponse = await request.get(`${API_URL}/api/dashboard`, { headers })
  expect(afterRetryResponse.ok()).toBe(true)
  const afterRetry = await afterRetryResponse.json() as DashboardSummary

  expect(afterFirst.summary.totalSessions).toBe(baseline.summary.totalSessions + 1)
  expect(afterRetry.summary.totalSessions).toBe(afterFirst.summary.totalSessions)
  expect(afterRetry.summary.totalXp).toBe(afterFirst.summary.totalXp)
})

test('le serveur transforme en absence de réponse une réponse Tempo arrivée hors délai', async ({ request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)

  const start = await request.post(`${API_URL}/api/solo-runs`, {
    headers,
    data: {
      clientRunId: randomUUID(),
      mode: 'tempo',
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      sprintDurationSeconds: 60,
      tempoQuestionCount: 10,
      tempoQuestionSeconds: 5,
    },
  })
  expect(start.ok()).toBe(true)
  const started = await start.json() as SoloRunResponse
  if (!started.run.question) throw new Error('Question Tempo absente.')

  await new Promise((resolve) => setTimeout(resolve, 5_200))

  const lateAnswer = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers,
    data: {
      questionIndex: started.run.question.index,
      userAnswer: solve(started.run.question.prompt),
      responseTimeMs: 1,
    },
  })
  expect(lateAnswer.ok()).toBe(true)
  const result = await lateAnswer.json() as SoloRunResponse
  expect(result.correction).toMatchObject({ isCorrect: false, userAnswer: null })
  expect(result.run.progress).toMatchObject({ correctAnswers: 0, totalQuestions: 1 })

  await request.post(`${API_URL}/api/solo-runs/${started.run.id}/finish`, { headers })
})

test('deux démarrages concurrents ne laissent qu’un seul run actif', async ({ request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)

  const commonPayload = {
    mode: 'sprint',
    game: 'mixte',
    level: 'intermediaire',
    practiceSkill: null,
    sprintDurationSeconds: 60,
    tempoQuestionCount: 10,
    tempoQuestionSeconds: 10,
  }
  const [firstStart, secondStart] = await Promise.all([
    request.post(`${API_URL}/api/solo-runs`, {
      headers,
      data: { ...commonPayload, clientRunId: randomUUID() },
    }),
    request.post(`${API_URL}/api/solo-runs`, {
      headers,
      data: { ...commonPayload, clientRunId: randomUUID() },
    }),
  ])
  expect(firstStart.status()).toBe(201)
  expect(secondStart.status()).toBe(201)
  const first = await firstStart.json() as SoloRunResponse
  const second = await secondStart.json() as SoloRunResponse

  const activeResponse = await request.get(`${API_URL}/api/solo-runs/active`, { headers })
  expect(activeResponse.ok()).toBe(true)
  const active = await activeResponse.json() as SoloRunResponse
  expect([first.run.id, second.run.id]).toContain(active.run.id)

  const [firstState, secondState] = await Promise.all([
    request.get(`${API_URL}/api/solo-runs/${first.run.id}`, { headers }),
    request.get(`${API_URL}/api/solo-runs/${second.run.id}`, { headers }),
  ])
  const finalStatuses = [
    (await firstState.json() as SoloRunResponse).run.status,
    (await secondState.json() as SoloRunResponse).run.status,
  ]
  expect(finalStatuses.filter((status) => status === 'active')).toHaveLength(1)
  expect(finalStatuses.filter((status) => status === 'abandoned')).toHaveLength(1)

  await request.post(`${API_URL}/api/solo-runs/${active.run.id}/finish`, { headers })
})
