import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import type { SerializedMatch } from './matchPresenter.js'

export type OutboxTopic = 'social.changed' | 'notification.created' | 'notifications.changed' | 'match.changed'

export type SocialChangedPayload = {
  playerIds: string[]
  reason: string
}

export type NotificationCreatedPayload = {
  playerId: string
  reason: string
  notification: Record<string, Prisma.JsonValue>
}

export type NotificationsChangedPayload = {
  playerIds: string[]
  reason: string
}

export type MatchChangedPayload = {
  match: SerializedMatch
  reason: string
  commandId?: string | null
}

export type OutboxPayload = SocialChangedPayload | NotificationCreatedPayload | NotificationsChangedPayload | MatchChangedPayload

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  input: {
    dedupeKey: string
    topic: OutboxTopic
    aggregateType: string
    aggregateId: string
    payload: OutboxPayload
  },
) {
  return tx.outboxEvent.create({
    data: {
      dedupeKey: input.dedupeKey,
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload as Prisma.InputJsonValue,
    },
  })
}

export async function claimOutboxEvents(limit = 25) {
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "outbox_events"
      WHERE (
        "status" IN ('pending', 'failed')
        AND "available_at" <= CURRENT_TIMESTAMP
      ) OR (
        "status" = 'processing'
        AND "locked_at" < CURRENT_TIMESTAMP - INTERVAL '30 seconds'
      )
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `

    if (!candidates.length) return []
    const ids = candidates.map((candidate) => candidate.id)
    const lockedAt = new Date()

    await tx.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'processing',
        lockedAt,
        attempts: { increment: 1 },
      },
    })

    return tx.outboxEvent.findMany({
      where: { id: { in: ids }, lockedAt },
      orderBy: { createdAt: 'asc' },
    })
  })
}

export function markOutboxPublished(eventId: string) {
  return prisma.outboxEvent.update({
    where: { id: eventId },
    data: {
      status: 'published',
      publishedAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  })
}

export function markOutboxFailed(eventId: string, attempts: number, error: unknown) {
  const retryDelaySeconds = Math.min(300, 2 ** Math.min(attempts, 8))
  return prisma.outboxEvent.update({
    where: { id: eventId },
    data: {
      status: 'failed',
      lockedAt: null,
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
      availableAt: new Date(Date.now() + retryDelaySeconds * 1_000),
    },
  })
}
