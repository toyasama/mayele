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
import { BADGE_SPRINT_DURATION_SECONDS, loadPlayerBadgeStates } from './badgeService.js'
import { loadDailyMissionStates } from './dailyMissionService.js'
import { invalidateDashboardCache } from './dashboardService.js'
import { serializeNotification } from './notificationPresenter.js'
import {
  badgeEarnedNotificationKey,
  createNotification,
  missionCompletedNotificationKey,
} from './notificationService.js'
import { enqueueOutboxEvent } from './outboxService.js'
import { signalBackgroundWork } from './backgroundWorkSignals.js'
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
  completedBadges: Array<{ key: string; title: string; familyLabel: string }>
  playerProgress: ReturnType<typeof getPlayerProgress>
  earnedAchievements: Array<{ key: string; label: string }>
}

export type SaveSessionOptions = {
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

export type SessionSettlement = {
  result: SessionSaveResult
  created: boolean
}

function calculatePayloadHash(payload: SessionPayload) {
  const { submissionId: _submissionId, ...scoredPayload } = payload
  return createHash('sha256').update(JSON.stringify(scoredPayload)).digest('hex')
}

function isUniqueConstraintConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
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

async function findStoredSubmissionInTransaction(
  tx: Prisma.TransactionClient,
  playerId: string,
  submissionKey: string,
) {
  return tx.gameSession.findUnique({
    where: { playerId_submissionKey: { playerId, submissionKey } },
    select: {
      submissionPayloadHash: true,
      submissionResult: true,
    },
  })
}

async function lockSessionSubmission(tx: Prisma.TransactionClient, playerId: string, submissionKey: string) {
  const lockKey = `game-session:${playerId}:${submissionKey}`
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired
  `
}

async function lockPlayerRewards(tx: Prisma.TransactionClient, playerId: string) {
  const lockKey = `session-rewards:${playerId}`
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired
  `
}

function canCompleteSoloSprintBadge(options: SaveSessionOptions) {
  const context = options.dailyMissionContext
  return context?.playContext === 'solo'
    && context.challengeMode === 'sprint'
    && context.completedWithoutAbandonment
    && BADGE_SPRINT_DURATION_SECONDS.includes(
      context.configuredDurationSeconds as (typeof BADGE_SPRINT_DURATION_SECONDS)[number],
    )
}

async function createRewardNotifications(
  tx: Prisma.TransactionClient,
  playerId: string,
  sessionId: string,
  missions: Array<{ key: string; title: string; rewardXp: number; scopeKey: string }>,
  badges: Array<{ key: string; title: string; familyLabel: string }>,
) {
  for (const mission of missions) {
    const notification = await createNotification({
      playerId,
      type: 'mission_completed',
      title: `Mission terminée : ${mission.title}`,
      body: `Vous gagnez ${mission.rewardXp} XP.`,
      href: '/dashboard?view=missions',
      dedupeKey: missionCompletedNotificationKey(mission.scopeKey, mission.key),
    }, tx)
    await enqueueOutboxEvent(tx, {
      dedupeKey: `session:${sessionId}:mission:${mission.key}:notification`,
      topic: 'notification.created',
      aggregateType: 'game_session',
      aggregateId: sessionId,
      payload: {
        playerId,
        reason: 'notification_created',
        notification: serializeNotification(notification),
      },
    })
  }

  for (const badge of badges) {
    const notification = await createNotification({
      playerId,
      type: 'badge_earned',
      title: `Badge débloqué : ${badge.title}`,
      body: `Nouveau badge ${badge.familyLabel}.`,
      href: '/dashboard?view=missions',
      dedupeKey: badgeEarnedNotificationKey(badge.key),
    }, tx)
    await enqueueOutboxEvent(tx, {
      dedupeKey: `session:${sessionId}:badge:${badge.key}:notification`,
      topic: 'notification.created',
      aggregateType: 'game_session',
      aggregateId: sessionId,
      payload: {
        playerId,
        reason: 'notification_created',
        notification: serializeNotification(notification),
      },
    })
  }
}

export async function settleSession(
  tx: Prisma.TransactionClient,
  playerId: string,
  payload: SessionPayload,
  timeZone?: string | null,
  options: SaveSessionOptions = {},
): Promise<SessionSettlement> {
  const submissionKey = options.submissionKey ?? payload.submissionId ?? null
  const submissionHash = submissionKey ? calculatePayloadHash(payload) : null

  if (submissionKey && submissionHash) {
    await lockSessionSubmission(tx, playerId, submissionKey)
    const existing = await findStoredSubmissionInTransaction(tx, playerId, submissionKey)
    if (existing) {
      return {
        result: replayStoredResult(existing, submissionHash),
        created: false,
      }
    }
  }

  await lockPlayerRewards(tx, playerId)

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
  const badgesBeforeSession = canCompleteSoloSprintBadge(options)
    ? await loadPlayerBadgeStates(tx, playerId)
    : []
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
  const missionStates = dailyMissionEligible ? await loadDailyMissionStates(tx, playerId, day) : []
  const newlyCompletedMissions = missionStates.filter((mission) => mission.completed && !mission.claimed)
  const awardedMissions = [] as typeof newlyCompletedMissions

  for (const mission of newlyCompletedMissions) {
    const inserted = await tx.missionCompletion.createMany({
      data: [
        {
          playerId,
          missionKey: mission.key,
          scopeKey: mission.scopeKey,
          xpAwarded: mission.rewardXp,
        },
      ],
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
      metadata: {
        missionKey: mission.key,
        scopeKey: mission.scopeKey,
        sessionId: session.id,
      },
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
      data: [
        {
          playerId,
          achievementKey: key,
          label: ACHIEVEMENTS[key].label,
          description: ACHIEVEMENTS[key].description,
        },
      ],
      skipDuplicates: true,
    })

    if (inserted.count > 0) {
      awardedAchievementKeys.push(key)
    }
  }
  const earnedAchievements = awardedAchievementKeys.map((key) => ({
    key,
    label: ACHIEVEMENTS[key].label,
  }))
  const completedBadgeKeysBeforeSession = new Set(
    badgesBeforeSession.filter((badge) => badge.completed).map((badge) => badge.key),
  )
  const badgesAfterSession = canCompleteSoloSprintBadge(options)
    ? await loadPlayerBadgeStates(tx, playerId, { includeSessionId: session.id })
    : []
  const completedBadges = badgesAfterSession
    .filter((badge) => badge.completed && !completedBadgeKeysBeforeSession.has(badge.key))
    .map((badge) => ({
      key: badge.key,
      title: badge.title,
      familyLabel: badge.familyLabel,
    }))

  await createRewardNotifications(tx, playerId, session.id, awardedMissions, completedBadges)

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
    completedBadges,
    playerProgress: getPlayerProgress(xpProjection.totalXp),
    earnedAchievements,
  }

  if (submissionKey) {
    await tx.gameSession.update({
      where: { id: session.id },
      data: { submissionResult: canonicalResult as Prisma.InputJsonValue },
    })
  }

  return { result: canonicalResult, created: true }
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

  let settlement: SessionSettlement

  try {
    settlement = await prisma.$transaction((tx) => settleSession(tx, playerId, payload, timeZone, options))
  } catch (error) {
    // The advisory transaction lock is the primary concurrency control. This
    // branch remains a strict fallback for a legacy or non-cooperating writer.
    if (submissionKey && submissionHash && isUniqueConstraintConflict(error)) {
      const existing = await findStoredSubmission(playerId, submissionKey)
      if (existing) {
        return replayStoredResult(existing, submissionHash)
      }
    }

    throw error
  }

  if (settlement.created) {
    invalidateDashboardCache(playerId)
    signalBackgroundWork('outbox')
  }
  return settlement.result
}
