import { randomUUID } from 'node:crypto'
import type { Prisma, SoloRun } from '../generated/prisma/client.js'
import type { GameLevel, GameType, SkillTag } from '../domain/constants.js'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import { calculateSessionXp, getPlayerProgress } from '../domain/progression.js'
import { calculateAnswerScorePoints } from '../domain/scoring.js'
import { ApiError } from '../errors.js'
import { prisma } from '../lib/prisma.js'
import type { StartSoloRunInput, SubmitSoloAnswerInput } from '../schemas/soloRunSchema.js'
import { saveSession, type SessionSaveResult } from './sessionService.js'

const RUN_RECEIPT_PREFIX = 'solo-run:'
const RUN_EXPIRY_GRACE_MS = 5 * 60 * 1000
const MAX_SPRINT_QUESTIONS = 120
const MAX_STORED_RESPONSE_TIME_MS = 90_000

type SoloRunWithAnswers = Prisma.SoloRunGetPayload<{
  include: { answers: { orderBy: { questionIndex: 'asc' } } }
}>

export type SoloRunFinalResult = Omit<SessionSaveResult, 'sessionId'> & {
  sessionId: string | null
}

function conflict(message: string, code: string) {
  return new ApiError(409, message, code)
}

function notFound() {
  return new ApiError(404, 'Partie Solo introuvable.', 'solo_run_not_found')
}

function questionDeadline(run: SoloRun) {
  if (run.mode !== 'tempo' || !run.perQuestionTimeLimitSeconds) {
    return run.endsAt
  }

  const perQuestionDeadline = new Date(
    run.questionStartedAt.getTime() + run.perQuestionTimeLimitSeconds * 1000,
  )
  return perQuestionDeadline < run.endsAt ? perQuestionDeadline : run.endsAt
}

function buildQuestion(run: SoloRun) {
  if (run.currentQuestionIndex >= run.questionCount || run.status !== 'active') {
    return null
  }

  const question = generateMatchQuestion(
    run.questionSeed,
    run.currentQuestionIndex,
    run.game as GameType,
    run.level as GameLevel,
    run.practiceSkill as SkillTag | null,
  )

  return {
    index: run.currentQuestionIndex,
    prompt: question.prompt,
    operation: question.operation,
    skill: question.skill,
    issuedAt: run.questionStartedAt.toISOString(),
    deadlineAt: questionDeadline(run).toISOString(),
  }
}

function buildProgress(run: SoloRun) {
  return {
    correctAnswers: run.correctAnswers,
    totalQuestions: run.totalQuestions,
    scorePoints: run.scorePoints,
    xp: calculateSessionXp({
      level: run.level as GameLevel,
      correctAnswers: run.correctAnswers,
      totalQuestions: run.totalQuestions,
      bestStreak: run.bestStreak,
    }),
    currentStreak: run.currentStreak,
    bestStreak: run.bestStreak,
  }
}

function storedResult(run: SoloRun): SoloRunFinalResult | null {
  return run.result ? (run.result as unknown as SoloRunFinalResult) : null
}

function buildRunView(run: SoloRunWithAnswers, now = new Date()) {
  return {
    id: run.id,
    clientRunId: run.clientRunId,
    status: run.status,
    mode: run.mode as 'sprint' | 'tempo',
    game: run.game as GameType,
    level: run.level as GameLevel,
    practiceSkill: run.practiceSkill as SkillTag | null,
    durationSeconds: run.durationSeconds,
    questionCount: run.questionCount,
    perQuestionTimeLimitSeconds: run.perQuestionTimeLimitSeconds,
    currentQuestionIndex: run.currentQuestionIndex,
    startedAt: run.startedAt.toISOString(),
    endsAt: run.endsAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    question: buildQuestion(run),
    progress: buildProgress(run),
    answers: run.answers.map((answer) => ({
      questionIndex: answer.questionIndex,
      prompt: answer.prompt,
      correctAnswer: answer.correctAnswer,
      userAnswer: answer.userAnswer,
      responseTimeMs: answer.responseTimeMs,
      isCorrect: answer.isCorrect,
      game: answer.game as GameType,
      level: answer.level as GameLevel,
      skill: answer.skill as SkillTag,
    })),
    result: storedResult(run),
  }
}

function sameStartConfiguration(run: SoloRun, input: StartSoloRunInput) {
  const questionCount = input.mode === 'tempo' ? input.tempoQuestionCount : MAX_SPRINT_QUESTIONS
  const durationSeconds = input.mode === 'tempo'
    ? input.tempoQuestionCount * input.tempoQuestionSeconds
    : input.sprintDurationSeconds

  return run.mode === input.mode
    && run.game === input.game
    && run.level === input.level
    && run.practiceSkill === input.practiceSkill
    && run.questionCount === questionCount
    && run.durationSeconds === durationSeconds
    && run.perQuestionTimeLimitSeconds === (input.mode === 'tempo' ? input.tempoQuestionSeconds : null)
}

function prismaConflictTargets(error: unknown, candidates: string[]) {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') {
    return false
  }

  const meta = 'meta' in error && typeof error.meta === 'object' && error.meta !== null ? error.meta : null
  const target = meta && 'target' in meta ? meta.target : null
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')]
  return fields.some((field) => candidates.some((candidate) => field.includes(candidate)))
}

async function findRun(playerId: string, runId: string) {
  const run = await prisma.soloRun.findFirst({
    where: { id: runId, playerId },
    include: { answers: { orderBy: { questionIndex: 'asc' } } },
  })

  if (!run) throw notFound()
  return run
}

export async function startSoloRun(playerId: string, input: StartSoloRunInput) {
  const existing = await prisma.soloRun.findUnique({
    where: { playerId_clientRunId: { playerId, clientRunId: input.clientRunId } },
    include: { answers: { orderBy: { questionIndex: 'asc' } } },
  })

  if (existing) {
    if (!sameStartConfiguration(existing, input)) {
      throw conflict(
        'Cet identifiant de partie a déjà été utilisé avec une autre configuration.',
        'solo_run_configuration_conflict',
      )
    }
    return buildRunView(existing)
  }

  const now = new Date()
  const durationSeconds = input.mode === 'tempo'
    ? input.tempoQuestionCount * input.tempoQuestionSeconds
    : input.sprintDurationSeconds
  const questionCount = input.mode === 'tempo' ? input.tempoQuestionCount : MAX_SPRINT_QUESTIONS
  const endsAt = new Date(now.getTime() + durationSeconds * 1000)
  const expiresAt = new Date(endsAt.getTime() + RUN_EXPIRY_GRACE_MS)

  try {
    const run = await prisma.$transaction(async (tx) => {
      // Serialise les créations par joueur, y compris entre plusieurs instances Node.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${playerId}, 0))::text AS acquired`

      await tx.soloRun.updateMany({
        where: { playerId, status: 'active' },
        data: { status: 'abandoned', finishedAt: now },
      })

      return tx.soloRun.create({
        data: {
          playerId,
          clientRunId: input.clientRunId,
          mode: input.mode,
          game: input.game,
          level: input.level,
          practiceSkill: input.practiceSkill,
          durationSeconds,
          questionCount,
          perQuestionTimeLimitSeconds: input.mode === 'tempo' ? input.tempoQuestionSeconds : null,
          questionSeed: randomUUID(),
          questionStartedAt: now,
          startedAt: now,
          endsAt,
          expiresAt,
        },
        include: { answers: { orderBy: { questionIndex: 'asc' } } },
      })
    })

    return buildRunView(run, now)
  } catch (error) {
    if (prismaConflictTargets(error, ['clientRunId', 'client_run_id'])) {
      const replay = await prisma.soloRun.findUnique({
        where: { playerId_clientRunId: { playerId, clientRunId: input.clientRunId } },
        include: { answers: { orderBy: { questionIndex: 'asc' } } },
      })
      if (replay && sameStartConfiguration(replay, input)) return buildRunView(replay)
    }
    throw error
  }
}

function emptyRunResult(totalXp: number): SoloRunFinalResult {
  return {
    sessionId: null,
    scorePoints: 0,
    message: 'Partie terminée sans réponse.',
    xpEarned: 0,
    missionXpEarned: 0,
    completedMissions: [],
    playerProgress: getPlayerProgress(totalXp),
    earnedAchievements: [],
  }
}

export async function finishSoloRun(playerId: string, runId: string) {
  let run = await findRun(playerId, runId)

  if (run.status === 'completed' && run.result) return buildRunView(run)
  if (run.status === 'abandoned' || run.status === 'expired') {
    throw conflict('Cette partie Solo n’est plus active.', 'solo_run_closed')
  }

  const finishedAt = new Date()
  if (run.status === 'active') {
    const claimed = await prisma.soloRun.updateMany({
      where: { id: run.id, playerId, status: 'active' },
      data: { status: 'finalizing', finishedAt },
    })
    run = await findRun(playerId, runId)

    if (claimed.count !== 1) {
      if (run.status === 'completed' && run.result) return buildRunView(run)
      if (run.status === 'abandoned' || run.status === 'expired') {
        throw conflict('Cette partie Solo n’est plus active.', 'solo_run_closed')
      }
      if (run.status !== 'finalizing') {
        throw conflict('Cette partie Solo ne peut pas être finalisée.', 'solo_run_closed')
      }
    }
  }

  const player = await prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { totalXp: true, timeZone: true },
  })
  const result = run.answers.length === 0
    ? emptyRunResult(player.totalXp)
    : await saveSession(
        playerId,
        {
          game: run.game as GameType,
          level: run.level as GameLevel,
          practiceSkill: run.practiceSkill as SkillTag | null,
          totalQuestions: run.answers.length,
          durationSeconds: Math.min(
            run.durationSeconds,
            Math.max(1, Math.round(((run.finishedAt ?? finishedAt).getTime() - run.startedAt.getTime()) / 1000)),
          ),
          bestStreak: run.bestStreak,
          answers: run.answers.map((answer) => ({
            prompt: answer.prompt,
            correctAnswer: answer.correctAnswer,
            userAnswer: answer.userAnswer,
            responseTimeMs: answer.responseTimeMs,
            isCorrect: answer.isCorrect,
            game: answer.game as GameType,
            level: answer.level as GameLevel,
            skill: answer.skill as SkillTag,
          })),
        },
        player.timeZone,
        { submissionKey: `${RUN_RECEIPT_PREFIX}${run.id}` },
      )

  await prisma.soloRun.update({
    where: { id: run.id },
    data: {
      status: 'completed',
      finishedAt: run.finishedAt ?? finishedAt,
      sessionId: result.sessionId,
      result: result as Prisma.InputJsonValue,
    },
  })

  return buildRunView(await findRun(playerId, runId))
}

export async function getSoloRun(playerId: string, runId: string) {
  const run = await findRun(playerId, runId)

  if ((run.status === 'active' && Date.now() >= run.endsAt.getTime()) || run.status === 'finalizing') {
    return finishSoloRun(playerId, runId)
  }

  return buildRunView(run)
}

export async function getActiveSoloRun(playerId: string) {
  const run = await prisma.soloRun.findFirst({
    where: { playerId, status: { in: ['active', 'finalizing'] } },
    orderBy: { startedAt: 'desc' },
    include: { answers: { orderBy: { questionIndex: 'asc' } } },
  })

  if (!run) return null
  if ((run.status === 'active' && Date.now() >= run.endsAt.getTime()) || run.status === 'finalizing') {
    return finishSoloRun(playerId, run.id)
  }
  return buildRunView(run)
}

export async function submitSoloAnswer(playerId: string, runId: string, input: SubmitSoloAnswerInput) {
  const run = await findRun(playerId, runId)
  const existingAnswer = run.answers.find((answer) => answer.questionIndex === input.questionIndex)

  if (existingAnswer) {
    if (existingAnswer.userAnswer !== input.userAnswer) {
      throw conflict('Cette question a déjà reçu une autre réponse.', 'solo_answer_conflict')
    }

    // Prisma may load the parent run and its answers with separate queries. During a
    // concurrent retry, that can briefly combine the pre-update run counters with the
    // newly committed answer. Re-read after observing the answer so every successful
    // idempotent acknowledgement returns one canonical post-commit snapshot.
    const replay = await findRun(playerId, runId)
    const replayAnswer = replay.answers.find((answer) => answer.questionIndex === input.questionIndex)
    if (!replayAnswer || replayAnswer.userAnswer !== input.userAnswer) {
      throw conflict('Cette question a déjà reçu une autre réponse.', 'solo_answer_conflict')
    }
    const view = buildRunView(replay)
    return {
      run: view,
      correction: view.answers.find((answer) => answer.questionIndex === input.questionIndex) ?? null,
    }
  }

  if (run.status === 'completed') {
    throw conflict('Cette partie est déjà terminée.', 'solo_run_completed')
  }
  if (run.status !== 'active') {
    throw conflict('Cette partie Solo n’accepte plus de réponse.', 'solo_run_closed')
  }

  const now = new Date()
  if (now >= run.endsAt || run.currentQuestionIndex >= run.questionCount) {
    return { run: await finishSoloRun(playerId, runId), correction: null }
  }
  if (input.questionIndex !== run.currentQuestionIndex) {
    throw conflict('Les réponses doivent être envoyées dans l’ordre.', 'solo_answer_out_of_sequence')
  }

  const question = generateMatchQuestion(
    run.questionSeed,
    input.questionIndex,
    run.game as GameType,
    run.level as GameLevel,
    run.practiceSkill as SkillTag | null,
  )
  const deadline = questionDeadline(run)
  const acceptedUserAnswer = run.mode === 'tempo' && now > deadline ? null : input.userAnswer
  const responseTimeMs = Math.min(
    MAX_STORED_RESPONSE_TIME_MS,
    Math.max(0, now.getTime() - run.questionStartedAt.getTime()),
  )
  const isCorrect = acceptedUserAnswer !== null && acceptedUserAnswer === question.answer
  const currentStreak = isCorrect ? run.currentStreak + 1 : 0
  const scorePoints = calculateAnswerScorePoints(run.level as GameLevel, responseTimeMs, isCorrect)

  const answerId = randomUUID()
  const updatedCount = await prisma.$executeRaw`
    WITH eligible_run AS MATERIALIZED (
      SELECT id
      FROM solo_runs
      WHERE id = ${run.id}
        AND player_id = ${playerId}
        AND status = 'active'
        AND current_question_index = ${input.questionIndex}
      FOR UPDATE
    ),
    inserted_answer AS (
      INSERT INTO solo_run_answers (
        id,
        run_id,
        question_index,
        prompt,
        correct_answer,
        user_answer,
        response_time_ms,
        is_correct,
        game,
        level,
        skill,
        answered_at
      )
      SELECT
        ${answerId},
        ${run.id},
        ${input.questionIndex},
        ${question.prompt},
        ${question.answer},
        ${acceptedUserAnswer},
        ${responseTimeMs},
        ${isCorrect},
        ${run.game},
        ${run.level},
        ${question.skill},
        ${now}
      FROM eligible_run
      ON CONFLICT (run_id, question_index) DO NOTHING
      RETURNING run_id
    )
    UPDATE solo_runs
    SET
      current_question_index = current_question_index + 1,
      question_started_at = ${now},
      correct_answers = correct_answers + ${isCorrect ? 1 : 0},
      total_questions = total_questions + 1,
      score_points = score_points + ${scorePoints},
      current_streak = ${currentStreak},
      best_streak = GREATEST(best_streak, ${currentStreak}),
      total_response_time_ms = total_response_time_ms + ${responseTimeMs}
    WHERE id IN (SELECT run_id FROM inserted_answer)
      AND player_id = ${playerId}
      AND status = 'active'
      AND current_question_index = ${input.questionIndex}
  `

  if (updatedCount !== 1) {
    const replay = await findRun(playerId, runId)
    const answer = replay.answers.find((item) => item.questionIndex === input.questionIndex)
    if (!answer || answer.userAnswer !== input.userAnswer) {
      throw conflict('Cette question a déjà reçu une autre réponse.', 'solo_answer_conflict')
    }
    return { run: buildRunView(replay), correction: buildRunView(replay).answers[input.questionIndex] }
  }

  const persistedAnswer: SoloRunWithAnswers['answers'][number] = {
    id: answerId,
    runId: run.id,
    questionIndex: input.questionIndex,
    prompt: question.prompt,
    correctAnswer: question.answer,
    userAnswer: acceptedUserAnswer,
    responseTimeMs,
    isCorrect,
    game: run.game,
    level: run.level,
    skill: question.skill,
    answeredAt: now,
  }
  const updated: SoloRunWithAnswers = {
    ...run,
    currentQuestionIndex: run.currentQuestionIndex + 1,
    questionStartedAt: now,
    correctAnswers: run.correctAnswers + (isCorrect ? 1 : 0),
    totalQuestions: run.totalQuestions + 1,
    scorePoints: run.scorePoints + scorePoints,
    currentStreak,
    bestStreak: Math.max(run.bestStreak, currentStreak),
    totalResponseTimeMs: run.totalResponseTimeMs + responseTimeMs,
    answers: [...run.answers, persistedAnswer],
  }

  if (updated.currentQuestionIndex >= updated.questionCount || Date.now() >= updated.endsAt.getTime()) {
    const completed = await finishSoloRun(playerId, runId)
    return { run: completed, correction: completed.answers[input.questionIndex] ?? null }
  }

  const view = buildRunView(updated)
  return { run: view, correction: view.answers[input.questionIndex] }
}
