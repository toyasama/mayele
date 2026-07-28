import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

type NotificationDatabase = Pick<Prisma.TransactionClient, 'notification'>

const NOTIFICATION_INCLUDE = {
  actorPlayer: {
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      totalXp: true,
      presenceStatus: true,
      presenceUpdatedAt: true,
    },
  },
} as const

export type NotificationView = Awaited<ReturnType<typeof listNotifications>>['notifications'][number]

type CreateNotificationInput = {
  id?: string
  playerId: string
  actorPlayerId?: string | null
  type: string
  title: string
  body?: string | null
  href?: string | null
  dedupeKey: string
}

export async function createNotification(input: CreateNotificationInput, database: NotificationDatabase = prisma) {
  return database.notification.upsert({
    where: {
      playerId_dedupeKey: {
        playerId: input.playerId,
        dedupeKey: input.dedupeKey,
      },
    },
    update: {
      actorPlayerId: input.actorPlayerId ?? null,
      type: input.type,
      status: 'active',
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      readAt: null,
      dismissedAt: null,
    },
    create: {
      id: input.id,
      playerId: input.playerId,
      actorPlayerId: input.actorPlayerId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      dedupeKey: input.dedupeKey,
    },
    include: NOTIFICATION_INCLUDE,
  })
}

export async function dismissNotificationByDedupeKey(
  playerId: string,
  dedupeKey: string,
  database: NotificationDatabase = prisma,
) {
  const result = await database.notification.updateMany({
    where: {
      playerId,
      dedupeKey,
      status: 'active',
    },
    data: {
      status: 'dismissed',
      dismissedAt: new Date(),
    },
  })

  return result.count > 0
}

const NOTIFICATION_LIST_LIMIT = 20

export async function listNotifications(playerId: string) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        playerId,
        status: 'active',
      },
      include: NOTIFICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: NOTIFICATION_LIST_LIMIT,
    }),
    prisma.notification.count({
      where: {
        playerId,
        status: 'active',
        readAt: null,
      },
    }),
  ])

  return { notifications, unreadCount }
}

export async function dismissNotification(
  playerId: string,
  notificationId: string,
  database: NotificationDatabase = prisma,
) {
  return database.notification.updateMany({
    where: {
      id: notificationId,
      playerId,
      status: 'active',
    },
    data: {
      status: 'dismissed',
      dismissedAt: new Date(),
    },
  })
}

export async function markNotificationRead(
  playerId: string,
  notificationId: string,
  database: NotificationDatabase = prisma,
) {
  return database.notification.updateMany({
    where: {
      id: notificationId,
      playerId,
      status: 'active',
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })
}

export async function markAllNotificationsRead(playerId: string, database: NotificationDatabase = prisma) {
  return database.notification.updateMany({
    where: {
      playerId,
      status: 'active',
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })
}

export function friendRequestNotificationKey(requestId: string) {
  return `friend_request:${requestId}:received`
}

export function friendAcceptedNotificationKey(requestId: string) {
  return `friend_request:${requestId}:accepted`
}

export function matchInviteNotificationKey(matchId: string) {
  return `match:${matchId}:invite`
}

export function matchAcceptedNotificationKey(matchId: string) {
  return `match:${matchId}:accepted`
}

export function matchDeclinedNotificationKey(matchId: string) {
  return `match:${matchId}:declined`
}
