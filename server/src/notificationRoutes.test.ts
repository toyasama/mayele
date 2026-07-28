import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errors.js'
import { mockAuth } from './middleware/auth.js'

const tx = { id: 'notification-transaction' }
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

describe('notification transactional routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    notificationMocks.listNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 })
    notificationMocks.markNotificationRead.mockResolvedValue({ count: 1 })
    notificationMocks.markAllNotificationsRead.mockResolvedValue({ count: 2 })
    notificationMocks.dismissNotification.mockResolvedValue({ count: 1 })
    outboxMocks.enqueueOutboxEvent.mockResolvedValue({ id: 'event-1' })
  })

  it('journalise une lecture individuelle dans la transaction de notification', async () => {
    await request(app()).put('/api/notifications/notification-1/read').expect(200)

    expect(notificationMocks.markNotificationRead).toHaveBeenCalledWith('player-1', 'notification-1', tx)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      topic: 'notifications.changed',
      aggregateId: 'notification-1',
      payload: { playerIds: ['player-1'], reason: 'notification_read' },
    }))
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it('journalise la lecture globale seulement si des lignes changent', async () => {
    await request(app()).put('/api/notifications/read-all').expect(200)

    expect(notificationMocks.markAllNotificationsRead).toHaveBeenCalledWith('player-1', tx)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      aggregateType: 'notification_inbox',
      payload: { playerIds: ['player-1'], reason: 'notifications_read' },
    }))

    vi.clearAllMocks()
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    notificationMocks.listNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 })
    notificationMocks.markAllNotificationsRead.mockResolvedValue({ count: 0 })

    await request(app()).put('/api/notifications/read-all').expect(200)
    expect(outboxMocks.enqueueOutboxEvent).not.toHaveBeenCalled()
    expect(outboxMocks.dispatchOutboxEvents).not.toHaveBeenCalled()
  })

  it('ferme une notification et publie après le commit', async () => {
    await request(app()).delete('/api/notifications/notification-1').expect(200)

    expect(notificationMocks.dismissNotification).toHaveBeenCalledWith('player-1', 'notification-1', tx)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      payload: { playerIds: ['player-1'], reason: 'notification_dismissed' },
    }))
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it("n'émet rien si l'écriture outbox fait échouer la transaction", async () => {
    outboxMocks.enqueueOutboxEvent.mockRejectedValueOnce(new Error('outbox indisponible'))

    await request(app()).put('/api/notifications/notification-1/read').expect(500)

    expect(outboxMocks.dispatchOutboxEvents).not.toHaveBeenCalled()
    expect(notificationMocks.listNotifications).not.toHaveBeenCalled()
  })
})
