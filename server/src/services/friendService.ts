import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { VALID_GAMES, VALID_LEVELS, type GameLevel, type GameType } from '../domain/constants.js'
import { getPlayerBadgeStates } from './badgeService.js'

const PUBLIC_PLAYER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  totalXp: true,
  presenceStatus: true,
  presenceUpdatedAt: true,
} as const

export type PublicPlayer = {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  totalXp: number
  presenceStatus: string
  presenceUpdatedAt: Date
}

function weightedAverage<T extends { _count: { _all: number } }>(items: T[], readValue: (item: T) => number | null | undefined) {
  const total = items.reduce((sum, item) => sum + item._count._all, 0)
  if (!total) return 0

  return Math.round(items.reduce((sum, item) => sum + (readValue(item) ?? 0) * item._count._all, 0) / total)
}

function latestDate(items: Array<{ _max: { playedAt: Date | null } }>) {
  const latest = items.reduce<Date | null>((current, item) => {
    if (!item._max.playedAt) return current
    return !current || item._max.playedAt > current ? item._max.playedAt : current
  }, null)

  return latest?.toISOString() ?? null
}

export class FriendServiceError extends Error {
  constructor(
    public readonly code:
      | 'self_friend_request'
      | 'player_not_found'
      | 'already_friends'
      | 'friend_request_already_pending'
      | 'incoming_friend_request_exists'
      | 'friend_request_not_found'
      | 'friend_request_not_pending'
      | 'friend_request_not_owned'
      | 'friendship_not_found',
  ) {
    super(code)
  }
}

function canonicalFriendshipIds(playerId: string, otherPlayerId: string) {
  if (playerId === otherPlayerId) {
    throw new FriendServiceError('self_friend_request')
  }

  return playerId < otherPlayerId
    ? { playerAId: playerId, playerBId: otherPlayerId }
    : { playerAId: otherPlayerId, playerBId: playerId }
}

type FriendRequestDatabase = Pick<Prisma.TransactionClient, 'player' | 'friendship' | 'friendRequest'>

async function assertNotFriends(database: FriendRequestDatabase, playerId: string, otherPlayerId: string) {
  const friendshipIds = canonicalFriendshipIds(playerId, otherPlayerId)
  const friendship = await database.friendship.findUnique({
    where: { playerAId_playerBId: friendshipIds },
    select: { id: true },
  })

  if (friendship) {
    throw new FriendServiceError('already_friends')
  }
}

async function assertFriends(playerId: string, otherPlayerId: string) {
  const friendshipIds = canonicalFriendshipIds(playerId, otherPlayerId)
  const friendship = await prisma.friendship.findUnique({
    where: { playerAId_playerBId: friendshipIds },
    select: { id: true },
  })

  if (!friendship) {
    throw new FriendServiceError('friendship_not_found')
  }
}

export async function searchPlayersByUsername(currentPlayerId: string, username: string) {
  const normalizedUsername = username.trim().toLowerCase()

  return prisma.player.findMany({
    where: {
      id: { not: currentPlayerId },
      username: { startsWith: normalizedUsername },
    },
    select: PUBLIC_PLAYER_SELECT,
    orderBy: { username: 'asc' },
    take: 10,
  })
}

export async function listFriends(playerId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ playerAId: playerId }, { playerBId: playerId }],
    },
    include: {
      playerA: { select: PUBLIC_PLAYER_SELECT },
      playerB: { select: PUBLIC_PLAYER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  })

  return friendships.map((friendship) => (friendship.playerAId === playerId ? friendship.playerB : friendship.playerA))
}

export async function listFriendRequests(playerId: string) {
  const [incoming, outgoing] = await Promise.all([
    prisma.friendRequest.findMany({
      where: { receiverId: playerId, status: 'pending' },
      include: { sender: { select: PUBLIC_PLAYER_SELECT } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendRequest.findMany({
      where: { senderId: playerId, status: 'pending' },
      include: { receiver: { select: PUBLIC_PLAYER_SELECT } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    incoming: incoming.map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      player: request.sender,
    })),
    outgoing: outgoing.map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      player: request.receiver,
    })),
  }
}

export async function getSocialOverview(playerId: string) {
  const [friends, requests] = await Promise.all([listFriends(playerId), listFriendRequests(playerId)])

  return {
    friends,
    incoming: requests.incoming,
    outgoing: requests.outgoing,
  }
}

export async function getFriendPublicProfile(playerId: string, friendId: string, _timeZone?: string | null) {
  await assertFriends(playerId, friendId)

  const headToHeadWhere = {
    type: 'challenge',
    status: 'completed',
    participants: { some: { playerId } },
    AND: [{ participants: { some: { playerId: friendId } } }],
  }

  const [
    friend,
    progressGroups,
    responseTimeGroups,
    badges,
    outcomeGroups,
    recentChallenges,
  ] = await Promise.all([
    prisma.player.findUnique({
      where: { id: friendId },
      select: PUBLIC_PLAYER_SELECT,
    }),
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
      where: { playerId: friendId },
      _count: { _all: true },
      _max: { score: true, correctAnswers: true, bestStreak: true, playedAt: true },
      _avg: { score: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: { playerId: friendId },
      _count: { _all: true },
      _avg: { responseTimeMs: true },
    }),
    getPlayerBadgeStates(friendId),
    prisma.match.groupBy({
      by: ['winnerPlayerId'],
      where: headToHeadWhere,
      _count: { _all: true },
    }),
    prisma.match.findMany({
      where: headToHeadWhere,
      orderBy: { finishedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        challengeMode: true,
        game: true,
        level: true,
        winnerPlayerId: true,
        createdAt: true,
        finishedAt: true,
        participants: {
          where: { playerId: { in: [playerId, friendId] } },
          select: { playerId: true, score: true },
        },
      },
    }),
  ])

  if (!friend) {
    throw new FriendServiceError('player_not_found')
  }

  const buildStats = (dimension: 'game' | 'level', values: readonly string[]) => values.map((value) => {
    const progress = progressGroups.filter((item) => item[dimension] === value)
    const responseTimes = responseTimeGroups.filter((item) => item[dimension] === value)

    return {
      [dimension]: value,
      attempts: progress.reduce((sum, item) => sum + item._count._all, 0),
      averageAccuracy: weightedAverage(progress, (item) => item._avg.score),
      bestScore: progress.reduce((best, item) => Math.max(best, item._max.score ?? 0), 0),
      bestStreak: progress.reduce((best, item) => Math.max(best, item._max.bestStreak ?? 0), 0),
      averageResponseTimeMs: weightedAverage(responseTimes, (item) => item._avg.responseTimeMs),
      lastPlayedAt: latestDate(progress),
    }
  })

  const summary = { wins: 0, losses: 0, draws: 0 }
  for (const group of outcomeGroups) {
    if (group.winnerPlayerId === playerId) summary.wins += group._count._all
    else if (group.winnerPlayerId === null) summary.draws += group._count._all
    else summary.losses += group._count._all
  }

  return {
    player: friend,
    badges: badges
      .filter((badge) => badge.completed)
      .map((badge) => ({
        key: badge.key,
        title: badge.title,
        family: badge.family,
        familyLabel: badge.familyLabel,
        tier: badge.tier,
        level: badge.level,
      })),
    stats: {
      byGame: buildStats('game', VALID_GAMES) as Array<{
        game: GameType
        attempts: number
        averageAccuracy: number
        bestScore: number
        bestStreak: number
        averageResponseTimeMs: number
        lastPlayedAt: string | null
      }>,
      byLevel: buildStats('level', VALID_LEVELS) as Array<{
        level: GameLevel
        attempts: number
        averageAccuracy: number
        bestScore: number
        bestStreak: number
        averageResponseTimeMs: number
        lastPlayedAt: string | null
      }>,
    },
    headToHead: {
      summary,
      recent: recentChallenges.map((match) => {
        const currentParticipant = match.participants.find((participant) => participant.playerId === playerId)
        const friendParticipant = match.participants.find((participant) => participant.playerId === friendId)

        return {
          id: match.id,
          playedAt: (match.finishedAt ?? match.createdAt).toISOString(),
          challengeMode: match.challengeMode === 'tempo' ? 'tempo' as const : 'sprint' as const,
          game: match.game ?? 'mixte',
          level: match.level ?? 'debutant',
          myScore: currentParticipant?.score ?? null,
          friendScore: friendParticipant?.score ?? null,
          outcome: match.winnerPlayerId === null
            ? 'draw' as const
            : match.winnerPlayerId === playerId
              ? 'win' as const
              : 'loss' as const,
        }
      }),
    },
  }
}

async function sendFriendRequestWithDatabase(database: FriendRequestDatabase, senderId: string, receiverId: string) {
  if (senderId === receiverId) {
    throw new FriendServiceError('self_friend_request')
  }

  const receiver = await database.player.findUnique({
    where: { id: receiverId },
    select: PUBLIC_PLAYER_SELECT,
  })

  if (!receiver) {
    throw new FriendServiceError('player_not_found')
  }

  await assertNotFriends(database, senderId, receiverId)

  const existingOutgoing = await database.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId, receiverId } },
  })

  if (existingOutgoing?.status === 'pending') {
    throw new FriendServiceError('friend_request_already_pending')
  }

  const existingIncoming = await database.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId: receiverId, receiverId: senderId } },
  })

  if (existingIncoming?.status === 'pending') {
    throw new FriendServiceError('incoming_friend_request_exists')
  }

  let request
  try {
    if (existingOutgoing) {
      const reactivated = await database.friendRequest.updateMany({
        where: { id: existingOutgoing.id, status: { not: 'pending' } },
        data: { status: 'pending', respondedAt: null },
      })
      if (reactivated.count === 0) {
        throw new FriendServiceError('friend_request_already_pending')
      }
      request = { ...existingOutgoing, status: 'pending', respondedAt: null }
    } else {
      request = await database.friendRequest.create({
        data: { senderId, receiverId },
      })
    }
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'P2002'
    ) {
      throw new FriendServiceError('friend_request_already_pending')
    }
    throw error
  }

  return {
    id: request.id,
    createdAt: request.createdAt,
    player: receiver,
  }
}

export function sendFriendRequest(senderId: string, receiverId: string) {
  return sendFriendRequestWithDatabase(prisma, senderId, receiverId)
}

export function sendFriendRequestInTransaction(tx: Prisma.TransactionClient, senderId: string, receiverId: string) {
  return sendFriendRequestWithDatabase(tx, senderId, receiverId)
}

async function acceptFriendRequestWithDatabase(database: FriendRequestDatabase, playerId: string, requestId: string) {
  const request = await database.friendRequest.findUnique({
    where: { id: requestId },
    include: { sender: { select: PUBLIC_PLAYER_SELECT } },
  })

  if (!request || request.receiverId !== playerId) {
    throw new FriendServiceError('friend_request_not_found')
  }

  if (request.status !== 'pending') {
    throw new FriendServiceError('friend_request_not_pending')
  }

  const friendshipIds = canonicalFriendshipIds(request.senderId, request.receiverId)

  const accepted = await database.friendRequest.updateMany({
    where: { id: request.id, receiverId: playerId, status: 'pending' },
    data: { status: 'accepted', respondedAt: new Date() },
  })
  if (accepted.count === 0) {
    throw new FriendServiceError('friend_request_not_pending')
  }

  await database.friendship.upsert({
    where: { playerAId_playerBId: friendshipIds },
    update: {},
    create: friendshipIds,
  })

  return request.sender
}

export function acceptFriendRequest(playerId: string, requestId: string) {
  return prisma.$transaction((tx) => acceptFriendRequestWithDatabase(tx, playerId, requestId))
}

export function acceptFriendRequestInTransaction(tx: Prisma.TransactionClient, playerId: string, requestId: string) {
  return acceptFriendRequestWithDatabase(tx, playerId, requestId)
}

async function declineFriendRequestWithDatabase(database: FriendRequestDatabase, playerId: string, requestId: string) {
  const request = await database.friendRequest.findUnique({
    where: { id: requestId },
    include: { sender: { select: PUBLIC_PLAYER_SELECT } },
  })

  if (!request || request.receiverId !== playerId) {
    throw new FriendServiceError('friend_request_not_found')
  }

  if (request.status !== 'pending') {
    throw new FriendServiceError('friend_request_not_pending')
  }

  const declined = await database.friendRequest.updateMany({
    where: { id: request.id, receiverId: playerId, status: 'pending' },
    data: { status: 'declined', respondedAt: new Date() },
  })
  if (declined.count === 0) {
    throw new FriendServiceError('friend_request_not_pending')
  }

  return request.sender
}

export function declineFriendRequest(playerId: string, requestId: string) {
  return declineFriendRequestWithDatabase(prisma, playerId, requestId)
}

export function declineFriendRequestInTransaction(tx: Prisma.TransactionClient, playerId: string, requestId: string) {
  return declineFriendRequestWithDatabase(tx, playerId, requestId)
}

async function cancelFriendRequestWithDatabase(database: FriendRequestDatabase, playerId: string, requestId: string) {
  const request = await database.friendRequest.findUnique({
    where: { id: requestId },
    include: { receiver: { select: PUBLIC_PLAYER_SELECT } },
  })

  if (!request) {
    throw new FriendServiceError('friend_request_not_found')
  }

  if (request.senderId !== playerId) {
    throw new FriendServiceError('friend_request_not_owned')
  }

  if (request.status !== 'pending') {
    throw new FriendServiceError('friend_request_not_pending')
  }

  const cancelled = await database.friendRequest.updateMany({
    where: { id: request.id, senderId: playerId, status: 'pending' },
    data: { status: 'cancelled', respondedAt: new Date() },
  })
  if (cancelled.count === 0) {
    throw new FriendServiceError('friend_request_not_pending')
  }

  return request.receiver
}

export function cancelFriendRequest(playerId: string, requestId: string) {
  return cancelFriendRequestWithDatabase(prisma, playerId, requestId)
}

export function cancelFriendRequestInTransaction(tx: Prisma.TransactionClient, playerId: string, requestId: string) {
  return cancelFriendRequestWithDatabase(tx, playerId, requestId)
}

async function removeFriendWithDatabase(database: FriendRequestDatabase, playerId: string, friendId: string) {
  const friendshipIds = canonicalFriendshipIds(playerId, friendId)
  const result = await database.friendship.deleteMany({
    where: friendshipIds,
  })

  if (result.count === 0) {
    throw new FriendServiceError('friendship_not_found')
  }
}

export function removeFriend(playerId: string, friendId: string) {
  return removeFriendWithDatabase(prisma, playerId, friendId)
}

export function removeFriendInTransaction(tx: Prisma.TransactionClient, playerId: string, friendId: string) {
  return removeFriendWithDatabase(tx, playerId, friendId)
}
