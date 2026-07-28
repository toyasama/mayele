import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import type { MatchView } from './matchServiceView.js'
import { serializeMatch } from './matchPresenter.js'
import { serializeNotification } from './notificationPresenter.js'
import {
  createNotification,
  dismissNotificationByDedupeKey,
  matchDeclinedNotificationKey,
  matchInviteNotificationKey,
} from './notificationService.js'
import { enqueueOutboxEvent } from './outboxService.js'

type MatchEffectOptions = {
  commandId?: string | null
}

export async function enqueueMatchChanged(
  tx: Prisma.TransactionClient,
  match: MatchView,
  reason: string,
  options: MatchEffectOptions = {},
) {
  await enqueueOutboxEvent(tx, {
    dedupeKey: `match:${match.id}:${reason}:${options.commandId ?? randomUUID()}`,
    topic: 'match.changed',
    aggregateType: 'match',
    aggregateId: match.id,
    payload: { match: serializeMatch(match), reason, commandId: options.commandId ?? null },
  })
}

export async function persistInvitationCreatedEffects(
  tx: Prisma.TransactionClient,
  match: MatchView,
  creatorPlayerId: string,
  notificationId: string,
  options: MatchEffectOptions = {},
) {
  const opponent = match.participants.find((participant) => participant.player.id !== creatorPlayerId)?.player
  if (!opponent) return

  const notification = await createNotification({
    id: notificationId,
    playerId: opponent.id,
    actorPlayerId: creatorPlayerId,
    type: 'match_invite_received',
    title: `${match.createdBy.name} vous a defie.`,
    href: `/jeu/multijoueur?match=${match.id}`,
    dedupeKey: matchInviteNotificationKey(match.id),
  }, tx)
  await enqueueOutboxEvent(tx, {
    dedupeKey: `match:${match.id}:invite-notification:${options.commandId ?? randomUUID()}`,
    topic: 'notification.created',
    aggregateType: 'match',
    aggregateId: match.id,
    payload: {
      playerId: opponent.id,
      reason: 'notification_created',
      notification: serializeNotification(notification),
    },
  })
  await enqueueMatchChanged(tx, match, 'match_created', options)
}

export async function persistInvitationAcceptedEffects(
  tx: Prisma.TransactionClient,
  match: MatchView,
  playerId: string,
  options: MatchEffectOptions = {},
) {
  const dismissed = await dismissNotificationByDedupeKey(playerId, matchInviteNotificationKey(match.id), tx)
  if (dismissed) {
    await enqueueOutboxEvent(tx, {
      dedupeKey: `match:${match.id}:accepted-dismissed:${options.commandId ?? randomUUID()}`,
      topic: 'notifications.changed',
      aggregateType: 'match',
      aggregateId: match.id,
      payload: { playerIds: [playerId], reason: 'notification_dismissed' },
    })
  }
  await enqueueMatchChanged(tx, match, 'match_accepted', options)
}

export async function persistInvitationDeclinedEffects(
  tx: Prisma.TransactionClient,
  match: MatchView,
  playerId: string,
  options: MatchEffectOptions = {},
) {
  const dismissed = await dismissNotificationByDedupeKey(playerId, matchInviteNotificationKey(match.id), tx)
  if (dismissed) {
    await enqueueOutboxEvent(tx, {
      dedupeKey: `match:${match.id}:declined-dismissed:${options.commandId ?? randomUUID()}`,
      topic: 'notifications.changed',
      aggregateType: 'match',
      aggregateId: match.id,
      payload: { playerIds: [playerId], reason: 'notification_dismissed' },
    })
  }

  const decliningParticipant = match.participants.find((participant) => participant.player.id === playerId)
  if (match.createdBy.id !== playerId && decliningParticipant) {
    const notification = await createNotification({
      playerId: match.createdBy.id,
      actorPlayerId: playerId,
      type: 'match_invite_declined',
      title: `${decliningParticipant.player.name} a refuse votre defi.`,
      href: '/jeu/multijoueur',
      dedupeKey: matchDeclinedNotificationKey(match.id),
    }, tx)
    await enqueueOutboxEvent(tx, {
      dedupeKey: `match:${match.id}:declined-notification:${options.commandId ?? randomUUID()}`,
      topic: 'notification.created',
      aggregateType: 'match',
      aggregateId: match.id,
      payload: {
        playerId: match.createdBy.id,
        reason: 'notification_created',
        notification: serializeNotification(notification),
      },
    })
  }
  await enqueueMatchChanged(tx, match, 'match_declined', options)
}

export async function persistMatchLeftEffects(
  tx: Prisma.TransactionClient,
  match: MatchView,
  options: MatchEffectOptions = {},
) {
  const changedPlayerIds: string[] = []
  for (const participant of match.participants) {
    if (await dismissNotificationByDedupeKey(participant.player.id, matchInviteNotificationKey(match.id), tx)) {
      changedPlayerIds.push(participant.player.id)
    }
  }
  if (changedPlayerIds.length) {
    await enqueueOutboxEvent(tx, {
      dedupeKey: `match:${match.id}:left-dismissed:${options.commandId ?? randomUUID()}`,
      topic: 'notifications.changed',
      aggregateType: 'match',
      aggregateId: match.id,
      payload: { playerIds: changedPlayerIds, reason: 'notification_dismissed' },
    })
  }
  await enqueueMatchChanged(tx, match, 'match_left', options)
}

export async function persistMatchExpiredEffects(
  tx: Prisma.TransactionClient,
  match: MatchView,
) {
  const changedPlayerIds: string[] = []
  for (const participant of match.participants) {
    if (await dismissNotificationByDedupeKey(participant.player.id, matchInviteNotificationKey(match.id), tx)) {
      changedPlayerIds.push(participant.player.id)
    }
  }

  if (changedPlayerIds.length) {
    await enqueueOutboxEvent(tx, {
      dedupeKey: `match:${match.id}:expired-invitations-dismissed`,
      topic: 'notifications.changed',
      aggregateType: 'match',
      aggregateId: match.id,
      payload: { playerIds: changedPlayerIds, reason: 'notification_dismissed' },
    })
  }

  await enqueueOutboxEvent(tx, {
    dedupeKey: `match:${match.id}:expired`,
    topic: 'match.changed',
    aggregateType: 'match',
    aggregateId: match.id,
    payload: { match: serializeMatch(match), reason: 'match_expired', commandId: null },
  })
}
