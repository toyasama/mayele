import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VALID_GAMES, VALID_LEVELS } from '../domain/constants.js'

// --- Mocks ---

const makeSessions = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    score: 80,
    xp: 100,
    correctAnswers: 16,
    totalQuestions: 20,
    durationSeconds: 60,
    bestStreak: 5,
    playedAt: new Date(),
    answers: [],
  }))

const prismaMock = {
  $transaction: vi.fn(),
  gameSession: {
    aggregate: vi.fn(async () => ({
      _count: { _all: 5 },
      _sum: { xp: 500 },
      _avg: { score: 80 },
      _max: { score: 100, bestStreak: 10, playedAt: new Date(), xp: 250 },
    })),
    groupBy: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    findFirst: vi.fn(async () => ({ level: 'intermediaire' })),
    findMany: vi.fn(async () => makeSessions(5)),
  },
  answer: {
    aggregate: vi.fn(async () => ({ _avg: { responseTimeMs: 1200 } })),
    groupBy: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  },
  dailyStat: {
    findUnique: vi.fn(async () => ({ sessionsCount: 2, correctAnswers: 30 })),
  },
  achievement: {
    findMany: vi.fn(async () => []),
  },
  missionCompletion: {
    findMany: vi.fn(async () => []),
  },
}

// Simuler $transaction qui exécute toutes les promesses en parallèle
prismaMock.$transaction.mockImplementation(async (queries: Promise<unknown>[]) => {
  return Promise.all(queries)
})

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const { clearDashboardCacheForTests, getDashboard, getPracticePlan, invalidateDashboardCache } = await import('./dashboardService.js')

// --- Tests ---

describe('getDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDashboardCacheForTests()
  })

  it('retourne une structure complète avec toutes les sections attendues', async () => {
    const result = await getDashboard('player_1')

    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('practicePlan')
    expect(result).toHaveProperty('weakSkills')
    expect(result).toHaveProperty('missions')
    expect(result).toHaveProperty('badges')
    expect(result).toHaveProperty('stats')
    expect(result).toHaveProperty('achievements')
    expect(result).toHaveProperty('progressByMode')
    expect(result).toHaveProperty('recentSessions')
  })

  it('retourne des chiffres cohérents depuis les agrégats', async () => {
    const result = await getDashboard('player_1')

    expect(result.summary.totalSessions).toBe(5)
    expect(result.summary.totalXp).toBe(500)
    expect(result.summary.bestScore).toBe(100)
    expect(result.summary.bestStreak).toBe(10)
  })

  it('retourne les missions pour tous les jeux et niveaux connus', async () => {
    const result = await getDashboard('player_1')

    // Les missions doivent être issues du catalogue
    expect(Array.isArray(result.missions)).toBe(true)
    expect(result.missions.length).toBeGreaterThan(0)
    result.missions.forEach((mission) => {
      expect(mission).toHaveProperty('key')
      expect(mission).toHaveProperty('completed')
      expect(mission).toHaveProperty('rewardXp')
    })
  })

  it('retourne les badges couvrant toutes les familles', async () => {
    const result = await getDashboard('player_1')
    const families = new Set(result.badges.map((b) => b.family))
    expect(families.has('mastery')).toBe(true)
    expect(families.has('speed')).toBe(true)
    expect(families.has('streak')).toBe(true)
    expect(families.has('volume')).toBe(true)
  })

  it('retourne des byGame couvrant exactement VALID_GAMES', async () => {
    const result = await getDashboard('player_1')
    const games = result.stats.byGame.map((g) => g.game)
    expect(games).toEqual(expect.arrayContaining([...VALID_GAMES]))
    expect(games).toHaveLength(VALID_GAMES.length)
  })

  it('retourne des byLevel couvrant exactement VALID_LEVELS', async () => {
    const result = await getDashboard('player_1')
    const levels = result.stats.byLevel.map((l) => l.level)
    expect(levels).toEqual(expect.arrayContaining([...VALID_LEVELS]))
    expect(levels).toHaveLength(VALID_LEVELS.length)
  })

  it('sert le dashboard depuis le cache court sans relancer les agrégats DB', async () => {
    await getDashboard('player_1')
    await getDashboard('player_1')

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it('relance les agrégats après invalidation du cache dashboard', async () => {
    await getDashboard('player_1')
    invalidateDashboardCache('player_1')
    await getDashboard('player_1')

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2)
  })

  it('calcule le practice plan sans charger tout le dashboard', async () => {
    prismaMock.answer.groupBy.mockResolvedValueOnce([
      { skill: 'addition', isCorrect: true, _count: { _all: 2 } },
      { skill: 'addition', isCorrect: false, _count: { _all: 4 } },
    ])
    prismaMock.gameSession.findFirst.mockResolvedValueOnce({ level: 'intermediaire' })

    const result = await getPracticePlan('player_1')

    expect(result.recommendedSkill).toBe('addition')
    expect(result.recommendedLevel).toBe('intermediaire')
    expect(result.message).toContain('33%')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.gameSession.findMany).not.toHaveBeenCalled()
  })
})
