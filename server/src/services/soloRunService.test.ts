import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionResult = {
  sessionId: 'session-1',
  scorePoints: 8,
  message: 'Session enregistrée.',
  xpEarned: 12,
  missionXpEarned: 0,
  completedMissions: [],
  playerProgress: { totalXp: 112 },
  earnedAchievements: [],
}

const txMock = {
  $queryRaw: vi.fn(async () => [{ id: 'run-1' }]),
  soloRun: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  player: {
    findUniqueOrThrow: vi.fn(async () => ({
      totalXp: 100,
      timeZone: 'Europe/Paris',
    })),
  },
}

const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
  soloRun: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
  },
}

const settleSessionMock = vi.fn(async () => ({
  result: sessionResult,
  created: true,
}))
const invalidateDashboardCacheMock = vi.fn()

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./sessionService.js', () => ({ settleSession: settleSessionMock }))
vi.mock('./dashboardService.js', () => ({
  invalidateDashboardCache: invalidateDashboardCacheMock,
}))

const { finishSoloRun } = await import('./soloRunService.js')

function makeRun(options: {
  mode: 'sprint' | 'tempo'
  status?: 'active' | 'finalizing' | 'completed'
  currentQuestionIndex?: number
  questionCount?: number
  finishedAt?: Date | null
  result?: typeof sessionResult | null
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
    answers: [
      {
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
      },
    ],
  }
}

function arrangeFinish(run: ReturnType<typeof makeRun>, finishedAt: Date) {
  const finalizing = { ...run, status: 'finalizing', finishedAt }
  const completed = {
    ...finalizing,
    status: 'completed',
    sessionId: 'session-1',
    result: sessionResult,
  }
  txMock.soloRun.findUnique.mockResolvedValueOnce(run)
  txMock.soloRun.update.mockResolvedValueOnce(finalizing).mockResolvedValueOnce(completed)
}

describe('finishSoloRun daily mission eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) =>
      callback(txMock),
    )
    txMock.$queryRaw.mockResolvedValue([{ id: 'run-1' }])
    txMock.player.findUniqueOrThrow.mockResolvedValue({
      totalXp: 100,
      timeZone: 'Europe/Paris',
    })
    settleSessionMock.mockResolvedValue({
      result: sessionResult,
      created: true,
    })
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

    expect(settleSessionMock).toHaveBeenCalledWith(
      txMock,
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

    expect(settleSessionMock).toHaveBeenCalledWith(
      txMock,
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

    expect(settleSessionMock).toHaveBeenCalledWith(
      txMock,
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

  it('settles concurrent finalizations once and returns the canonical completed run to both callers', async () => {
    const finishedAt = new Date('2026-08-06T10:01:00.000Z')
    vi.setSystemTime(finishedAt)
    let persistedRun = makeRun({ mode: 'sprint' })
    let transactionTail = Promise.resolve()

    prismaMock.$transaction.mockImplementation((callback: (tx: typeof txMock) => Promise<unknown>) => {
      const current = transactionTail.then(() => callback(txMock))
      transactionTail = current.then(
        () => undefined,
        () => undefined,
      )
      return current
    })
    txMock.soloRun.findUnique.mockImplementation(async () => persistedRun)
    txMock.soloRun.update.mockImplementation(
      async (input: {
        data: {
          status: 'active' | 'finalizing' | 'completed'
          finishedAt: Date
          sessionId?: string | null
          result?: unknown
        }
      }) => {
        persistedRun = {
          ...persistedRun,
          ...input.data,
          result: input.data.result === undefined ? persistedRun.result : (input.data.result as typeof sessionResult),
          sessionId: input.data.sessionId === undefined ? persistedRun.sessionId : input.data.sessionId,
        }
        return persistedRun
      },
    )

    const [first, second] = await Promise.all([finishSoloRun('player-1', 'run-1'), finishSoloRun('player-1', 'run-1')])

    expect(first.status).toBe('completed')
    expect(second).toEqual(first)
    expect(first.result).toEqual(sessionResult)
    expect(settleSessionMock).toHaveBeenCalledTimes(1)
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(2)
    expect(txMock.soloRun.update).toHaveBeenCalledTimes(2)
    expect(invalidateDashboardCacheMock).toHaveBeenCalledTimes(1)
  })
})
