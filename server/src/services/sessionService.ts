import { ACHIEVEMENTS, DAILY_GOAL } from '../domain/constants.js'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import type { SessionPayload } from '../schemas/sessionSchema.js'

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

async function insertAchievement(tx: Prisma.TransactionClient, playerId: string, key: keyof typeof ACHIEVEMENTS) {
  const achievement = ACHIEVEMENTS[key]

  try {
    await tx.achievement.create({
      data: {
        playerId,
        achievementKey: key,
        label: achievement.label,
        description: achievement.description,
      },
    })
    return { key, label: achievement.label }
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return null
    }

    throw error
  }
}

export async function saveSession(playerId: string, payload: SessionPayload) {
  const parsedAnswers = payload.answers.map((answer) => ({
    ...answer,
    game: answer.game ?? payload.game,
    level: answer.level ?? payload.level,
    isCorrect: answer.userAnswer === answer.correctAnswer,
  }))
  const correctAnswers = parsedAnswers.filter((answer) => answer.isCorrect).length
  const score = calculateAccuracy(correctAnswers, parsedAnswers.length)
  const day = todayKey()

  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.create({
      data: {
        playerId,
        game: payload.game,
        level: payload.level,
        practiceSkill: payload.practiceSkill,
        score,
        points: payload.points,
        correctAnswers,
        totalQuestions: parsedAnswers.length,
        durationSeconds: payload.durationSeconds,
        bestStreak: payload.bestStreak,
      },
    })

    await tx.answer.createMany({
      data: parsedAnswers.map((answer) => ({
        sessionId: session.id,
        playerId,
        game: answer.game,
        level: answer.level,
        skill: answer.skill,
        prompt: answer.prompt,
        correctAnswer: answer.correctAnswer,
        userAnswer: answer.userAnswer,
        responseTimeMs: answer.responseTimeMs,
        isCorrect: answer.isCorrect,
      })),
    })

    const dailyStat = await tx.dailyStat.upsert({
      where: { playerId_day: { playerId, day } },
      update: {
        sessionsCount: { increment: 1 },
        points: { increment: payload.points },
        correctAnswers: { increment: correctAnswers },
        totalQuestions: { increment: parsedAnswers.length },
      },
      create: {
        playerId,
        day,
        sessionsCount: 1,
        points: payload.points,
        correctAnswers,
        totalQuestions: parsedAnswers.length,
      },
    })

    const totalSessions = await tx.gameSession.count({ where: { playerId } })
    const achievementKeys: Array<keyof typeof ACHIEVEMENTS> = []

    if (totalSessions === 1) achievementKeys.push('first_sprint')
    if (score >= 80) achievementKeys.push('accuracy_80')
    if (score === 100) achievementKeys.push('perfect_sprint')
    if (payload.bestStreak >= 5) achievementKeys.push('streak_5')
    if (payload.points >= 100) achievementKeys.push('points_100')
    if (dailyStat.sessionsCount >= DAILY_GOAL) achievementKeys.push('daily_goal')

    const earnedAchievements = []
    for (const key of achievementKeys) {
      const earned = await insertAchievement(tx, playerId, key)
      if (earned) {
        earnedAchievements.push(earned)
      }
    }

    return { message: 'Session enregistrée.', earnedAchievements }
  })
}
