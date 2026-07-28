import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errors.js'
import { mockAuth } from './middleware/auth.js'

const tx = { id: 'notification-stress-transaction' }
const transactionMock = vi.hoisted(() => vi.fn())
const notificationMocks = vi.hoisted(() => ({
  dismissNotification: vi.fn(),
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}))
const outboxMocks = vi.hoisted(() => ({
  enqueueOutboxEvent: vi.fn(),
  dispatchOutboxEvents: vi.fn(),
}))

vi.mock('./lib/prisma.js', () => ({ prisma: { $transaction: transactionMock } }))
vi.mock('./services/notificationService.js', () => notificationMocks)
vi.mock('./services/outboxService.js', () => ({ enqueueOutboxEvent: outboxMocks.enqueueOutboxEvent }))
vi.mock('./services/outboxDispatcher.js', () => ({ requestOutboxDispatch: outboxMocks.dispatchOutboxEvents }))
vi.mock('./services/playerService.js', () => ({
  getCurrentPlayer: vi.fn(async () => ({
    id: 'player-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: new Date('2000-01-01'),
    username: 'ada',
  })),
  isPlayerProfileComplete: vi.fn(() => true),
}))

const { notificationRoutes } = await import('./routes/notificationRoutes.js')

function app() {
  const server = express()
  server.use(express.json())
  server.use('/api', mockAuth('user-1'), notificationRoutes())
  server.use(errorHandler)
  return server
}

describe('notification routes under bursts and races', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    notificationMocks.listNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 })
    outboxMocks.enqueueOutboxEvent.mockResolvedValue({ id: 'event' })
    outboxMocks.dispatchOutboxEvents.mockResolvedValue(undefined)
  })

  it('coalesces 64 concurrent reads of the same notification at the persistence boundary', async () => {
    const readIds = new Set<string>()
    notificationMocks.markNotificationRead.mockImplementation(async (_playerId: string, notificationId: string) => {
      if (readIds.has(notificationId)) return { count: 0 }
      readIds.add(notificationId)
      return { count: 1 }
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 64 }, () => request(server).put('/api/notifications/shared/read')),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(notificationMocks.markNotificationRead).toHaveBeenCalledTimes(64)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
    expect(notificationMocks.listNotifications).toHaveBeenCalledTimes(64)
  })

  it('handles 40 distinct notifications without dedupe-key collisions', async () => {
    notificationMocks.markNotificationRead.mockResolvedValue({ count: 1 })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, index) => request(server).put(`/api/notifications/notification-${index}/read`)),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(40)
    const events = outboxMocks.enqueueOutboxEvent.mock.calls.map(([, event]) => event)
    expect(new Set(events.map((event) => event.dedupeKey)).size).toBe(40)
    expect(events.map((event) => event.aggregateId)).toEqual(
      Array.from({ length: 40 }, (_, index) => `notification-${index}`),
    )
  })

  it('emits a single inbox event when many read-all commands race', async () => {
    let unreadNotifications = 150
    notificationMocks.markAllNotificationsRead.mockImplementation(async () => {
      if (unreadNotifications === 0) return { count: 0 }
      const count = unreadNotifications
      unreadNotifications = 0
      return { count }
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 30 }, () => request(server).put('/api/notifications/read-all')),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      aggregateType: 'notification_inbox',
      payload: { playerIds: ['player-1'], reason: 'notifications_read' },
    }))
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
  })

  it('dismisses a notification once despite repeated concurrent deletes', async () => {
    const dismissedIds = new Set<string>()
    notificationMocks.dismissNotification.mockImplementation(async (_playerId: string, notificationId: string) => {
      if (dismissedIds.has(notificationId)) return { count: 0 }
      dismissedIds.add(notificationId)
      return { count: 1 }
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => request(server).delete('/api/notifications/shared')),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
  })

  it('contains one outbox failure without breaking neighboring notification writes', async () => {
    notificationMocks.markNotificationRead.mockResolvedValue({ count: 1 })
    outboxMocks.enqueueOutboxEvent.mockImplementation(async (_client, event: { aggregateId: string }) => {
      if (event.aggregateId === 'notification-13') throw new Error('outbox unavailable')
      return { id: `event-${event.aggregateId}` }
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, index) => request(server).put(`/api/notifications/notification-${index}/read`)),
    )

    expect(responses.filter((response) => response.status === 200)).toHaveLength(24)
    expect(responses.filter((response) => response.status === 500)).toHaveLength(1)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(24)
    expect(notificationMocks.listNotifications).toHaveBeenCalledTimes(24)
  })
})
