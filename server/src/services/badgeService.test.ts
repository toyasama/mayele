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

const {
  BADGE_SOLO_SPRINT_SCOPE,
  BADGE_SPRINT_DURATION_SECONDS,
  LEGACY_SOLO_RUN_CUTOVER_AT,
  getPlayerBadgeStates,
} = await import('./badgeService.js')

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
        durationSeconds: 60,
        soloRun: { durationSeconds: 120 },
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

  it('limite toutes les familles aux Sprints Solo modernes ou historiques éligibles', async () => {
    await getPlayerBadgeStates('player_1')

    expect(prismaMock.gameSession.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        playerId: 'player_1',
        OR: BADGE_SOLO_SPRINT_SCOPE.OR,
      }),
    }))

    for (const [call] of prismaMock.answer.groupBy.mock.calls) {
      expect(call.where.session.is).toEqual(BADGE_SOLO_SPRINT_SCOPE)
      expect(call.where.isCorrect).toBe(true)
    }

    expect(prismaMock.answer.groupBy.mock.calls.map(([call]) => call.where.responseTimeMs.lte))
      .toEqual([2500, 1800, 1200])
  })

  it('exclut explicitement Tempo, le multijoueur et les Sprints Solo non terminés', () => {
    expect(BADGE_SOLO_SPRINT_SCOPE.OR).toHaveLength(4)

    BADGE_SPRINT_DURATION_SECONDS.forEach((durationSeconds, index) => {
      expect(BADGE_SOLO_SPRINT_SCOPE.OR[index]).toEqual({
        durationSeconds,
        matchParticipant: { is: null },
        soloRun: { is: { mode: 'sprint', status: 'completed', durationSeconds } },
      })
    })

    expect(BADGE_SOLO_SPRINT_SCOPE.OR[3]).toEqual({
      playedAt: { lt: LEGACY_SOLO_RUN_CUTOVER_AT },
      durationSeconds: { in: [...BADGE_SPRINT_DURATION_SECONDS] },
      totalQuestions: { gt: 0 },
      soloRun: { is: null },
      matchParticipant: { is: null },
      answers: { some: {} },
    })
  })

  it('utilise la durée GameSession pour recalculer la cadence d’un Sprint historique', async () => {
    prismaMock.gameSession.findMany.mockResolvedValueOnce([
      {
        game: 'addition',
        level: 'debutant',
        correctAnswers: 24,
        totalQuestions: 30,
        durationSeconds: 120,
        soloRun: null,
      },
    ])

    const badges = await getPlayerBadgeStates('player_1')
    const addition = badges
      .find((badge) => badge.key === 'confirmed_debutant')
      ?.objectives.find((objective) => objective.label === 'Addition')

    expect(addition).toMatchObject({ completed: true })
    expect(addition?.detail).toContain('12/12 rép./min')
  })
})
