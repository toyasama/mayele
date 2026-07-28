import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDailyScopeKey } from '../domain/daily.js'
import { buildMissionStates } from '../domain/rewards.js'
import type { SessionPayload } from '../schemas/sessionSchema.js'

type MissionCompletionRow = {
  missionKey: string
  scopeKey: string
  completedAt: Date
  xpAwarded: number
}

type MissionCompletionCreateInput = {
  data: Array<{
    playerId: string
    missionKey: string
    scopeKey: string
    xpAwarded: number
  }>
  skipDuplicates?: boolean
}

type GameSessionCreateInput = {
  data: Record<string, unknown>
}

type AchievementCreateInput = {
  data: Array<{
    playerId: string
    achievementKey: string
    label: string
    description: string
  }>
  skipDuplicates?: boolean
}

const tx = {
  gameSession: {
    create: vi.fn(async (_input: GameSessionCreateInput) => ({ id: 'session-1' })),
    count: vi.fn(async () => 4),
    update: vi.fn(async () => ({ id: 'session-1' })),
  },
  answer: {
    createMany: vi.fn(async () => ({ count: 30 })),
  },
  dailyStat: {
    upsert: vi.fn(async () => ({ sessionsCount: 3, correctAnswers: 30, totalQuestions: 30 })),
    update: vi.fn(async () => ({ xp: 940 })),
  },
  missionCompletion: {
    findMany: vi.fn(async (): Promise<MissionCompletionRow[]> => []),
    createMany: vi.fn(async (_input: MissionCompletionCreateInput) => ({ count: 1 })),
  },
  achievement: {
    findMany: vi.fn(async () => [
      { achievementKey: 'accuracy_80' },
      { achievementKey: 'perfect_sprint' },
    ]),
    createMany: vi.fn(async (_input: AchievementCreateInput) => ({ count: 1 })),
  },
  xpLedgerEntry: {
    createManyAndReturn: vi.fn(async (input: { data: Array<{ amount: number }> }) => (
      input.data.map((entry) => ({ amount: entry.amount }))
    )),
  },
  player: {
    findUniqueOrThrow: vi.fn(async () => ({ totalXp: 940 })),
    update: vi.fn(async () => ({ totalXp: 940 })),
  },
}

const gameSessionFindUnique = vi.fn()
const transactionMock = vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    gameSession: { findUnique: gameSessionFindUnique },
    $transaction: transactionMock,
  },
}))

const { saveSession } = await import('./sessionService.js')

function createdSessionData() {
  const call = tx.gameSession.create.mock.calls[0]
  if (!call) throw new Error('Expected a session creation call.')
  return call[0].data
}

const perfectSessionPayload: SessionPayload = {
  game: 'mixte',
  level: 'expert',
  practiceSkill: null,
  totalQuestions: 30,
  durationSeconds: 60,
  bestStreak: 20,
  answers: Array.from({ length: 30 }, (_, index) => ({
    prompt: `${index + 1} + 1`,
    correctAnswer: index + 2,
    userAnswer: index + 2,
    responseTimeMs: 900,
    game: 'addition',
    level: 'expert',
    skill: 'addition',
  })),
}

describe('saveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gameSessionFindUnique.mockResolvedValue(null)
    transactionMock.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calculates XP server-side and does not abort when earned achievements already exist', async () => {
    const day = getDailyScopeKey(undefined, 'Europe/Paris')
    const expectedMissions = buildMissionStates(
      { todaySessions: 3, todayCorrectAnswers: 30, todayQuestionsAnswered: 30 },
      [],
      day,
      'player-1',
    )
    const expectedMissionXp = expectedMissions.reduce((sum, mission) => sum + mission.rewardXp, 0)
    const result = await saveSession('player-1', perfectSessionPayload)

    expect(tx.gameSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        playerId: 'player-1',
        xp: 600,
        score: 100,
        scorePoints: 480,
        correctAnswers: 30,
        totalQuestions: 30,
      }),
    })
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'player-1' },
      data: { totalXp: { increment: 600 + expectedMissionXp } },
      select: { totalXp: true },
    })
    expect(tx.xpLedgerEntry.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          playerId: 'player-1',
          sourceType: 'session',
          sourceId: 'session-1',
          amount: 600,
        }),
        ...expectedMissions.map((mission) => expect.objectContaining({
          playerId: 'player-1',
          sourceType: 'mission',
          sourceId: `${day}:${mission.key}`,
          amount: mission.rewardXp,
        })),
      ],
      skipDuplicates: true,
      select: { amount: true },
    })
    expect(tx.missionCompletion.createMany).toHaveBeenCalledTimes(3)
    expect(tx.missionCompletion.createMany.mock.calls.map(([call]) => call)).toEqual(
      expectedMissions.map((mission) => ({
        data: [{
          playerId: 'player-1',
          missionKey: mission.key,
          scopeKey: day,
          xpAwarded: mission.rewardXp,
        }],
        skipDuplicates: true,
      })),
    )
    expect(tx.dailyStat.update).toHaveBeenCalledWith({
      where: { playerId_day: { playerId: 'player-1', day } },
      data: { xp: { increment: expectedMissionXp } },
    })
    expect(tx.achievement.findMany).toHaveBeenCalledWith({
      where: {
        playerId: 'player-1',
        achievementKey: {
          in: ['accuracy_80', 'perfect_sprint', 'streak_5', 'xp_250', 'daily_goal'],
        },
      },
      select: { achievementKey: true },
    })
    expect(tx.achievement.createMany).toHaveBeenCalledTimes(3)
    expect(tx.achievement.createMany.mock.calls.map(([call]) => call)).toEqual([
      {
        data: [expect.objectContaining({ achievementKey: 'streak_5' })],
        skipDuplicates: true,
      },
      {
        data: [expect.objectContaining({ achievementKey: 'xp_250' })],
        skipDuplicates: true,
      },
      {
        data: [expect.objectContaining({ achievementKey: 'daily_goal' })],
        skipDuplicates: true,
      },
    ])
    expect(result).toMatchObject({
      scorePoints: 480,
      xpEarned: 600,
      missionXpEarned: expectedMissionXp,
      completedMissions: expectedMissions.map((mission) => ({
        key: mission.key,
        title: mission.title,
        rewardXp: mission.rewardXp,
      })),
      earnedAchievements: [
        { key: 'streak_5', label: 'Série x5' },
        { key: 'xp_250', label: '250 XP' },
        { key: 'daily_goal', label: 'Objectif du jour' },
      ],
    })
  })

  it('does not award the same daily missions twice', async () => {
    const day = getDailyScopeKey(undefined, 'Europe/Paris')
    const selectedMissions = buildMissionStates(
      { todaySessions: 3, todayCorrectAnswers: 30, todayQuestionsAnswered: 30 },
      [],
      day,
      'player-1',
    )
    tx.missionCompletion.findMany.mockResolvedValueOnce(selectedMissions.map((mission) => ({
      missionKey: mission.key,
      scopeKey: day,
      completedAt: new Date('2026-07-01T11:00:00.000Z'),
      xpAwarded: mission.rewardXp,
    })))

    const result = await saveSession('player-1', perfectSessionPayload)

    expect(tx.missionCompletion.createMany).not.toHaveBeenCalled()
    expect(tx.dailyStat.update).not.toHaveBeenCalled()
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'player-1' },
      data: { totalXp: { increment: 600 } },
      select: { totalXp: true },
    })
    expect(result).toMatchObject({ missionXpEarned: 0, completedMissions: [] })
  })

  it('returns the canonical stored result on retry without crediting rewards again', async () => {
    const payload = { ...perfectSessionPayload, submissionId: '5d0207bc-328c-4e5f-98dd-f8ac1ce7907a' }
    const firstResult = await saveSession('player-1', payload)
    const createdData = createdSessionData()

    gameSessionFindUnique.mockResolvedValueOnce({
      submissionPayloadHash: createdData.submissionPayloadHash,
      submissionResult: firstResult,
    })

    const replay = await saveSession('player-1', payload)

    expect(replay).toEqual(firstResult)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(tx.player.update).toHaveBeenCalledTimes(1)
    expect(tx.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { submissionResult: firstResult },
    })
  })

  it('returns the committed result when concurrent submissions race on the same key', async () => {
    const payload = { ...perfectSessionPayload, submissionId: '00902ca5-f8dd-4a29-b46c-c0c0f111d8bc' }
    const committedResult = {
      sessionId: 'session-from-winner',
      scorePoints: 480,
      message: 'Session enregistree.',
      xpEarned: 600,
      missionXpEarned: 0,
      completedMissions: [],
      playerProgress: { totalXp: 600 },
      earnedAchievements: [],
    }
    const first = await saveSession('player-1', payload)
    const createdData = createdSessionData()
    vi.clearAllMocks()
    gameSessionFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        submissionPayloadHash: createdData.submissionPayloadHash,
        submissionResult: committedResult,
      })
    transactionMock.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['player_id', 'submission_key'] },
    })

    const raceLoser = await saveSession('player-1', payload)

    expect(first.sessionId).toBe('session-1')
    expect(raceLoser).toEqual(committedResult)
    expect(tx.player.update).not.toHaveBeenCalled()
  })

  it('does not mask an unrelated unique constraint failure as an idempotent retry', async () => {
    const payload = {
      ...perfectSessionPayload,
      submissionId: 'c041cb4a-4755-4fe0-be72-cc3544e01a55',
    }
    const unrelatedConflict = {
      code: 'P2002',
      meta: { target: ['player_id', 'achievement_key'] },
    }
    transactionMock.mockRejectedValueOnce(unrelatedConflict)

    await expect(saveSession('player-1', payload)).rejects.toBe(unrelatedConflict)
    expect(gameSessionFindUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of a submission key with a different payload', async () => {
    const submissionId = '90c9ff92-9df6-4c3e-a782-e977e15aa2e4'
    const payload = { ...perfectSessionPayload, submissionId }
    await saveSession('player-1', payload)
    const createdData = createdSessionData()
    gameSessionFindUnique.mockResolvedValueOnce({
      submissionPayloadHash: createdData.submissionPayloadHash,
      submissionResult: { sessionId: 'session-1' },
    })

    await expect(saveSession('player-1', { ...payload, durationSeconds: 59 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'session_submission_conflict',
    })
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })
})
