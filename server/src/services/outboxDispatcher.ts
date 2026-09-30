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
  nextOutboxAttemptAt,
  type NotificationCreatedPayload,
  type NotificationsChangedPayload,
  type SocialChangedPayload,
  type MatchChangedPayload,
} from './outboxService.js'
import { createAdaptiveWorkerScheduler, IDLE_SCAN_MS, type AdaptiveWorkerScheduler } from './adaptiveWorker.js'
import { signalBackgroundWork, subscribeToBackgroundWork } from './backgroundWorkSignals.js'

let dispatchPromise: Promise<void> | null = null
let dispatcherScheduler: AdaptiveWorkerScheduler | null = null
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
  return events.length
}

export function dispatchOutboxEvents() {
  if (!dispatchPromise) {
    dispatchPromise = runDispatch()
      .then((dispatchedCount) => {
        lastDispatchCount = dispatchedCount
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
  if (dispatcherScheduler) {
    signalBackgroundWork('outbox')
    return
  }
  void dispatchOutboxEvents().catch(logDispatchError)
}

export function startOutboxDispatcher() {
  const scheduler = createAdaptiveWorkerScheduler({
    name: 'outbox',
    initialIdleDelayMs: IDLE_SCAN_MS,
    maxIdleDelayMs: IDLE_SCAN_MS,
    overdueRetryDelayMs: 1_000,
    run: async () => {
      const now = new Date()
      const pendingAttempt = await nextOutboxAttemptAt()
      if (!pendingAttempt || pendingAttempt > now) {
        return { workCount: 0, nextRunAt: pendingAttempt }
      }
      await dispatchOutboxEvents()
      return {
        workCount: lastDispatchCount,
        nextRunAt: await nextOutboxAttemptAt(),
      }
    },
    onRunSucceeded: () => {
      lastSucceededAt = new Date()
      lastFailedAt = null
    },
    onRunFailed: (error) => {
      lastFailedAt = new Date()
      logDispatchError(error)
    },
  })
  dispatcherScheduler = scheduler
  const unsubscribe = subscribeToBackgroundWork('outbox', () => scheduler.wake())
  dispatcherStarted = true
  scheduler.start()
  return async () => {
    unsubscribe()
    dispatcherStarted = false
    dispatcherScheduler = null
    await scheduler.stop()
  }
}

let lastDispatchCount = 0

function logDispatchError(error: unknown) {
  logger.error('outbox_dispatch_failed', {
    message: error instanceof Error ? error.message : String(error),
  })
}
