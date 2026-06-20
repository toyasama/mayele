import { DAILY_GOAL, type GameLevel, type GameType, type SkillTag } from '../domain/constants.js'
import { prisma } from '../lib/prisma.js'

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function calculateAverage(values: number[]) {
  if (!values.length) {
    return 0
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function buildWeakSkills(answers: Array<{ skill: string; isCorrect: boolean }>) {
  const bySkill = new Map<string, { attempts: number; correctAnswers: number }>()

  answers.forEach((answer) => {
    const current = bySkill.get(answer.skill) ?? { attempts: 0, correctAnswers: 0 }
    current.attempts += 1
    current.correctAnswers += answer.isCorrect ? 1 : 0
    bySkill.set(answer.skill, current)
  })

  return Array.from(bySkill.entries())
    .map(([skill, stats]) => ({
      skill: skill as SkillTag,
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
  const [sessions, answers, todayStats, achievements] = await prisma.$transaction([
    prisma.gameSession.findMany({ where: { playerId }, orderBy: { playedAt: 'desc' } }),
    prisma.answer.findMany({ where: { playerId }, select: { skill: true, isCorrect: true } }),
    prisma.dailyStat.findUnique({ where: { playerId_day: { playerId, day } } }),
    prisma.achievement.findMany({ where: { playerId }, orderBy: { earnedAt: 'desc' }, take: 8 }),
  ])

  const sessionsByMode = new Map<
    string,
    {
      game: string
      level: string
      attempts: number
      bestScore: number
      scores: number[]
      accuracies: number[]
      bestStreak: number
      lastPlayedAt: Date | null
    }
  >()
  const gameCounts = new Map<string, { count: number; lastPlayedAt: Date }>()

  sessions.forEach((session) => {
    const key = `${session.game}:${session.level}`
    const mode = sessionsByMode.get(key) ?? {
      game: session.game,
      level: session.level,
      attempts: 0,
      bestScore: 0,
      scores: [],
      accuracies: [],
      bestStreak: 0,
      lastPlayedAt: null,
    }
    mode.attempts += 1
    mode.bestScore = Math.max(mode.bestScore, session.score)
    mode.scores.push(session.score)
    mode.accuracies.push(session.totalQuestions === 0 ? 0 : Math.round((session.correctAnswers * 100) / session.totalQuestions))
    mode.bestStreak = Math.max(mode.bestStreak, session.bestStreak)
    mode.lastPlayedAt = mode.lastPlayedAt && mode.lastPlayedAt > session.playedAt ? mode.lastPlayedAt : session.playedAt
    sessionsByMode.set(key, mode)

    const game = gameCounts.get(session.game)
    gameCounts.set(session.game, {
      count: (game?.count ?? 0) + 1,
      lastPlayedAt: game && game.lastPlayedAt > session.playedAt ? game.lastPlayedAt : session.playedAt,
    })
  })

  const weakSkills = buildWeakSkills(answers)
  const practicePlan = buildPracticePlan(weakSkills, sessions[0]?.level ?? null)
  const favoriteGame =
    Array.from(gameCounts.entries()).sort((a, b) => b[1].count - a[1].count || b[1].lastPlayedAt.getTime() - a[1].lastPlayedAt.getTime())[0]?.[0] ?? null

  return {
    summary: {
      totalSessions: sessions.length,
      bestScore: sessions.reduce((best, session) => Math.max(best, session.score), 0),
      totalPoints: sessions.reduce((sum, session) => sum + session.points, 0),
      averageAccuracy: calculateAverage(sessions.map((session) => (session.totalQuestions === 0 ? 0 : Math.round((session.correctAnswers * 100) / session.totalQuestions)))),
      bestStreak: sessions.reduce((best, session) => Math.max(best, session.bestStreak), 0),
      lastPlayedAt: sessions[0]?.playedAt.toISOString() ?? null,
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
    progressByMode: Array.from(sessionsByMode.values())
      .map((item) => ({
        game: item.game as GameType,
        level: item.level as GameLevel,
        attempts: item.attempts,
        bestScore: item.bestScore,
        averageScore: calculateAverage(item.scores),
        averageAccuracy: calculateAverage(item.accuracies),
        bestStreak: item.bestStreak,
        lastPlayedAt: item.lastPlayedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.bestScore - a.bestScore || b.attempts - a.attempts || String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))),
    recentSessions: sessions.slice(0, 10).map((session) => ({
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
