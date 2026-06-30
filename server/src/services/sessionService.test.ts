import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionPayload } from '../schemas/sessionSchema.js'

const tx = {
  gameSession: {
    create: vi.fn(async () => ({ id: 'session-1' })),
    count: vi.fn(async () => 4),
  },
  answer: {
    createMany: vi.fn(async () => ({ count: 2 })),
  },
  dailyStat: {
    upsert: vi.fn(async () => ({ sessionsCount: 3 })),
  },
  achievement: {
    findMany: vi.fn(async () => [
      { achievementKey: 'accuracy_80' },
      { achievementKey: 'perfect_sprint' },
    ]),
    createMany: vi.fn(async () => ({ count: 3 })),
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
  level: 'intermediaire',
  practiceSkill: null,
  points: 120,
  totalQuestions: 2,
  durationSeconds: 60,
  bestStreak: 5,
  answers: [
    {
      prompt: '7 × 9',
      correctAnswer: 63,
      userAnswer: 63,
      responseTimeMs: 900,
      game: 'multiplication',
      level: 'intermediaire',
      skill: 'tables',
    },
    {
      prompt: '90 + 63',
      correctAnswer: 153,
      userAnswer: 153,
      responseTimeMs: 1100,
      game: 'addition',
      level: 'intermediaire',
      skill: 'addition',
    },
  ],
}

describe('saveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not abort the transaction when earned achievements already exist', async () => {
    const result = await saveSession('player-1', perfectSessionPayload)

    expect(tx.achievement.findMany).toHaveBeenCalledWith({
      where: {
        playerId: 'player-1',
        achievementKey: {
          in: ['accuracy_80', 'perfect_sprint', 'streak_5', 'points_100', 'daily_goal'],
        },
      },
      select: { achievementKey: true },
    })
    expect(tx.achievement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ achievementKey: 'streak_5' }),
        expect.objectContaining({ achievementKey: 'points_100' }),
        expect.objectContaining({ achievementKey: 'daily_goal' }),
      ],
    })
    expect(result.earnedAchievements).toEqual([
      { key: 'streak_5', label: 'Série x5' },
      { key: 'points_100', label: '100 points' },
      { key: 'daily_goal', label: 'Objectif du jour' },
    ])
  })
})
