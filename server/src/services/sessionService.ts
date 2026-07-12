import { ACHIEVEMENTS, DAILY_GOAL } from '../domain/constants.js'
import { getDailyScopeKey } from '../domain/daily.js'
import { calculateSessionXp, getPlayerProgress } from '../domain/progression.js'
import { buildMissionStates } from '../domain/rewards.js'
import { calculateSessionScorePoints } from '../domain/scoring.js'
import { prisma } from '../lib/prisma.js'
import type { SessionPayload } from '../schemas/sessionSchema.js'
import { invalidateDashboardCache } from './dashboardService.js'

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

export async function saveSession(playerId: string, payload: SessionPayload, timeZone?: string | null) {
  const parsedAnswers = payload.answers.map((answer) => ({
    ...answer,
    game: answer.game ?? payload.game,
    level: answer.level ?? payload.level,
    isCorrect: answer.userAnswer === answer.correctAnswer,
  }))
  const correctAnswers = parsedAnswers.filter((answer) => answer.isCorrect).length
  const score = calculateAccuracy(correctAnswers, parsedAnswers.length)
  const scorePoints = calculateSessionScorePoints(payload.level, parsedAnswers)
  const xp = calculateSessionXp({
    level: payload.level,
    correctAnswers,
    totalQuestions: parsedAnswers.length,
    bestStreak: payload.bestStreak,
  })
  const day = getDailyScopeKey(undefined, timeZone)

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.create({
      data: {
        playerId,
        game: payload.game,
        level: payload.level,
        practiceSkill: payload.practiceSkill,
        score,
        scorePoints,
        xp,
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
        xp: { increment: xp },
        correctAnswers: { increment: correctAnswers },
        totalQuestions: { increment: parsedAnswers.length },
      },
      create: {
        playerId,
        day,
        sessionsCount: 1,
        xp,
        correctAnswers,
        totalQuestions: parsedAnswers.length,
      },
    })

    const [totalSessions, existingMissionCompletions] = await Promise.all([
      tx.gameSession.count({ where: { playerId } }),
      tx.missionCompletion.findMany({
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
    ])
    const missionStates = buildMissionStates(
      {
        todaySessions: dailyStat.sessionsCount,
        todayCorrectAnswers: dailyStat.correctAnswers,
      },
      existingMissionCompletions,
      day,
    )
    const newlyCompletedMissions = missionStates.filter((mission) => mission.completed && !mission.claimed)
    const missionXpEarned = newlyCompletedMissions.reduce((sum, mission) => sum + mission.rewardXp, 0)

    if (newlyCompletedMissions.length) {
      await tx.missionCompletion.createMany({
        data: newlyCompletedMissions.map((mission) => ({
          playerId,
          missionKey: mission.key,
          scopeKey: mission.scopeKey,
          xpAwarded: mission.rewardXp,
        })),
      })

      await tx.dailyStat.update({
        where: { playerId_day: { playerId, day } },
        data: { xp: { increment: missionXpEarned } },
      })
    }

    const player = await tx.player.update({
      where: { id: playerId },
      data: { totalXp: { increment: xp + missionXpEarned } },
      select: { totalXp: true },
    })
    const achievementKeys: Array<keyof typeof ACHIEVEMENTS> = []

    if (totalSessions === 1) achievementKeys.push('first_sprint')
    if (score >= 80) achievementKeys.push('accuracy_80')
    if (score === 100) achievementKeys.push('perfect_sprint')
    if (payload.bestStreak >= 5) achievementKeys.push('streak_5')
    if (xp >= 250) achievementKeys.push('xp_250')
    if (dailyStat.sessionsCount >= DAILY_GOAL) achievementKeys.push('daily_goal')

    const existingAchievements = achievementKeys.length
      ? await tx.achievement.findMany({
          where: {
            playerId,
            achievementKey: { in: achievementKeys },
          },
          select: { achievementKey: true },
        })
      : []
    const existingAchievementKeys = new Set(existingAchievements.map((achievement) => achievement.achievementKey))
    const newAchievementKeys = achievementKeys.filter((key) => !existingAchievementKeys.has(key))

    if (newAchievementKeys.length) {
      await tx.achievement.createMany({
        data: newAchievementKeys.map((key) => ({
          playerId,
          achievementKey: key,
          label: ACHIEVEMENTS[key].label,
          description: ACHIEVEMENTS[key].description,
        })),
      })
    }
    const earnedAchievements = newAchievementKeys.map((key) => ({ key, label: ACHIEVEMENTS[key].label }))

    return {
      sessionId: session.id,
      scorePoints,
      message: 'Session enregistrée.',
      xpEarned: xp,
      missionXpEarned,
      completedMissions: newlyCompletedMissions.map((mission) => ({
        key: mission.key,
        title: mission.title,
        rewardXp: mission.rewardXp,
      })),
      playerProgress: getPlayerProgress(player.totalXp),
      earnedAchievements,
    }
  })

  invalidateDashboardCache(playerId)
  return result
}
