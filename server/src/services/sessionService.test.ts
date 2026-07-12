import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionPayload } from '../schemas/sessionSchema.js'

const tx = {
  gameSession: {
    create: vi.fn(async () => ({ id: 'session-1' })),
    count: vi.fn(async () => 4),
  },
  answer: {
    createMany: vi.fn(async () => ({ count: 30 })),
  },
  dailyStat: {
    upsert: vi.fn(async () => ({ sessionsCount: 3, correctAnswers: 30 })),
    update: vi.fn(async () => ({ xp: 940 })),
  },
  missionCompletion: {
    findMany: vi.fn(async () => []),
    createMany: vi.fn(async () => ({ count: 2 })),
  },
  achievement: {
    findMany: vi.fn(async () => [
      { achievementKey: 'accuracy_80' },
      { achievementKey: 'perfect_sprint' },
    ]),
    createMany: vi.fn(async () => ({ count: 3 })),
  },
  player: {
    update: vi.fn(async () => ({ totalXp: 940 })),
  },
}

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
  },
}))

const { saveSession } = await import('./sessionService.js')

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
  })

  it('calculates XP server-side and does not abort when earned achievements already exist', async () => {
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
      data: { totalXp: { increment: 840 } },
      select: { totalXp: true },
    })
    expect(tx.missionCompletion.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          playerId: 'player-1',
          missionKey: 'daily_first_sprint',
          xpAwarded: 30,
        }),
        expect.objectContaining({
          playerId: 'player-1',
          missionKey: 'daily_three_sprints',
          xpAwarded: 90,
        }),
        expect.objectContaining({
          playerId: 'player-1',
          missionKey: 'daily_twenty_correct',
          xpAwarded: 120,
        }),
      ]),
    })
    expect(tx.dailyStat.update).toHaveBeenCalledWith({
      where: { playerId_day: { playerId: 'player-1', day: expect.any(String) } },
      data: { xp: { increment: 240 } },
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
    expect(tx.achievement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ achievementKey: 'streak_5' }),
        expect.objectContaining({ achievementKey: 'xp_250' }),
        expect.objectContaining({ achievementKey: 'daily_goal' }),
      ],
    })
    expect(result).toMatchObject({
      scorePoints: 480,
      xpEarned: 600,
      missionXpEarned: 240,
      completedMissions: [
        { key: 'daily_first_sprint', rewardXp: 30 },
        { key: 'daily_three_sprints', rewardXp: 90 },
        { key: 'daily_twenty_correct', rewardXp: 120 },
      ],
      earnedAchievements: [
        { key: 'streak_5', label: 'Série x5' },
        { key: 'xp_250', label: '250 XP' },
        { key: 'daily_goal', label: 'Objectif du jour' },
      ],
    })
  })
})
