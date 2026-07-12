import { prisma } from '../lib/prisma.js'
import { getDashboard } from './dashboardService.js'

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

async function assertNotFriends(playerId: string, otherPlayerId: string) {
  const friendshipIds = canonicalFriendshipIds(playerId, otherPlayerId)
  const friendship = await prisma.friendship.findUnique({
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

export async function getFriendPublicProfile(playerId: string, friendId: string, timeZone?: string | null) {
  await assertFriends(playerId, friendId)

  const friend = await prisma.player.findUnique({
    where: { id: friendId },
    select: PUBLIC_PLAYER_SELECT,
  })

  if (!friend) {
    throw new FriendServiceError('player_not_found')
  }

  const dashboard = await getDashboard(friend.id, timeZone)

  return {
    player: friend,
    badges: dashboard.badges
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
      byGame: dashboard.stats.byGame,
      byLevel: dashboard.stats.byLevel,
    },
  }
}

export async function sendFriendRequest(senderId: string, receiverId: string) {
  if (senderId === receiverId) {
    throw new FriendServiceError('self_friend_request')
  }

  const receiver = await prisma.player.findUnique({
    where: { id: receiverId },
    select: PUBLIC_PLAYER_SELECT,
  })

  if (!receiver) {
    throw new FriendServiceError('player_not_found')
  }

  await assertNotFriends(senderId, receiverId)

  const existingOutgoing = await prisma.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId, receiverId } },
  })

  if (existingOutgoing?.status === 'pending') {
    throw new FriendServiceError('friend_request_already_pending')
  }

  const existingIncoming = await prisma.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId: receiverId, receiverId: senderId } },
  })

  if (existingIncoming?.status === 'pending') {
    throw new FriendServiceError('incoming_friend_request_exists')
  }

  const request = existingOutgoing
    ? await prisma.friendRequest.update({
        where: { id: existingOutgoing.id },
        data: { status: 'pending', respondedAt: null },
      })
    : await prisma.friendRequest.create({
        data: { senderId, receiverId },
      })

  return {
    id: request.id,
    createdAt: request.createdAt,
    player: receiver,
  }
}

export async function acceptFriendRequest(playerId: string, requestId: string) {
  const request = await prisma.friendRequest.findUnique({
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

  await prisma.$transaction(async (tx) => {
    await tx.friendRequest.update({
      where: { id: request.id },
      data: { status: 'accepted', respondedAt: new Date() },
    })

    await tx.friendship.upsert({
      where: { playerAId_playerBId: friendshipIds },
      update: {},
      create: friendshipIds,
    })
  })

  return request.sender
}

export async function declineFriendRequest(playerId: string, requestId: string) {
  const request = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    include: { sender: { select: PUBLIC_PLAYER_SELECT } },
  })

  if (!request || request.receiverId !== playerId) {
    throw new FriendServiceError('friend_request_not_found')
  }

  if (request.status !== 'pending') {
    throw new FriendServiceError('friend_request_not_pending')
  }

  await prisma.friendRequest.update({
    where: { id: request.id },
    data: { status: 'declined', respondedAt: new Date() },
  })

  return request.sender
}

export async function cancelFriendRequest(playerId: string, requestId: string) {
  const request = await prisma.friendRequest.findUnique({
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

  await prisma.friendRequest.update({
    where: { id: request.id },
    data: { status: 'cancelled', respondedAt: new Date() },
  })

  return request.receiver
}

export async function removeFriend(playerId: string, friendId: string) {
  const friendshipIds = canonicalFriendshipIds(playerId, friendId)
  const result = await prisma.friendship.deleteMany({
    where: friendshipIds,
  })

  if (result.count === 0) {
    throw new FriendServiceError('friendship_not_found')
  }
}
