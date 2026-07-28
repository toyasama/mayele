import { prisma } from '../lib/prisma.js'
import type { PublicPlayer } from './friendService.js'
import { challengeRunDurationSeconds } from './matchServiceTiming.js'

export const PUBLIC_PLAYER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  totalXp: true,
  presenceStatus: true,
  presenceUpdatedAt: true,
} as const

export const MATCH_INCLUDE = {
  createdBy: { select: PUBLIC_PLAYER_SELECT },
  participants: {
    include: {
      player: { select: PUBLIC_PLAYER_SELECT },
    },
    orderBy: { joinedAt: 'asc' as const },
  },
} as const

export type MatchParticipantView = {
  id: string
  playerId: string
  status: string
  preferredChallengeMode: string | null
  preferredGame: string | null
  preferredLevel: string | null
  score: number | null
  scorePoints: number
  xp: number | null
  correctAnswers: number
  totalQuestions: number
  totalResponseTimeMs: number
  bestStreak: number
  joinedAt: Date | null
  finishedAt: Date | null
  forfeitedAt: Date | null
  rematchRequestedAt: Date | null
  resultDismissedAt: Date | null
  challengeStats: ParticipantChallengeStats
  player: PublicPlayer
}

export type ChallengeOutcomeStats = {
  wins: number
  losses: number
  draws: number
}

export type ParticipantChallengeStats = {
  room: ChallengeOutcomeStats
  friendship: ChallengeOutcomeStats
}

export type MatchView = {
  id: string
  roomId: string | null
  type: string
  challengeMode: string | null
  status: string
  game: string | null
  level: string | null
  practiceSkill: string | null
  durationSeconds: number
  questionCount: number | null
  perQuestionTimeLimitSeconds: number | null
  questionSeed: string | null
  configVersion: number
  winnerPlayerId: string | null
  createdAt: Date
  expiresAt: Date
  hostActiveAt: Date | null
  startedAt: Date | null
  endsAt: Date | null
  finishedAt: Date | null
  createdBy: PublicPlayer
  participants: MatchParticipantView[]
}

function emptyOutcomeStats(): ChallengeOutcomeStats {
  return { wins: 0, losses: 0, draws: 0 }
}

function emptyParticipantChallengeStats(): ParticipantChallengeStats {
  return {
    room: emptyOutcomeStats(),
    friendship: emptyOutcomeStats(),
  }
}

function applyChallengeOutcome(
  statsByPlayerId: Map<string, ParticipantChallengeStats>,
  scope: keyof ParticipantChallengeStats,
  match: { winnerPlayerId: string | null; participants: Array<{ playerId: string }> },
) {
  const participantIds = match.participants.map((participant) => participant.playerId).filter((playerId) => statsByPlayerId.has(playerId))

  if (participantIds.length < 2) {
    return
  }

  if (!match.winnerPlayerId) {
    for (const playerId of participantIds) {
      statsByPlayerId.get(playerId)![scope].draws += 1
    }
    return
  }

  for (const playerId of participantIds) {
    const stats = statsByPlayerId.get(playerId)![scope]

    if (playerId === match.winnerPlayerId) {
      stats.wins += 1
    } else {
      stats.losses += 1
    }
  }
}

async function buildChallengeStatsForMatch(match: {
  id: string
  roomId: string | null
  participants: Array<{ player: { id: string } }>
}) {
  const playerIds = match.participants.map((participant) => participant.player.id)
  const [firstPlayerId, secondPlayerId] = playerIds
  const statsByPlayerId = new Map(playerIds.map((playerId) => [playerId, emptyParticipantChallengeStats()]))

  if (!firstPlayerId || !secondPlayerId) {
    return statsByPlayerId
  }

  const [roomMatches, friendshipMatches] = await Promise.all([
    prisma.match.findMany({
      where: {
        type: 'challenge',
        status: 'completed',
        roomId: match.roomId ?? match.id,
      },
      select: {
        winnerPlayerId: true,
        participants: { select: { playerId: true } },
      },
    }),
    prisma.match.findMany({
      where: {
        type: 'challenge',
        status: 'completed',
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
      select: {
        winnerPlayerId: true,
        participants: { select: { playerId: true } },
      },
    }),
  ])

  for (const roomMatch of roomMatches) {
    applyChallengeOutcome(statsByPlayerId, 'room', roomMatch)
  }

  for (const friendshipMatch of friendshipMatches) {
    applyChallengeOutcome(statsByPlayerId, 'friendship', friendshipMatch)
  }

  return statsByPlayerId
}

export function toMatchView(match: {
  id: string
  roomId: string | null
  type: string
  challengeMode: string | null
  status: string
  game: string | null
  level: string | null
  practiceSkill: string | null
  durationSeconds: number
  questionCount: number | null
  perQuestionTimeLimitSeconds: number | null
  questionSeed: string | null
  configVersion: number
  winnerPlayerId: string | null
  createdAt: Date
  expiresAt: Date
  hostActiveAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
  createdBy: PublicPlayer
  participants: Array<Omit<MatchParticipantView, 'challengeStats'>>
}, challengeStatsByPlayerId = new Map<string, ParticipantChallengeStats>()): MatchView {
  return {
    ...match,
    endsAt: match.startedAt ? new Date(match.startedAt.getTime() + challengeRunDurationSeconds(match) * 1000) : null,
    participants: match.participants.map((participant) => ({
      ...participant,
      challengeStats: challengeStatsByPlayerId.get(participant.player.id) ?? emptyParticipantChallengeStats(),
    })),
  }
}

export async function enrichMatchView(match: Parameters<typeof toMatchView>[0]) {
  return toMatchView(match, await buildChallengeStatsForMatch(match))
}

/**
 * Enrich a list with one history query instead of two history queries per
 * match. The room overview is polled frequently, so the previous N+1 shape
 * multiplied database work as the number of visible challenges grew.
 */
export async function enrichMatchViews(matches: Array<Parameters<typeof toMatchView>[0]>) {
  if (!matches.length) {
    return []
  }

  const roomIds = [...new Set(matches.map((match) => match.roomId ?? match.id))]
  const pairs = new Map<string, [string, string]>()

  for (const match of matches) {
    const playerIds = match.participants.map((participant) => participant.player.id)
    const firstPlayerId = playerIds[0]
    const secondPlayerId = playerIds[1]

    if (!firstPlayerId || !secondPlayerId) {
      continue
    }

    const pair = [firstPlayerId, secondPlayerId].sort() as [string, string]
    pairs.set(pair.join(':'), pair)
  }

  const completedMatches = await prisma.match.findMany({
    where: {
      type: 'challenge',
      status: 'completed',
      OR: [
        { roomId: { in: roomIds } },
        ...Array.from(pairs.values()).map(([firstPlayerId, secondPlayerId]) => ({
          participants: { some: { playerId: firstPlayerId } },
          AND: [{ participants: { some: { playerId: secondPlayerId } } }],
        })),
      ],
    },
    select: {
      roomId: true,
      winnerPlayerId: true,
      participants: { select: { playerId: true } },
    },
  })

  return matches.map((match) => {
    const playerIds = match.participants.map((participant) => participant.player.id)
    const [firstPlayerId, secondPlayerId] = playerIds
    const statsByPlayerId = new Map(playerIds.map((playerId) => [playerId, emptyParticipantChallengeStats()]))

    if (!firstPlayerId || !secondPlayerId) {
      return toMatchView(match, statsByPlayerId)
    }

    const roomId = match.roomId ?? match.id
    for (const completedMatch of completedMatches) {
      const completedPlayerIds = new Set(completedMatch.participants.map((participant) => participant.playerId))

      if (completedMatch.roomId === roomId) {
        applyChallengeOutcome(statsByPlayerId, 'room', completedMatch)
      }

      if (completedPlayerIds.has(firstPlayerId) && completedPlayerIds.has(secondPlayerId)) {
        applyChallengeOutcome(statsByPlayerId, 'friendship', completedMatch)
      }
    }

    return toMatchView(match, statsByPlayerId)
  })
}
