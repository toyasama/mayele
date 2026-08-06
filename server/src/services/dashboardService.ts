import { DAILY_GOAL, VALID_GAMES, VALID_LEVELS, type GameLevel, type GameType, type SkillTag } from '../domain/constants.js'
import { getDailyScopeKey } from '../domain/daily.js'
import { getPlayerProgress } from '../domain/progression.js'
import { prisma } from '../lib/prisma.js'
import { getPlayerBadgeStates } from './badgeService.js'
import { getDailyMissionStates } from './dailyMissionService.js'

const DASHBOARD_CACHE_TTL_MS = 60 * 1000
type DashboardPayload = Awaited<ReturnType<typeof loadDashboard>>
type DashboardCacheEntry = {
  expiresAt: number
  payload?: DashboardPayload
  pending?: Promise<DashboardPayload>
}
const dashboardCache = new Map<string, DashboardCacheEntry>()

function dashboardCacheKey(playerId: string, timeZone: string | null | undefined, day: string) {
  return `${playerId}:${timeZone ?? ''}:${day}`
}

export function invalidateDashboardCache(playerId: string) {
  const prefix = `${playerId}:`

  for (const key of dashboardCache.keys()) {
    if (key.startsWith(prefix)) {
      dashboardCache.delete(key)
    }
  }
}

export function clearDashboardCacheForTests() {
  dashboardCache.clear()
}

function roundStat(value: number | null | undefined) {
  return Math.round(value ?? 0)
}

function average(values: number[]) {
  if (!values.length) {
    return 0
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function buildRecentTrend(sessions: Array<{ score: number; xp: number; bestStreak: number }>) {
  const currentWindow = sessions.slice(0, 5)
  const previousWindow = sessions.slice(5, 10)
  const currentAccuracy = average(currentWindow.map((session) => session.score))
  const previousAccuracy = average(previousWindow.map((session) => session.score))
  const currentXp = average(currentWindow.map((session) => session.xp))
  const previousXp = average(previousWindow.map((session) => session.xp))

  return {
    sessions: currentWindow.length,
    averageAccuracy: currentAccuracy,
    averageXp: currentXp,
    bestStreak: currentWindow.reduce((best, session) => Math.max(best, session.bestStreak), 0),
    accuracyDelta: previousWindow.length ? currentAccuracy - previousAccuracy : 0,
    xpDelta: previousWindow.length ? currentXp - previousXp : 0,
  }
}

function buildWeakSkills(skillStats: Array<{ skill: string; attempts: number; correctAnswers: number }>) {
  return skillStats
    .map((stats) => ({
      skill: stats.skill as SkillTag,
      attempts: stats.attempts,
      correctAnswers: stats.correctAnswers,
      accuracy: Math.round((stats.correctAnswers * 100) / stats.attempts),
    }))
    .filter((item) => item.attempts >= 3)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 4)
}

function buildPracticePlan(weakSkills: ReturnType<typeof buildWeakSkills>, lastLevel: string | null) {
  const recommended = weakSkills.find((item) => item.accuracy < 80)

  if (!recommended) {
    return {
      recommendedSkill: null,
      recommendedLevel: lastLevel ?? 'debutant',
      message: 'Aucune faiblesse fiable détectée pour le moment. Continuez avec quelques sprints mixtes.',
    }
  }

  return {
    recommendedSkill: recommended.skill,
    recommendedLevel: lastLevel ?? 'debutant',
    message: `Priorité: retravailler cette compétence, actuellement à ${recommended.accuracy}% de réussite.`,
  }
}

function buildSkillStats(skillAnswerGroups: Array<{ skill: string; isCorrect: boolean; _count: { _all: number } }>) {
  const skillStats = new Map<string, { skill: string; attempts: number; correctAnswers: number }>()

  skillAnswerGroups.forEach((group) => {
    const current = skillStats.get(group.skill) ?? { skill: group.skill, attempts: 0, correctAnswers: 0 }
    current.attempts += group._count._all
    current.correctAnswers += group.isCorrect ? group._count._all : 0
    skillStats.set(group.skill, current)
  })

  return skillStats
}

export async function getPracticePlan(playerId: string) {
  const [skillAnswerGroups, lastSession] = await Promise.all([
    prisma.answer.groupBy({
      by: ['skill', 'isCorrect'],
      where: { playerId },
      _count: { _all: true },
    }),
    prisma.gameSession.findFirst({
      where: { playerId },
      orderBy: { playedAt: 'desc' },
      select: { level: true },
    }),
  ])

  const weakSkills = buildWeakSkills(Array.from(buildSkillStats(skillAnswerGroups).values()))
  return buildPracticePlan(weakSkills, lastSession?.level ?? null)
}

export async function getDailyObjectives(playerId: string, timeZone?: string | null) {
  const day = getDailyScopeKey(undefined, timeZone)
  return getDailyMissionStates(playerId, day)
}

export async function getOperationHistory(
  playerId: string,
  game: GameType,
  level: GameLevel,
  limit = 20,
) {
  const sessions = await prisma.gameSession.findMany({
    where: { playerId, game, level },
    orderBy: { playedAt: 'desc' },
    take: Math.min(20, Math.max(1, limit)),
    select: {
      id: true,
      score: true,
      correctAnswers: true,
      totalQuestions: true,
      bestStreak: true,
      playedAt: true,
      answers: {
        select: { responseTimeMs: true },
      },
    },
  })

  return sessions.map((session) => ({
    id: session.id,
    score: session.score,
    correctAnswers: session.correctAnswers,
    totalQuestions: session.totalQuestions,
    bestStreak: session.bestStreak,
    playedAt: session.playedAt.toISOString(),
    averageResponseTimeMs: average(session.answers.map((answer) => answer.responseTimeMs)),
  }))
}

export async function getDashboard(playerId: string, timeZone?: string | null, knownTotalXp?: number) {
  // Daily missions follow the player's local calendar day. Keeping that day
  // in the cache key prevents a dashboard cached before midnight from leaking
  // into the new local day.
  const day = getDailyScopeKey(undefined, timeZone)
  const key = dashboardCacheKey(playerId, timeZone, day)
  const now = Date.now()
  const cached = dashboardCache.get(key)

  if (cached?.payload && cached.expiresAt > now) {
    return cached.payload
  }

  if (cached?.pending) {
    return cached.pending
  }

  const pending = loadDashboard(playerId, day, knownTotalXp)
  dashboardCache.set(key, { expiresAt: 0, pending })

  try {
    const payload = await pending
    const current = dashboardCache.get(key)

    // An explicit invalidation that happened while the query was running must
    // not repopulate the cache with the now stale snapshot.
    if (current?.pending === pending) {
      dashboardCache.set(key, { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, payload })
    }

    return payload
  } catch (error) {
    if (dashboardCache.get(key)?.pending === pending) {
      dashboardCache.delete(key)
    }
    throw error
  }
}

async function loadDashboard(playerId: string, day: string, knownTotalXp?: number) {
  // This is a read-only analytical projection. Running independent aggregates
  // concurrently avoids serializing many network round-trips inside a DB
  // transaction. Authoritative writes still invalidate the completed cache.
  const [
    playerProjection,
    summaryStats,
    progressGroups,
    levelGroups,
    skillAnswerGroups,
    gameGroups,
    responseTimeStats,
    responseTimeByGame,
    responseTimeByLevel,
    responseTimeBySession,
    recentSessions,
    todayStats,
    achievements,
    missions,
    badges,
  ] = await Promise.all([
    knownTotalXp === undefined
      ? prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { totalXp: true } })
      : Promise.resolve({ totalXp: knownTotalXp }),
    prisma.gameSession.aggregate({
      where: { playerId },
      _count: { _all: true },
      _sum: { xp: true },
      _avg: { score: true },
      _max: { score: true, bestStreak: true, playedAt: true, xp: true },
    }),
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
      where: { playerId },
      _count: { _all: true },
      _max: { score: true, correctAnswers: true, bestStreak: true, playedAt: true },
      _avg: { score: true },
    }),
    prisma.gameSession.groupBy({
      by: ['level'],
      where: { playerId },
      _count: { _all: true },
      _max: { score: true, bestStreak: true, playedAt: true },
      _avg: { score: true },
    }),
    prisma.answer.groupBy({
      by: ['skill', 'isCorrect'],
      where: { playerId },
      _count: { _all: true },
    }),
    prisma.gameSession.groupBy({
      by: ['game'],
      where: { playerId },
      _count: { _all: true },
      _max: { score: true, bestStreak: true, playedAt: true },
      _avg: { score: true },
    }),
    prisma.answer.aggregate({
      where: { playerId },
      _avg: { responseTimeMs: true },
    }),
    prisma.answer.groupBy({
      by: ['game'],
      where: { playerId },
      _avg: { responseTimeMs: true },
    }),
    prisma.answer.groupBy({
      by: ['level'],
      where: { playerId },
      _avg: { responseTimeMs: true },
    }),
    prisma.answer.groupBy({
      by: ['sessionId'],
      where: { playerId },
      _avg: { responseTimeMs: true },
    }),
    prisma.gameSession.findMany({
      where: { playerId },
      orderBy: { playedAt: 'desc' },
      take: 20,
      include: {
        answers: {
          orderBy: { answeredAt: 'asc' },
          select: {
            id: true,
            prompt: true,
            correctAnswer: true,
            userAnswer: true,
            responseTimeMs: true,
            isCorrect: true,
            skill: true,
          },
        },
      },
    }),
    prisma.dailyStat.findUnique({ where: { playerId_day: { playerId, day } } }),
    prisma.achievement.findMany({ where: { playerId }, orderBy: { earnedAt: 'desc' }, take: 8 }),
    getDailyMissionStates(playerId, day),
    getPlayerBadgeStates(playerId),
  ])

  const weakSkills = buildWeakSkills(Array.from(buildSkillStats(skillAnswerGroups).values()))
  const practicePlan = buildPracticePlan(weakSkills, recentSessions[0]?.level ?? null)
  const totalXp = playerProjection.totalXp
  const playerProgress = getPlayerProgress(totalXp)
  const responseTimeByGameMap = new Map(responseTimeByGame.map((item) => [item.game, roundStat(item._avg.responseTimeMs)]))
  const responseTimeByLevelMap = new Map(responseTimeByLevel.map((item) => [item.level, roundStat(item._avg.responseTimeMs)]))
  const fastestAverageResponseTimeMs = responseTimeBySession.reduce<number | null>((fastest, item) => {
    const averageResponseTime = roundStat(item._avg.responseTimeMs)

    if (!averageResponseTime) {
      return fastest
    }

    return fastest === null ? averageResponseTime : Math.min(fastest, averageResponseTime)
  }, null)
  const combinationStats = progressGroups.map((item) => ({
    game: item.game as GameType,
    level: item.level as GameLevel,
    attempts: item._count._all,
    averageAccuracy: roundStat(item._avg.score),
    bestScore: item._max.score ?? 0,
    bestStreak: item._max.bestStreak ?? 0,
  }))
  const bestCombination =
    [...combinationStats].sort(
      (a, b) =>
        b.averageAccuracy - a.averageAccuracy ||
        b.bestScore - a.bestScore ||
        b.bestStreak - a.bestStreak ||
        b.attempts - a.attempts,
    )[0] ?? null
  const favoriteGame =
    gameGroups.sort((a, b) => {
      const countDiff = b._count._all - a._count._all
      if (countDiff !== 0) {
        return countDiff
      }

      return (b._max.playedAt?.getTime() ?? 0) - (a._max.playedAt?.getTime() ?? 0)
    })[0]?.game ?? null

  return {
    summary: {
      totalSessions: summaryStats._count._all,
      bestScore: summaryStats._max.score ?? 0,
      totalXp,
      playerProgress,
      averageAccuracy: Math.round(summaryStats._avg.score ?? 0),
      bestStreak: summaryStats._max.bestStreak ?? 0,
      lastPlayedAt: summaryStats._max.playedAt?.toISOString() ?? null,
      favoriteGame,
      todaySessions: todayStats?.sessionsCount ?? 0,
      dailyGoal: DAILY_GOAL,
    },
    practicePlan,
    weakSkills,
    missions,
    badges,
    stats: {
      averageResponseTimeMs: roundStat(responseTimeStats._avg.responseTimeMs),
      byGame: VALID_GAMES.map((game) => {
        const group = gameGroups.find((item) => item.game === game)

        return {
          game,
          attempts: group?._count._all ?? 0,
          averageAccuracy: roundStat(group?._avg.score),
          bestScore: group?._max.score ?? 0,
          bestStreak: group?._max.bestStreak ?? 0,
          averageResponseTimeMs: responseTimeByGameMap.get(game) ?? 0,
          lastPlayedAt: group?._max.playedAt?.toISOString() ?? null,
        }
      }),
      byLevel: VALID_LEVELS.map((level) => {
        const group = levelGroups.find((item) => item.level === level)

        return {
          level,
          attempts: group?._count._all ?? 0,
          averageAccuracy: roundStat(group?._avg.score),
          bestScore: group?._max.score ?? 0,
          bestStreak: group?._max.bestStreak ?? 0,
          averageResponseTimeMs: responseTimeByLevelMap.get(level) ?? 0,
          lastPlayedAt: group?._max.playedAt?.toISOString() ?? null,
        }
      }),
      bestCombination,
      recentTrend: buildRecentTrend(recentSessions),
      records: {
        bestScore: summaryStats._max.score ?? 0,
        bestStreak: summaryStats._max.bestStreak ?? 0,
        bestXp: summaryStats._max.xp ?? 0,
        fastestAverageResponseTimeMs,
      },
    },
    achievements: achievements.map((achievement) => ({
      key: achievement.achievementKey,
      label: achievement.label,
      description: achievement.description,
      earnedAt: achievement.earnedAt.toISOString(),
    })),
    progressByMode: progressGroups
      .map((item) => ({
        game: item.game as GameType,
        level: item.level as GameLevel,
        attempts: item._count._all,
        bestScore: item._max.score ?? 0,
        averageScore: Math.round(item._avg.score ?? 0),
        averageAccuracy: Math.round(item._avg.score ?? 0),
        bestStreak: item._max.bestStreak ?? 0,
        lastPlayedAt: item._max.playedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.bestScore - a.bestScore || b.attempts - a.attempts || String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))),
    recentSessions: recentSessions.map((session) => ({
      id: session.id,
      game: session.game,
      level: session.level,
      practiceSkill: session.practiceSkill,
      score: session.score,
      scorePoints: session.scorePoints,
      xp: session.xp,
      correctAnswers: session.correctAnswers,
      totalQuestions: session.totalQuestions,
      durationSeconds: session.durationSeconds,
      bestStreak: session.bestStreak,
      playedAt: session.playedAt.toISOString(),
      answers: session.answers.map((answer) => ({
        id: answer.id,
        prompt: answer.prompt,
        correctAnswer: answer.correctAnswer,
        userAnswer: answer.userAnswer,
        responseTimeMs: answer.responseTimeMs,
        isCorrect: answer.isCorrect,
        skill: answer.skill,
      })),
    })),
  }
}
