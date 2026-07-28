import type { Prisma } from '../generated/prisma/client.js'
import { logger } from '../lib/logger.js'
import {
  emitNotificationCreated,
  emitNotificationsChanged,
  emitSerializedMatchSnapshot,
  emitSocialChanged,
} from '../realtime/notifications.js'
import type { SerializedNotification } from './notificationPresenter.js'
import {
  claimOutboxEvents,
  markOutboxFailed,
  markOutboxPublished,
  type NotificationCreatedPayload,
  type NotificationsChangedPayload,
  type SocialChangedPayload,
  type MatchChangedPayload,
} from './outboxService.js'

const OUTBOX_POLL_INTERVAL_MS = 2_000
let dispatchPromise: Promise<void> | null = null
let dispatcherStarted = false
let lastSucceededAt: Date | null = null
let lastFailedAt: Date | null = null

function publish(topic: string, payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Payload outbox invalide pour ${topic}.`)
  }

  if (topic === 'social.changed') {
    const event = payload as unknown as SocialChangedPayload
    emitSocialChanged(event.playerIds, event.reason)
    return
  }
  if (topic === 'notifications.changed') {
    const event = payload as unknown as NotificationsChangedPayload
    emitNotificationsChanged(event.playerIds, event.reason)
    return
  }
  if (topic === 'notification.created') {
    const event = payload as unknown as NotificationCreatedPayload
    emitNotificationCreated(event.playerId, event.reason, event.notification as unknown as SerializedNotification)
    return
  }
  if (topic === 'match.changed') {
    const event = payload as unknown as MatchChangedPayload
    emitSerializedMatchSnapshot(event.match, event.reason, event.commandId)
    return
  }

  throw new Error(`Topic outbox inconnu: ${topic}.`)
}

async function runDispatch() {
  const events = await claimOutboxEvents()

  for (const event of events) {
    try {
      publish(event.topic, event.payload)
      await markOutboxPublished(event.id)
    } catch (error) {
      await markOutboxFailed(event.id, event.attempts, error)
      logger.error('outbox_event_failed', {
        eventId: event.id,
        topic: event.topic,
        attempts: event.attempts,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function dispatchOutboxEvents() {
  if (!dispatchPromise) {
    dispatchPromise = runDispatch()
      .then(() => {
        lastSucceededAt = new Date()
        lastFailedAt = null
      })
      .catch((error) => {
        lastFailedAt = new Date()
        throw error
      })
      .finally(() => {
        dispatchPromise = null
      })
  }
  return dispatchPromise
}

export function getOutboxDispatcherHealth() {
  return {
    started: dispatcherStarted,
    running: Boolean(dispatchPromise),
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
  }
}

export function requestOutboxDispatch() {
  void dispatchOutboxEvents().catch((error) => {
    logger.error('outbox_dispatch_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export function startOutboxDispatcher() {
  dispatcherStarted = true
  requestOutboxDispatch()
  const timer = setInterval(requestOutboxDispatch, OUTBOX_POLL_INTERVAL_MS)
  timer.unref()
  return async () => {
    clearInterval(timer)
    dispatcherStarted = false
    await dispatchPromise?.catch(() => undefined)
  }
}
