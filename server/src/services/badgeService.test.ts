import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  gameSession: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  answer: {
    groupBy: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const { getPlayerBadgeStates } = await import('./badgeService.js')

describe('getPlayerBadgeStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.answer.groupBy.mockResolvedValue([])
    prismaMock.gameSession.groupBy.mockResolvedValue([
      {
        game: 'addition',
        level: 'debutant',
        _count: { _all: 1 },
        _max: { bestStreak: 8 },
      },
    ])
    prismaMock.gameSession.findMany.mockResolvedValue([
      {
        game: 'addition',
        level: 'debutant',
        correctAnswers: 24,
        totalQuestions: 30,
        soloRun: { durationSeconds: 120 },
        matchParticipant: null,
      },
    ])
  })

  it('qualifie un objectif avec la durée canonique du Sprint', async () => {
    const badges = await getPlayerBadgeStates('player_1')
    const confirmed = badges.find((badge) => badge.key === 'confirmed_debutant')
    const addition = confirmed?.objectives.find((objective) => objective.label === 'Addition')

    expect(addition).toMatchObject({ completed: true })
    expect(addition?.detail).toContain('80%')
    expect(addition?.detail).toContain('12/12 rép./min')
  })

  it('limite toutes les familles aux Sprints terminés sans abandon', async () => {
    await getPlayerBadgeStates('player_1')

    expect(prismaMock.gameSession.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        playerId: 'player_1',
        OR: [
          { soloRun: { is: { mode: 'sprint', status: 'completed' } } },
          {
            matchParticipant: {
              is: {
                status: 'completed',
                forfeitedAt: null,
                match: { is: { challengeMode: 'sprint', status: 'completed' } },
              },
            },
          },
        ],
      }),
    }))

    for (const [call] of prismaMock.answer.groupBy.mock.calls) {
      expect(call.where.session.is.OR[0].soloRun.is.mode).toBe('sprint')
      expect(call.where.session.is.OR[1].matchParticipant.is.match.is.challengeMode).toBe('sprint')
    }
  })
})
