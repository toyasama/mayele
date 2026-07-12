import { DAILY_GOAL, VALID_GAMES, VALID_LEVELS, type GameLevel, type GameType, type SkillTag } from '../domain/constants.js'
import { getDailyScopeKey } from '../domain/daily.js'
import { getPlayerProgress } from '../domain/progression.js'
import { MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS, MASTERY_MASTER_MIN_CORRECT_ANSWERS, buildBadgeStates, buildMissionStates } from '../domain/rewards.js'
import { prisma } from '../lib/prisma.js'

const DASHBOARD_CACHE_TTL_MS = 15 * 1000
const dashboardCache = new Map<string, { expiresAt: number; payload: Awaited<ReturnType<typeof loadDashboard>> }>()

function dashboardCacheKey(playerId: string, timeZone?: string | null) {
  return `${playerId}:${timeZone ?? ''}`
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

function countByGameLevel(groups: Array<{ game: string; level: string; _count: { _all: number } }>) {
  return new Map(groups.map((group) => [`${group.level}:${group.game}`, group._count._all]))
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

export async function getDashboard(playerId: string, timeZone?: string | null) {
  const key = dashboardCacheKey(playerId, timeZone)
  const now = Date.now()
  const cached = dashboardCache.get(key)

  if (cached && cached.expiresAt > now) {
    return cached.payload
  }

  const payload = await loadDashboard(playerId, timeZone)
  dashboardCache.set(key, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, payload })
  return payload
}

async function loadDashboard(playerId: string, timeZone?: string | null) {
  const day = getDailyScopeKey(undefined, timeZone)
  const [
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
    missionCompletions,
    qualifiedScore80Groups,
    qualifiedScore100Groups,
    fastCorrect2500Groups,
    fastCorrect1800Groups,
    fastCorrect1200Groups,
  ] = await prisma.$transaction([
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
    prisma.missionCompletion.findMany({
      where: {
        playerId,
        scopeKey: day,
      },
      select: {
        missionKey: true,
        scopeKey: true,
        completedAt: true,
        xpAwarded: true,
      },
    }),
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
      where: {
        playerId,
        score: { gte: 80 },
        correctAnswers: { gte: MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS },
      },
      _count: { _all: true },
    }),
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
      where: {
        playerId,
        score: 100,
        correctAnswers: { gte: MASTERY_MASTER_MIN_CORRECT_ANSWERS },
      },
      _count: { _all: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        playerId,
        isCorrect: true,
        responseTimeMs: { lte: 2500 },
      },
      _count: { _all: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        playerId,
        isCorrect: true,
        responseTimeMs: { lte: 1800 },
      },
      _count: { _all: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        playerId,
        isCorrect: true,
        responseTimeMs: { lte: 1200 },
      },
      _count: { _all: true },
    }),
  ])

  const weakSkills = buildWeakSkills(Array.from(buildSkillStats(skillAnswerGroups).values()))
  const practicePlan = buildPracticePlan(weakSkills, recentSessions[0]?.level ?? null)
  const totalXp = summaryStats._sum.xp ?? 0
  const playerProgress = getPlayerProgress(totalXp)
  const missionStats = {
    todaySessions: todayStats?.sessionsCount ?? 0,
    todayCorrectAnswers: todayStats?.correctAnswers ?? 0,
  }
  const responseTimeByGameMap = new Map(responseTimeByGame.map((item) => [item.game, roundStat(item._avg.responseTimeMs)]))
  const responseTimeByLevelMap = new Map(responseTimeByLevel.map((item) => [item.level, roundStat(item._avg.responseTimeMs)]))
  const fastCorrect2500ByMode = countByGameLevel(fastCorrect2500Groups)
  const fastCorrect1800ByMode = countByGameLevel(fastCorrect1800Groups)
  const fastCorrect1200ByMode = countByGameLevel(fastCorrect1200Groups)
  const qualifiedScore80ByMode = countByGameLevel(qualifiedScore80Groups)
  const qualifiedScore100ByMode = countByGameLevel(qualifiedScore100Groups)
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
    missions: buildMissionStates(missionStats, missionCompletions, day),
    badges: buildBadgeStates(
      progressGroups.map((item) => ({
        game: item.game,
        level: item.level,
        attempts: item._count._all,
        bestScore: item._max.score ?? 0,
        bestCorrectAnswers: item._max.correctAnswers ?? 0,
        bestStreak: item._max.bestStreak ?? 0,
        hasQualifiedScore80: qualifiedScore80ByMode.has(`${item.level}:${item.game}`),
        hasQualifiedScore100: qualifiedScore100ByMode.has(`${item.level}:${item.game}`),
        fastCorrectAnswers2500: fastCorrect2500ByMode.get(`${item.level}:${item.game}`) ?? 0,
        fastCorrectAnswers1800: fastCorrect1800ByMode.get(`${item.level}:${item.game}`) ?? 0,
        fastCorrectAnswers1200: fastCorrect1200ByMode.get(`${item.level}:${item.game}`) ?? 0,
      })),
    ),
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
