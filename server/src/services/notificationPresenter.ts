import type { NotificationView } from './notificationService.js'

export type SerializedNotification = ReturnType<typeof serializeNotification>

function serializeActor(actor: NotificationView['actorPlayer']) {
  if (!actor) {
    return null
  }

  return {
    id: actor.id,
    name: actor.name,
    username: actor.username,
    avatarUrl: actor.avatarUrl,
    totalXp: actor.totalXp,
    presenceStatus: actor.presenceStatus,
    presenceUpdatedAt: actor.presenceUpdatedAt.toISOString(),
  }
}

export function serializeNotification(notification: NotificationView) {
  return {
    id: notification.id,
    type: notification.type,
    status: notification.status,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    dedupeKey: notification.dedupeKey,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
    dismissedAt: notification.dismissedAt?.toISOString() ?? null,
    actorPlayer: serializeActor(notification.actorPlayer),
  }
}
