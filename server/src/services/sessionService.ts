import { createHash } from 'node:crypto'
import { ACHIEVEMENTS, DAILY_GOAL } from '../domain/constants.js'
import { getDailyScopeKey } from '../domain/daily.js'
import { countValidMissionAnswers, qualifiesForDailyMissions } from '../domain/dailyMissionEligibility.js'
import type { MissionChallengeMode, MissionPlayContext } from '../domain/dailyMissions.js'
import { calculateSessionXp, getPlayerProgress } from '../domain/progression.js'
import { calculateSessionScorePoints } from '../domain/scoring.js'
import { ApiError } from '../errors.js'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import type { SessionPayload } from '../schemas/sessionSchema.js'
import { loadDailyMissionStates } from './dailyMissionService.js'
import { invalidateDashboardCache } from './dashboardService.js'
import { appendXpLedgerEntries } from './xpLedgerService.js'

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

export type SessionSaveResult = {
  sessionId: string
  scorePoints: number
  message: string
  xpEarned: number
  missionXpEarned: number
  completedMissions: Array<{ key: string; title: string; rewardXp: number }>
  playerProgress: ReturnType<typeof getPlayerProgress>
  earnedAchievements: Array<{ key: string; label: string }>
}

type SaveSessionOptions = {
  // Internal callers (notably multiplayer) can provide a stable command key
  // without adding it to their public payload.
  submissionKey?: string | null
  // The authoritative game service confirms that the player reached the
  // natural end of the game and did not abandon it.
  dailyMissionContext?: {
    playContext: MissionPlayContext
    challengeMode: MissionChallengeMode
    completedWithoutAbandonment: boolean
    configuredDurationSeconds: number | null
    configuredQuestionCount: number | null
    configuredQuestionSeconds: number | null
  }
}

function calculatePayloadHash(payload: SessionPayload) {
  const { submissionId: _submissionId, ...scoredPayload } = payload
  return createHash('sha256').update(JSON.stringify(scoredPayload)).digest('hex')
}

function isSubmissionKeyConflict(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') {
    return false
  }

  if (!('meta' in error) || typeof error.meta !== 'object' || error.meta === null || !('target' in error.meta)) {
    return false
  }

  const target = error.meta.target
  const fields = Array.isArray(target) ? target.map(String) : [String(target)]
  return fields.some((field) =>
    field === 'submissionKey' ||
    field === 'submission_key' ||
    field.includes('game_sessions_player_id_submission_key_key'),
  )
}

function replayStoredResult(
  existing: { submissionPayloadHash: string | null; submissionResult: Prisma.JsonValue | null },
  expectedPayloadHash: string,
) {
  if (existing.submissionPayloadHash !== expectedPayloadHash) {
    throw new ApiError(
      409,
      'Cet identifiant de soumission a déjà été utilisé avec un autre résultat.',
      'session_submission_conflict',
    )
  }

  if (!existing.submissionResult) {
    throw new Error('Session idempotente enregistree sans resultat canonique.')
  }

  return existing.submissionResult as unknown as SessionSaveResult
}

async function findStoredSubmission(playerId: string, submissionKey: string) {
  return prisma.gameSession.findUnique({
    where: { playerId_submissionKey: { playerId, submissionKey } },
    select: {
      submissionPayloadHash: true,
      submissionResult: true,
    },
  })
}

export async function saveSession(
  playerId: string,
  payload: SessionPayload,
  timeZone?: string | null,
  options: SaveSessionOptions = {},
) {
  const submissionKey = options.submissionKey ?? payload.submissionId ?? null
  const submissionHash = submissionKey ? calculatePayloadHash(payload) : null

  if (submissionKey && submissionHash) {
    const existing = await findStoredSubmission(playerId, submissionKey)
    if (existing) {
      return replayStoredResult(existing, submissionHash)
    }
  }

  const parsedAnswers = payload.answers.map((answer) => ({
    ...answer,
    game: answer.game ?? payload.game,
    level: answer.level ?? payload.level,
    isCorrect: answer.userAnswer === answer.correctAnswer,
  }))
  const correctAnswers = parsedAnswers.filter((answer) => answer.isCorrect).length
  const validAnswerCount = countValidMissionAnswers(parsedAnswers)
  const dailyMissionContext = options.dailyMissionContext ?? null
  const dailyMissionEligible = qualifiesForDailyMissions(
    dailyMissionContext?.completedWithoutAbandonment === true,
    validAnswerCount,
  )
  const score = calculateAccuracy(correctAnswers, parsedAnswers.length)
  const scorePoints = calculateSessionScorePoints(payload.level, parsedAnswers)
  const xp = calculateSessionXp({
    level: payload.level,
    correctAnswers,
    totalQuestions: parsedAnswers.length,
    bestStreak: payload.bestStreak,
  })
  const day = getDailyScopeKey(undefined, timeZone)
  let result: SessionSaveResult

  try {
    result = await prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.create({
        data: {
          playerId,
          submissionKey,
          submissionPayloadHash: submissionHash,
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
          missionDay: dailyMissionContext ? day : null,
          missionEligible: dailyMissionEligible,
          playContext: dailyMissionContext?.playContext ?? null,
          challengeMode: dailyMissionContext?.challengeMode ?? null,
          configuredDurationSeconds: dailyMissionContext?.configuredDurationSeconds ?? null,
          configuredQuestionCount: dailyMissionContext?.configuredQuestionCount ?? null,
          configuredQuestionSeconds: dailyMissionContext?.configuredQuestionSeconds ?? null,
          validAnswers: validAnswerCount,
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

      const totalSessions = await tx.gameSession.count({ where: { playerId } })
      const missionStates = dailyMissionEligible
        ? await loadDailyMissionStates(tx, playerId, day)
        : []
      const newlyCompletedMissions = missionStates.filter((mission) => mission.completed && !mission.claimed)
      const awardedMissions = [] as typeof newlyCompletedMissions

      for (const mission of newlyCompletedMissions) {
        const inserted = await tx.missionCompletion.createMany({
          data: [{
            playerId,
            missionKey: mission.key,
            scopeKey: mission.scopeKey,
            xpAwarded: mission.rewardXp,
          }],
          skipDuplicates: true,
        })

        if (inserted.count > 0) {
          awardedMissions.push(mission)
        }
      }

      const missionXpEarned = awardedMissions.reduce((sum, mission) => sum + mission.rewardXp, 0)

      if (missionXpEarned > 0) {
        await tx.dailyStat.update({
          where: { playerId_day: { playerId, day } },
          data: { xp: { increment: missionXpEarned } },
        })
      }

      const xpProjection = await appendXpLedgerEntries(tx, playerId, [
        {
          sourceType: 'session',
          sourceId: session.id,
          amount: xp,
          metadata: {
            game: payload.game,
            level: payload.level,
            correctAnswers,
            totalQuestions: parsedAnswers.length,
          },
        },
        ...awardedMissions.map((mission) => ({
          sourceType: 'mission' as const,
          sourceId: `${mission.scopeKey}:${mission.key}`,
          amount: mission.rewardXp,
          metadata: { missionKey: mission.key, scopeKey: mission.scopeKey, sessionId: session.id },
        })),
      ])
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
      const awardedAchievementKeys: Array<keyof typeof ACHIEVEMENTS> = []

      // A different session can unlock the same badge concurrently. Only rows
      // actually inserted by this transaction are returned as newly earned.
      for (const key of newAchievementKeys) {
        const inserted = await tx.achievement.createMany({
          data: [{
            playerId,
            achievementKey: key,
            label: ACHIEVEMENTS[key].label,
            description: ACHIEVEMENTS[key].description,
          }],
          skipDuplicates: true,
        })

        if (inserted.count > 0) {
          awardedAchievementKeys.push(key)
        }
      }
      const earnedAchievements = awardedAchievementKeys.map((key) => ({ key, label: ACHIEVEMENTS[key].label }))
      const canonicalResult: SessionSaveResult = {
        sessionId: session.id,
        scorePoints,
        message: 'Session enregistrée.',
        xpEarned: xp,
        missionXpEarned,
        completedMissions: awardedMissions.map((mission) => ({
          key: mission.key,
          title: mission.title,
          rewardXp: mission.rewardXp,
        })),
        playerProgress: getPlayerProgress(xpProjection.totalXp),
        earnedAchievements,
      }

      if (submissionKey) {
        await tx.gameSession.update({
          where: { id: session.id },
          data: { submissionResult: canonicalResult as Prisma.InputJsonValue },
        })
      }

      return canonicalResult
    })
  } catch (error) {
    // PostgreSQL serializes concurrent inserts against the unique key. The
    // loser reaches this branch after the winner committed.
    if (submissionKey && submissionHash && isSubmissionKeyConflict(error)) {
      const existing = await findStoredSubmission(playerId, submissionKey)
      if (existing) {
        return replayStoredResult(existing, submissionHash)
      }
    }

    throw error
  }

  invalidateDashboardCache(playerId)
  return result
}
