import { DAILY_GOAL, type GameLevel, type GameType, type SkillTag } from '../domain/constants.js'
import { prisma } from '../lib/prisma.js'

function todayKey() {
  return new Date().toISOString().slice(0, 10)
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

export async function getDashboard(playerId: string) {
  const day = todayKey()
  const [summaryStats, progressGroups, skillAnswerGroups, gameGroups, recentSessions, todayStats, achievements] = await prisma.$transaction([
    prisma.gameSession.aggregate({
      where: { playerId },
      _count: { _all: true },
      _sum: { points: true },
      _avg: { score: true },
      _max: { score: true, bestStreak: true, playedAt: true },
    }),
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
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
      _max: { playedAt: true },
    }),
    prisma.gameSession.findMany({ where: { playerId }, orderBy: { playedAt: 'desc' }, take: 10 }),
    prisma.dailyStat.findUnique({ where: { playerId_day: { playerId, day } } }),
    prisma.achievement.findMany({ where: { playerId }, orderBy: { earnedAt: 'desc' }, take: 8 }),
  ])

  const skillStats = new Map<string, { skill: string; attempts: number; correctAnswers: number }>()

  skillAnswerGroups.forEach((group) => {
    const current = skillStats.get(group.skill) ?? { skill: group.skill, attempts: 0, correctAnswers: 0 }
    current.attempts += group._count._all
    current.correctAnswers += group.isCorrect ? group._count._all : 0
    skillStats.set(group.skill, current)
  })

  const weakSkills = buildWeakSkills(Array.from(skillStats.values()))
  const practicePlan = buildPracticePlan(weakSkills, recentSessions[0]?.level ?? null)
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
      totalPoints: summaryStats._sum.points ?? 0,
      averageAccuracy: Math.round(summaryStats._avg.score ?? 0),
      bestStreak: summaryStats._max.bestStreak ?? 0,
      lastPlayedAt: summaryStats._max.playedAt?.toISOString() ?? null,
      favoriteGame,
      todaySessions: todayStats?.sessionsCount ?? 0,
      dailyGoal: DAILY_GOAL,
    },
    practicePlan,
    weakSkills,
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
      points: session.points,
      correctAnswers: session.correctAnswers,
      totalQuestions: session.totalQuestions,
      durationSeconds: session.durationSeconds,
      bestStreak: session.bestStreak,
      playedAt: session.playedAt.toISOString(),
    })),
  }
}
