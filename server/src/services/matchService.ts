import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import { completedMatchForDailyMissions } from '../domain/dailyMissionEligibility.js'
import { canonicalPairIds, buildChallengeConfig, determineMatchWinner } from '../domain/matchRules.js'
import { calculateSessionScorePoints } from '../domain/scoring.js'
import { prisma } from '../lib/prisma.js'
import type { TempoAnswerPayload, ChallengeConfigPayload, ChallengePayload, MatchResultPayload, ParticipantProgressPayload } from '../schemas/matchSchema.js'
import { saveSession } from './sessionService.js'
import { MatchServiceError } from './matchServiceErrors.js'
import { challengeRunDurationSeconds, MATCH_IN_PROGRESS_GRACE_MS } from './matchServiceTiming.js'
import { MATCH_INCLUDE, enrichMatchView, enrichMatchViews, toMatchView, type MatchView } from './matchServiceView.js'
import {
  buildValidatedSessionPayload,
  calculateAccuracy,
  expectedTempoQuestion,
  expectedSprintQuestion,
  finalizeMatchIfDone,
  progressForParticipant,
  recomputeBestStreak,
  tempoQuestionAnswerUpsert,
} from './matchServiceResults.js'

export { MatchServiceError } from './matchServiceErrors.js'
export { challengeRunDurationSeconds, MATCH_IN_PROGRESS_GRACE_MS } from './matchServiceTiming.js'
export { persistTempoQuestionAnswer } from './matchServiceResults.js'
export type {
  ChallengeOutcomeStats,
  MatchParticipantView,
  MatchView,
  ParticipantChallengeStats,
} from './matchServiceView.js'

const ACTIVE_MATCH_STATUSES = ['pending', 'accepted', 'ready', 'in_progress'] as const
const PENDING_MATCH_TTL_MS = 20 * 60 * 1000
const ACCEPTED_MATCH_TTL_MS = 10 * 60 * 1000
const COMPLETED_ROOM_TTL_MS = 2 * 60 * 1000
const HOST_ROOM_GRACE_MS = 2 * 60 * 1000

export type TempoQuestionProgress = {
  questionIndex: number
  answeredCount: number
  expectedAnswerCount: number
  complete: boolean
  nextQuestionIndex: number
}

export type PersistedChallengeConfig = {
  game: string | null
  level: string | null
  practiceSkill: string | null
  challengeMode: string | null
  durationSeconds: number
  questionCount: number | null
  perQuestionTimeLimitSeconds: number | null
  questionSeed: string | null
  configVersion: number
}

export async function assertMatchRoomMembership(playerId: string, roomIdOrMatchId: string) {
  const match = await prisma.match.findFirst({
    where: {
      OR: [
        { id: roomIdOrMatchId },
        { roomId: roomIdOrMatchId },
      ],
      participants: {
        some: { playerId },
      },
    },
    select: { id: true, roomId: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_participant')
  }

  return match
}

function expiresIn(ms: number) {
  return new Date(Date.now() + ms)
}

function inProgressExpiresAt(config: Parameters<typeof challengeRunDurationSeconds>[0], startedAt: Date) {
  return new Date(startedAt.getTime() + challengeRunDurationSeconds(config) * 1000 + MATCH_IN_PROGRESS_GRACE_MS)
}

function isRecentHostHeartbeat(hostActiveAt: Date | null) {
  return Boolean(hostActiveAt && Date.now() - hostActiveAt.getTime() <= HOST_ROOM_GRACE_MS)
}

function visibleMatchWhere(playerId: string, now: Date) {
  return {
    participants: {
      some: { playerId },
    },
    OR: [
      { status: { in: [...ACTIVE_MATCH_STATUSES] }, expiresAt: { gt: now } },
      {
        status: 'completed',
        expiresAt: { gt: now },
        participants: { some: { playerId, resultDismissedAt: null } },
      },
    ],
  }
}

async function cancelPlayerOpenOwnedMatches(playerId: string) {
  await prisma.match.updateMany({
    where: {
      createdById: playerId,
      status: { in: ['pending', 'accepted', 'ready'] },
    },
    data: {
      status: 'cancelled',
      finishedAt: new Date(),
    },
  })
}

async function cancelOpenDirectMatches(firstPlayerId: string, secondPlayerId: string) {
  await prisma.match.updateMany({
    where: {
      type: 'challenge',
      status: { in: ['pending', 'accepted', 'ready'] },
      participants: {
        some: { playerId: firstPlayerId },
      },
      AND: [
        {
          participants: {
            some: { playerId: secondPlayerId },
          },
        },
      ],
    },
    data: {
      status: 'cancelled',
      finishedAt: new Date(),
    },
  })
}

async function assertFriends(playerId: string, otherPlayerId: string) {
  const friendship = await prisma.friendship.findUnique({
    where: { playerAId_playerBId: canonicalPairIds(playerId, otherPlayerId) },
    select: { id: true },
  })

  if (!friendship) {
    throw new MatchServiceError('not_friends')
  }
}

function assertCompleteConfig(match: {
  game: string | null
  level: string | null
  challengeMode: string | null
  questionCount?: number | null
  perQuestionTimeLimitSeconds?: number | null
}) {
  if (!match.game || !match.level || !match.challengeMode) {
    throw new MatchServiceError('match_config_incomplete')
  }

  if (match.challengeMode === 'tempo' && (!match.questionCount || !match.perQuestionTimeLimitSeconds)) {
    throw new MatchServiceError('match_config_incomplete')
  }
}

function assertStartableConfig(config: PersistedChallengeConfig) {
  assertCompleteConfig(config)

  if (!config.questionSeed) {
    throw new MatchServiceError('match_config_incomplete')
  }

  if (config.challengeMode === 'tempo' && (!config.questionCount || !config.perQuestionTimeLimitSeconds)) {
    throw new MatchServiceError('match_config_incomplete')
  }
}

function persistedChallengeConfigData(config: PersistedChallengeConfig) {
  return {
    game: config.game,
    level: config.level,
    practiceSkill: config.practiceSkill,
    challengeMode: config.challengeMode,
    durationSeconds: config.durationSeconds,
    questionCount: config.questionCount,
    perQuestionTimeLimitSeconds: config.perQuestionTimeLimitSeconds,
    questionSeed: config.questionSeed,
    configVersion: config.configVersion,
  }
}

function assertExpectedConfigVersion(currentVersion: number, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    throw new MatchServiceError('match_version_conflict')
  }
}

type CreateChallengeOptions = {
  matchId?: string
  roomId?: string
  creatorParticipantId?: string
  opponentParticipantId?: string
  onPersisted?: MatchMutationEffects
}

export type MatchMutationEffects = (tx: Prisma.TransactionClient, match: MatchView) => Promise<void>

export async function createChallenge(creatorPlayerId: string, payload: ChallengePayload, options: CreateChallengeOptions = {}) {
  if (creatorPlayerId === payload.opponentPlayerId) {
    throw new MatchServiceError('self_challenge')
  }

  await assertFriends(creatorPlayerId, payload.opponentPlayerId)
  await Promise.all([
    cancelPlayerOpenOwnedMatches(creatorPlayerId),
    cancelOpenDirectMatches(creatorPlayerId, payload.opponentPlayerId),
  ])

  const hasCompleteConfig = Boolean(payload.game && payload.level && payload.challengeMode)
  const config = payload.challengeMode && hasCompleteConfig
    ? buildChallengeConfig({
        challengeMode: payload.challengeMode,
        durationSeconds: payload.durationSeconds,
        questionCount: payload.questionCount,
        perQuestionTimeLimitSeconds: payload.perQuestionTimeLimitSeconds,
      })
    : null
  const match = await prisma.$transaction(async (tx) => {
    const persistedMatch = await tx.match.create({
      data: {
        id: options.matchId,
        roomId: options.roomId ?? `room_${randomUUID()}`,
        type: 'challenge',
        challengeMode: config?.challengeMode ?? null,
        status: 'pending',
        game: payload.game ?? null,
        level: payload.level ?? null,
        practiceSkill: payload.practiceSkill ?? null,
        durationSeconds: config?.durationSeconds ?? 60,
        questionCount: config?.questionCount ?? null,
        perQuestionTimeLimitSeconds: config?.perQuestionTimeLimitSeconds ?? null,
        questionSeed: config?.questionSeed ?? null,
        createdById: creatorPlayerId,
        expiresAt: expiresIn(PENDING_MATCH_TTL_MS),
        hostActiveAt: new Date(),
        participants: {
          create: [
            {
              id: options.creatorParticipantId,
              playerId: creatorPlayerId,
              status: 'accepted',
              joinedAt: new Date(),
            },
            {
              id: options.opponentParticipantId,
              playerId: payload.opponentPlayerId,
              status: 'invited',
            },
          ],
        },
      },
      include: MATCH_INCLUDE,
    })
    const matchView = toMatchView(persistedMatch)
    await options.onPersisted?.(tx, matchView)
    return persistedMatch
  })

  return toMatchView(match)
}

export async function listMatches(playerId: string) {
  const now = new Date()

  const matches = await prisma.match.findMany({
    where: visibleMatchWhere(playerId, now),
    include: MATCH_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return enrichMatchViews(matches)
}

export async function getMatch(playerId: string, matchId: string) {
  const now = new Date()

  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      ...visibleMatchWhere(playerId, now),
    },
    include: MATCH_INCLUDE,
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  return enrichMatchView(match)
}

export async function acceptChallenge(playerId: string, matchId: string, onPersisted?: MatchMutationEffects) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: MATCH_INCLUDE,
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'pending') {
    throw new MatchServiceError('match_not_pending')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status !== 'invited') {
    throw new MatchServiceError('participant_not_invited')
  }

  const acceptedMatch = await prisma.$transaction(async (tx) => {
    const claimed = await tx.match.updateMany({
      where: { id: match.id, status: 'pending', expiresAt: { gt: new Date() } },
      data: { status: 'accepted', expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS) },
    })
    if (claimed.count === 0) throw new MatchServiceError('match_not_pending')

    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: { status: 'accepted', joinedAt: new Date() },
    })
    const persistedMatch = await tx.match.findUniqueOrThrow({ where: { id: match.id }, include: MATCH_INCLUDE })
    await onPersisted?.(tx, toMatchView(persistedMatch))
    return persistedMatch
  })

  return enrichMatchView(acceptedMatch)
}

export async function declineChallenge(playerId: string, matchId: string, onPersisted?: MatchMutationEffects) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: MATCH_INCLUDE,
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'pending') {
    throw new MatchServiceError('match_not_pending')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status !== 'invited') {
    throw new MatchServiceError('participant_not_invited')
  }

  const cancelledMatch = await prisma.$transaction(async (tx) => {
    const claimed = await tx.match.updateMany({
      where: { id: match.id, status: 'pending', expiresAt: { gt: new Date() } },
      data: { status: 'cancelled', finishedAt: new Date() },
    })
    if (claimed.count === 0) throw new MatchServiceError('match_not_pending')

    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: { status: 'declined' },
    })

    const persistedMatch = await tx.match.findUniqueOrThrow({ where: { id: match.id }, include: MATCH_INCLUDE })
    await onPersisted?.(tx, toMatchView(persistedMatch))
    return persistedMatch
  })

  return enrichMatchView(cancelledMatch)
}

export async function updateChallengeConfig(playerId: string, matchId: string, payload: ChallengeConfigPayload) {
  const hasCompleteConfig = Boolean(payload.game && payload.level && payload.challengeMode)
  const config = payload.challengeMode && hasCompleteConfig
    ? buildChallengeConfig({
        challengeMode: payload.challengeMode,
        durationSeconds: payload.durationSeconds,
        questionCount: payload.questionCount,
        perQuestionTimeLimitSeconds: payload.perQuestionTimeLimitSeconds,
      })
    : null

  const now = new Date()
  try {
    const fastUpdatedMatch = await prisma.match.update({
      where: {
        id: matchId,
        createdById: playerId,
        participants: { some: { playerId } },
        status: { in: ['pending', 'accepted'] },
        expiresAt: { gt: now },
        ...(payload.expectedConfigVersion !== undefined ? { configVersion: payload.expectedConfigVersion } : {}),
      },
      data: {
        game: payload.game ?? null,
        level: payload.level ?? null,
        practiceSkill: payload.practiceSkill ?? null,
        challengeMode: payload.challengeMode ?? null,
        durationSeconds: config?.durationSeconds ?? payload.durationSeconds ?? 60,
        questionCount: config?.questionCount ?? null,
        perQuestionTimeLimitSeconds: config?.perQuestionTimeLimitSeconds ?? null,
        questionSeed: config?.questionSeed ?? null,
        expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
        configVersion: { increment: 1 },
      },
      include: MATCH_INCLUDE,
    })

    return enrichMatchView(fastUpdatedMatch)
  } catch {
    // Classify the miss below. The success path remains one DB round-trip.
  }

  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    select: {
      id: true,
      createdById: true,
      status: true,
      configVersion: true,
      expiresAt: true,
    },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById !== playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'pending' && match.status !== 'accepted' && match.status !== 'ready') {
    throw new MatchServiceError('match_not_pending')
  }

  if (match.expiresAt.getTime() <= now.getTime()) {
    throw new MatchServiceError('match_not_pending')
  }

  assertExpectedConfigVersion(match.configVersion, payload.expectedConfigVersion)

  if (match.status !== 'ready') {
    throw new MatchServiceError('match_version_conflict')
  }

  try {
    const readyUpdatedMatch = await prisma.match.update({
      where: {
        id: match.id,
        createdById: playerId,
        status: 'ready',
        ...(payload.expectedConfigVersion !== undefined ? { configVersion: payload.expectedConfigVersion } : {}),
      },
      data: {
        game: payload.game ?? null,
        level: payload.level ?? null,
        practiceSkill: payload.practiceSkill ?? null,
        challengeMode: payload.challengeMode ?? null,
        durationSeconds: config?.durationSeconds ?? payload.durationSeconds ?? 60,
        questionCount: config?.questionCount ?? null,
        perQuestionTimeLimitSeconds: config?.perQuestionTimeLimitSeconds ?? null,
        questionSeed: config?.questionSeed ?? null,
        status: 'accepted',
        expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
        configVersion: { increment: 1 },
      },
      include: MATCH_INCLUDE,
    })

    return enrichMatchView(readyUpdatedMatch)
  } catch {
    throw new MatchServiceError('match_version_conflict')
  }
}

export async function proposeChallenge(playerId: string, matchId: string, config?: ChallengeConfigPayload | PersistedChallengeConfig) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById !== playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'accepted') {
    throw new MatchServiceError('match_not_accepted')
  }

  let proposedConfig: PersistedChallengeConfig | null = null

  if (config && 'questionSeed' in config) {
    proposedConfig = config
  } else if (config) {
    const challengeMode = config.challengeMode ?? match.challengeMode

    if (challengeMode !== 'sprint' && challengeMode !== 'tempo') {
      throw new MatchServiceError('match_config_incomplete')
    }

    proposedConfig = {
      game: config.game ?? match.game,
      level: config.level ?? match.level,
      practiceSkill: config.practiceSkill ?? match.practiceSkill,
      ...buildChallengeConfig({
        challengeMode,
        durationSeconds: config.durationSeconds ?? match.durationSeconds,
        questionCount: config.questionCount ?? match.questionCount ?? undefined,
        perQuestionTimeLimitSeconds: config.perQuestionTimeLimitSeconds ?? match.perQuestionTimeLimitSeconds ?? undefined,
      }),
      configVersion: match.configVersion + 1,
    }
  }

  if (proposedConfig) {
    const expectedVersion = config && 'expectedConfigVersion' in config ? config.expectedConfigVersion : undefined
    assertExpectedConfigVersion(match.configVersion, expectedVersion)
    assertStartableConfig(proposedConfig)
  } else {
    assertCompleteConfig(match)
  }

  const allAccepted = match.participants.every((participant) => participant.status === 'accepted')

  if (!allAccepted) {
    throw new MatchServiceError('participant_not_invited')
  }

  const updatedMatch = await prisma.match.updateMany({
    where: { id: match.id, status: 'accepted', configVersion: match.configVersion },
    data: {
      ...(proposedConfig ? persistedChallengeConfigData(proposedConfig) : {}),
      status: 'ready',
      expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
    },
  })

  if (updatedMatch.count === 0) {
    const latestMatch = await getMatch(playerId, matchId)

    if (latestMatch.status === 'ready' || latestMatch.status === 'in_progress' || latestMatch.status === 'completed') {
      return latestMatch
    }

    throw new MatchServiceError('match_not_accepted')
  }

  return getMatch(playerId, matchId)
}

export async function startChallengeProposal(
  playerId: string,
  matchId: string,
  config: PersistedChallengeConfig,
  startedAt: Date,
) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status === 'in_progress' || match.status === 'completed') {
    return getMatch(playerId, matchId)
  }

  if (match.createdById === playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'ready' && match.status !== 'accepted') {
    throw new MatchServiceError('match_not_ready')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant || participant.status !== 'accepted') {
    throw new MatchServiceError('match_not_participant')
  }

  if (!match.participants.every((item) => item.status === 'accepted')) {
    throw new MatchServiceError('participant_not_invited')
  }

  assertStartableConfig(config)

  const updatedMatch = await prisma.$transaction(async (tx) => {
    const lock = await tx.match.updateMany({
      where: {
        id: match.id,
        status: { in: ['accepted', 'ready'] },
      },
      data: {
        ...persistedChallengeConfigData(config),
        status: 'in_progress',
        startedAt,
        expiresAt: inProgressExpiresAt(config, startedAt),
      },
    })

    if (lock.count === 0) {
      return null
    }

    await tx.matchParticipant.updateMany({
      where: { matchId: match.id },
      data: { status: 'playing' },
    })

    return tx.match.findUnique({
      where: { id: match.id },
      include: MATCH_INCLUDE,
    })
  })

  if (!updatedMatch) {
    const latestMatch = await getMatch(playerId, matchId)

    if (latestMatch.status === 'in_progress' || latestMatch.status === 'completed') {
      return latestMatch
    }

    throw new MatchServiceError('match_not_ready')
  }

  return enrichMatchView(updatedMatch)
}

export async function acceptChallengeProposal(playerId: string, matchId: string) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById === playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'ready' && match.status !== 'accepted') {
    throw new MatchServiceError('match_not_ready')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant || participant.status !== 'accepted') {
    throw new MatchServiceError('match_not_participant')
  }

  assertCompleteConfig(match)

  const startedAt = new Date()

  await prisma.$transaction([
    prisma.match.update({
      where: { id: match.id },
      data: { status: 'in_progress', startedAt, expiresAt: inProgressExpiresAt(match, startedAt) },
    }),
    prisma.matchParticipant.updateMany({
      where: { matchId: match.id },
      data: { status: 'playing' },
    }),
  ])

  return getMatch(playerId, matchId)
}

export async function declineChallengeProposal(playerId: string, matchId: string) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById === playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'ready') {
    throw new MatchServiceError('match_not_ready')
  }

  await prisma.match.update({
    where: { id: match.id },
    data: {
      status: 'accepted',
      expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
      configVersion: { increment: 1 },
    },
  })

  return getMatch(playerId, matchId)
}

export async function completeChallengeResult(playerId: string, matchId: string, payload: MatchResultPayload, timeZone?: string | null) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'in_progress') {
    if (match.status === 'completed') {
      return getMatch(playerId, matchId)
    }

    throw new MatchServiceError('match_not_in_progress')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status === 'completed' || participant.sessionId) {
    return getMatch(playerId, matchId)
  }

  if (participant.status !== 'playing') {
    throw new MatchServiceError('match_not_participant')
  }

  const { sessionPayload, correctAnswers, totalQuestions, totalResponseTimeMs } = buildValidatedSessionPayload(match, payload)
  const score = calculateAccuracy(correctAnswers, totalQuestions)
  const lockResult = await prisma.matchParticipant.updateMany({
    where: { id: participant.id, status: 'playing', sessionId: null },
    data: { status: 'submitting' },
  })

  if (lockResult.count === 0) {
    return getMatch(playerId, matchId)
  }

  let sessionResult: Awaited<ReturnType<typeof saveSession>> | null = null
  const now = new Date()

  if (totalQuestions > 0) {
    try {
      sessionResult = await saveSession(playerId, sessionPayload, timeZone, {
        submissionKey: `match:${match.id}:participant:${participant.id}`,
        dailyMissionContext: {
          playContext: 'multiplayer',
          challengeMode: match.challengeMode as 'sprint' | 'tempo',
          completedWithoutAbandonment: completedMatchForDailyMissions(
            match,
            totalQuestions,
            now,
            participant.forfeitedAt,
          ),
          configuredDurationSeconds: match.challengeMode === 'sprint' ? match.durationSeconds : null,
          configuredQuestionCount: match.challengeMode === 'tempo' ? match.questionCount : null,
          configuredQuestionSeconds: match.challengeMode === 'tempo' ? match.perQuestionTimeLimitSeconds : null,
        },
      })
    } catch (error) {
      await prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { status: 'playing' },
      })
      throw error
    }
  }

  const updatedMatch = await prisma.$transaction(async (tx) => {
    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: {
        status: 'completed',
        score,
        scorePoints: sessionResult?.scorePoints ?? 0,
        xp: sessionResult ? sessionResult.xpEarned + sessionResult.missionXpEarned : 0,
        correctAnswers,
        totalQuestions,
        totalResponseTimeMs,
        bestStreak: sessionPayload.bestStreak,
        sessionId: sessionResult?.sessionId ?? null,
        finishedAt: now,
      },
    })

    const participants = await tx.matchParticipant.findMany({
      where: { matchId: match.id },
      select: {
        playerId: true,
        status: true,
        scorePoints: true,
        correctAnswers: true,
        totalResponseTimeMs: true,
        finishedAt: true,
      },
    })
    const allDone = participants.every((item) => item.status === 'completed' || item.status === 'disconnected' || item.status === 'declined')

    if (!allDone) {
      return null
    }

    const winnerPlayerId = determineMatchWinner(participants)

    return tx.match.update({
      where: { id: match.id },
      data: {
        status: 'completed',
        winnerPlayerId,
        finishedAt: now,
        expiresAt: expiresIn(COMPLETED_ROOM_TTL_MS),
      },
      include: MATCH_INCLUDE,
    })
  })

  const finalizedMatch = updatedMatch ?? await finalizeMatchIfDone(match.id)

  return finalizedMatch ? enrichMatchView(finalizedMatch) : getMatch(playerId, matchId)
}

export async function submitTempoQuestionAnswer(playerId: string, matchId: string, payload: TempoAnswerPayload) {
  const now = new Date()

  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
      expiresAt: { gt: now },
    },
    include: MATCH_INCLUDE,
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'in_progress') {
    throw new MatchServiceError('match_not_in_progress')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant || participant.status !== 'playing') {
    throw new MatchServiceError('match_not_participant')
  }

  expectedTempoQuestion(match, payload)

  const [, answeredCount] = await prisma.$transaction([
    tempoQuestionAnswerUpsert(playerId, match.id, payload),
    prisma.matchQuestionAnswer.count({
      where: { matchId: match.id, questionIndex: payload.questionIndex },
    }),
  ])
  const expectedAnswerCount = match.participants.filter((item) =>
    item.status === 'playing' || item.status === 'submitting' || item.status === 'completed',
  ).length
  const complete = expectedAnswerCount > 0 && answeredCount >= expectedAnswerCount

  return {
    match: toMatchView(match),
    progress: {
      questionIndex: payload.questionIndex,
      answeredCount,
      expectedAnswerCount,
      complete,
      nextQuestionIndex: payload.questionIndex + 1,
    },
  }
}

export async function submitSprintQuestionAnswer(playerId: string, matchId: string, payload: TempoAnswerPayload) {
  const now = new Date()
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
      expiresAt: { gt: now },
    },
    include: MATCH_INCLUDE,
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'in_progress') {
    throw new MatchServiceError('match_not_in_progress')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant || participant.status !== 'playing') {
    throw new MatchServiceError('match_not_participant')
  }

  expectedSprintQuestion(match, payload)

  await prisma.$transaction(async (tx) => {
    await tx.matchQuestionAnswer.upsert({
      where: {
        matchId_playerId_questionIndex: {
          matchId: match.id,
          playerId,
          questionIndex: payload.questionIndex,
        },
      },
      update: {},
      create: {
        matchId: match.id,
        playerId,
        questionIndex: payload.questionIndex,
        prompt: payload.prompt,
        correctAnswer: payload.correctAnswer,
        userAnswer: payload.userAnswer,
        responseTimeMs: payload.responseTimeMs,
        skill: payload.skill,
      },
    })

    const answers = await tx.matchQuestionAnswer.findMany({
      where: { matchId: match.id, playerId },
      orderBy: { questionIndex: 'asc' },
    })
    const evaluatedAnswers = answers.map((answer) => ({
      responseTimeMs: answer.responseTimeMs,
      isCorrect: answer.userAnswer === answer.correctAnswer,
    }))
    const correctAnswers = evaluatedAnswers.filter((answer) => answer.isCorrect).length
    const totalQuestions = evaluatedAnswers.length

    await tx.matchParticipant.update({
      where: { id: participant.id },
      data: {
        score: calculateAccuracy(correctAnswers, totalQuestions),
        scorePoints: calculateSessionScorePoints(match.level as Parameters<typeof calculateSessionScorePoints>[0], evaluatedAnswers),
        correctAnswers,
        totalQuestions,
        totalResponseTimeMs: answers.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
        bestStreak: recomputeBestStreak(evaluatedAnswers),
      },
    })
  })

  return getMatch(playerId, match.id)
}

export async function forfeitChallenge(playerId: string, matchId: string, participantProgressByPlayerId: Record<string, ParticipantProgressPayload> = {}) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'in_progress') {
    throw new MatchServiceError(match.status === 'completed' ? 'match_already_completed' : 'match_not_in_progress')
  }

  const forfeitingParticipant = match.participants.find((item) => item.playerId === playerId)
  const winningParticipant = match.participants.find((item) => item.playerId !== playerId)

  if (!forfeitingParticipant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (forfeitingParticipant.status !== 'playing' && forfeitingParticipant.status !== 'submitting') {
    throw new MatchServiceError('match_not_participant')
  }

  const now = new Date()
  const forfeitingProgress = progressForParticipant(forfeitingParticipant, participantProgressByPlayerId[forfeitingParticipant.playerId])
  const winningProgress = winningParticipant ? progressForParticipant(winningParticipant, participantProgressByPlayerId[winningParticipant.playerId]) : null

  const completedMatch = await prisma.$transaction(async (tx) => {
    await tx.matchParticipant.update({
      where: { id: forfeitingParticipant.id },
      data: {
        status: 'completed',
        score: forfeitingProgress.score,
        scorePoints: forfeitingProgress.scorePoints,
        xp: 0,
        correctAnswers: forfeitingProgress.correctAnswers,
        totalQuestions: forfeitingProgress.totalQuestions,
        totalResponseTimeMs: forfeitingProgress.totalResponseTimeMs,
        bestStreak: forfeitingProgress.bestStreak,
        sessionId: null,
        finishedAt: now,
        forfeitedAt: now,
      },
    })

    if (winningParticipant && winningParticipant.status !== 'completed') {
      await tx.matchParticipant.update({
        where: { id: winningParticipant.id },
        data: {
          status: 'completed',
          score: winningProgress?.score ?? 0,
          scorePoints: winningProgress?.scorePoints ?? 0,
          xp: winningParticipant.xp ?? 0,
          correctAnswers: winningProgress?.correctAnswers ?? 0,
          totalQuestions: winningProgress?.totalQuestions ?? 0,
          totalResponseTimeMs: winningProgress?.totalResponseTimeMs ?? 0,
          bestStreak: winningProgress?.bestStreak ?? 0,
          finishedAt: now,
          forfeitedAt: null,
        },
      })
    }

    return tx.match.update({
      where: { id: match.id },
      data: {
        status: 'completed',
        winnerPlayerId: winningParticipant?.playerId ?? null,
        finishedAt: now,
        expiresAt: expiresIn(COMPLETED_ROOM_TTL_MS),
      },
      include: MATCH_INCLUDE,
    })
  })

  return enrichMatchView(completedMatch)
}

export async function requestChallengeRematch(playerId: string, matchId: string) {
  const now = new Date()

  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.status !== 'completed') {
    throw new MatchServiceError('match_not_completed')
  }

  if (match.expiresAt <= now) {
    throw new MatchServiceError('match_rematch_unavailable')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (match.participants.some((item) => item.id !== participant.id && item.resultDismissedAt)) {
    throw new MatchServiceError('match_rematch_unavailable')
  }

  assertCompleteConfig(match)

  const updatedParticipant = await prisma.matchParticipant.updateMany({
    where: { id: participant.id },
    data: { rematchRequestedAt: now },
  })

  if (updatedParticipant.count === 0) {
    throw new MatchServiceError('match_not_participant')
  }

  const participants = await prisma.matchParticipant.findMany({
    where: { matchId },
    orderBy: { joinedAt: 'asc' },
  })
  const allRequested = participants.every((item) => item.id === participant.id || item.rematchRequestedAt)

  if (!allRequested) {
    return getMatch(playerId, matchId)
  }

  const config = buildChallengeConfig({
    challengeMode: match.challengeMode as 'sprint' | 'tempo',
    durationSeconds: match.durationSeconds,
    questionCount: match.questionCount ?? undefined,
    perQuestionTimeLimitSeconds: match.perQuestionTimeLimitSeconds ?? undefined,
  })
  const rematch = await prisma.match.create({
    data: {
      type: 'challenge',
      challengeMode: config.challengeMode,
      status: 'accepted',
      game: match.game,
      level: match.level,
      practiceSkill: match.practiceSkill,
      durationSeconds: config.durationSeconds,
      questionCount: config.questionCount,
      perQuestionTimeLimitSeconds: config.perQuestionTimeLimitSeconds,
      questionSeed: config.questionSeed,
      createdById: match.createdById,
      roomId: match.roomId ?? match.id,
      expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
      hostActiveAt: now,
      participants: {
        create: participants.map((item) => ({
          playerId: item.playerId,
          status: 'accepted',
          joinedAt: now,
        })),
      },
    },
    include: MATCH_INCLUDE,
  })

  return enrichMatchView(rematch)
}

export async function heartbeatChallengeHost(playerId: string, matchId: string) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    select: {
      id: true,
      createdById: true,
      status: true,
    },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById !== playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (!ACTIVE_MATCH_STATUSES.includes(match.status as (typeof ACTIVE_MATCH_STATUSES)[number])) {
    throw new MatchServiceError('match_not_pending')
  }

  const updateResult = await prisma.match.updateMany({
    where: { id: match.id },
    data: { hostActiveAt: new Date() },
  })

  if (updateResult.count === 0) {
    throw new MatchServiceError('match_not_found')
  }

  return getMatch(playerId, matchId)
}

export async function transferChallengeHost(playerId: string, matchId: string) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  if (match.createdById !== playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (match.status !== 'accepted' && match.status !== 'ready') {
    throw new MatchServiceError('match_host_transfer_unavailable')
  }

  const nextHost = match.participants.find((participant) => participant.playerId !== playerId && participant.status === 'accepted')

  if (!nextHost) {
    throw new MatchServiceError('match_host_transfer_unavailable')
  }

  await prisma.match.update({
    where: { id: match.id },
    data: {
      createdById: nextHost.playerId,
      status: 'accepted',
      hostActiveAt: new Date(),
      expiresAt: expiresIn(ACCEPTED_MATCH_TTL_MS),
      configVersion: { increment: 1 },
    },
  })

  return getMatch(playerId, matchId)
}

export async function leaveChallenge(playerId: string, matchId: string, onPersisted?: MatchMutationEffects) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      participants: { some: { playerId } },
    },
    include: { participants: true },
  })

  if (!match) {
    throw new MatchServiceError('match_not_found')
  }

  const participant = match.participants.find((item) => item.playerId === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (!ACTIVE_MATCH_STATUSES.includes(match.status as (typeof ACTIVE_MATCH_STATUSES)[number])) {
    if (match.status === 'completed') {
      const now = new Date()

      const dismissedMatch = await prisma.$transaction(async (tx) => {
        await tx.matchParticipant.updateMany({
          where: { matchId: match.id },
          data: { resultDismissedAt: now, rematchRequestedAt: null },
        })
        await tx.match.update({
          where: { id: match.id },
          data: { expiresAt: now },
        })
        const persistedMatch = await tx.match.findUniqueOrThrow({ where: { id: match.id }, include: MATCH_INCLUDE })
        await onPersisted?.(tx, toMatchView(persistedMatch))
        return persistedMatch
      })

      return enrichMatchView(dismissedMatch)
    }

    return getMatch(playerId, matchId)
  }

  const now = new Date()
  const closedParticipantStatus = match.status === 'in_progress' ? 'disconnected' : 'declined'
  const closedMatch = await prisma.$transaction(async (tx) => {
    await tx.matchParticipant.updateMany({
      where: { matchId: match.id },
      data: {
        status: closedParticipantStatus,
        finishedAt: now,
        rematchRequestedAt: null,
      },
    })

    const persistedMatch = await tx.match.update({
      where: { id: match.id },
      data: { status: 'cancelled', finishedAt: now, expiresAt: now },
      include: MATCH_INCLUDE,
    })
    const matchView = toMatchView(persistedMatch)
    await onPersisted?.(tx, matchView)
    return persistedMatch
  })

  return enrichMatchView(closedMatch)
}
