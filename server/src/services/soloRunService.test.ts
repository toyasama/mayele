import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = {
  soloRun: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
  },
  player: {
    findUniqueOrThrow: vi.fn(async () => ({ totalXp: 100, timeZone: 'Europe/Paris' })),
  },
}

const saveSessionMock = vi.fn(async () => ({
  sessionId: 'session-1',
  scorePoints: 8,
  message: 'Session enregistrée.',
  xpEarned: 12,
  missionXpEarned: 0,
  completedMissions: [],
  playerProgress: { totalXp: 112 },
  earnedAchievements: [],
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./sessionService.js', () => ({ saveSession: saveSessionMock }))

const { finishSoloRun } = await import('./soloRunService.js')

function makeRun(options: {
  mode: 'sprint' | 'tempo'
  status?: 'active' | 'finalizing' | 'completed'
  currentQuestionIndex?: number
  questionCount?: number
  finishedAt?: Date | null
  result?: Awaited<ReturnType<typeof saveSessionMock>> | null
}) {
  const startedAt = new Date('2026-08-06T10:00:00.000Z')
  const questionCount = options.questionCount ?? (options.mode === 'tempo' ? 10 : 120)

  return {
    id: 'run-1',
    playerId: 'player-1',
    clientRunId: 'client-run-1',
    status: options.status ?? 'active',
    mode: options.mode,
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount,
    perQuestionTimeLimitSeconds: options.mode === 'tempo' ? 6 : null,
    questionSeed: 'seed-1',
    currentQuestionIndex: options.currentQuestionIndex ?? 1,
    questionStartedAt: startedAt,
    correctAnswers: 1,
    totalQuestions: 1,
    scorePoints: 8,
    currentStreak: 1,
    bestStreak: 1,
    totalResponseTimeMs: 500,
    startedAt,
    endsAt: new Date(startedAt.getTime() + 60_000),
    expiresAt: new Date(startedAt.getTime() + 360_000),
    finishedAt: options.finishedAt ?? null,
    sessionId: options.status === 'completed' ? 'session-1' : null,
    result: options.result ?? null,
    answers: [{
      id: 'answer-1',
      runId: 'run-1',
      questionIndex: 0,
      prompt: '1 + 1',
      correctAnswer: 2,
      userAnswer: 2,
      responseTimeMs: 500,
      isCorrect: true,
      game: 'addition',
      level: 'debutant',
      skill: 'addition',
      answeredAt: new Date(startedAt.getTime() + 500),
    }],
  }
}

function arrangeFinish(run: ReturnType<typeof makeRun>, finishedAt: Date) {
  const finalizing = { ...run, status: 'finalizing', finishedAt }
  const completed = {
    ...finalizing,
    status: 'completed',
    sessionId: 'session-1',
    result: {
      sessionId: 'session-1',
      scorePoints: 8,
      message: 'Session enregistrée.',
      xpEarned: 12,
      missionXpEarned: 0,
      completedMissions: [],
      playerProgress: { totalXp: 112 },
      earnedAchievements: [],
    },
  }
  prismaMock.soloRun.findFirst
    .mockResolvedValueOnce(run)
    .mockResolvedValueOnce(finalizing)
    .mockResolvedValueOnce(completed)
}

describe('finishSoloRun daily mission eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks an early Solo Sprint as ineligible for daily missions', async () => {
    const finishedAt = new Date('2026-08-06T10:00:10.000Z')
    vi.setSystemTime(finishedAt)
    arrangeFinish(makeRun({ mode: 'sprint' }), finishedAt)

    await finishSoloRun('player-1', 'run-1')

    expect(saveSessionMock).toHaveBeenCalledWith(
      'player-1',
      expect.any(Object),
      'Europe/Paris',
      expect.objectContaining({
        dailyMissionContext: expect.objectContaining({
          playContext: 'solo',
          challengeMode: 'sprint',
          completedWithoutAbandonment: false,
          configuredDurationSeconds: 60,
        }),
      }),
    )
  })

  it('marks a full-duration Solo Sprint as eligible for daily missions', async () => {
    const finishedAt = new Date('2026-08-06T10:01:00.000Z')
    vi.setSystemTime(finishedAt)
    arrangeFinish(makeRun({ mode: 'sprint' }), finishedAt)

    await finishSoloRun('player-1', 'run-1')

    expect(saveSessionMock).toHaveBeenCalledWith(
      'player-1',
      expect.any(Object),
      'Europe/Paris',
      expect.objectContaining({
        dailyMissionContext: expect.objectContaining({
          playContext: 'solo',
          challengeMode: 'sprint',
          completedWithoutAbandonment: true,
          configuredDurationSeconds: 60,
        }),
      }),
    )
  })

  it('marks a Solo Tempo as eligible only after every question was processed', async () => {
    const finishedAt = new Date('2026-08-06T10:00:40.000Z')
    vi.setSystemTime(finishedAt)
    arrangeFinish(makeRun({ mode: 'tempo', currentQuestionIndex: 10, questionCount: 10 }), finishedAt)

    await finishSoloRun('player-1', 'run-1')

    expect(saveSessionMock).toHaveBeenCalledWith(
      'player-1',
      expect.any(Object),
      'Europe/Paris',
      expect.objectContaining({
        dailyMissionContext: expect.objectContaining({
          playContext: 'solo',
          challengeMode: 'tempo',
          completedWithoutAbandonment: true,
          configuredQuestionCount: 10,
          configuredQuestionSeconds: 6,
        }),
      }),
    )
  })
})
