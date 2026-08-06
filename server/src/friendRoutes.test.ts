import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errors.js'
import { mockAuth } from './middleware/auth.js'

const tx = { id: 'transaction-client' }
const friend = {
  id: 'player-2',
  name: 'Grace Hopper',
  username: 'grace',
  avatarUrl: null,
  totalXp: 320,
  presenceStatus: 'offline',
  presenceUpdatedAt: new Date('2026-07-19T00:00:00.000Z'),
}
const createdRequest = {
  id: 'request-1',
  createdAt: new Date('2026-07-19T00:00:00.000Z'),
  player: friend,
}
const notification = {
  id: 'notification-1',
  type: 'friend_request_received',
  status: 'active',
  title: "Ada vous a envoye une demande d'ami.",
  body: null,
  href: '/amis?filter=incoming',
  dedupeKey: 'friend_request:request-1:received',
  createdAt: new Date('2026-07-19T00:00:00.000Z'),
  readAt: null,
  dismissedAt: null,
  actorPlayer: null,
}

const friendMocks = vi.hoisted(() => ({
  sendFriendRequestInTransaction: vi.fn(),
  acceptFriendRequestInTransaction: vi.fn(),
  declineFriendRequestInTransaction: vi.fn(),
  cancelFriendRequestInTransaction: vi.fn(),
  removeFriendInTransaction: vi.fn(),
  getFriendOperationHistory: vi.fn(),
}))
const notificationMocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  dismissNotificationByDedupeKey: vi.fn(),
  friendAcceptedNotificationKey: vi.fn((id: string) => `accepted:${id}`),
  friendRequestNotificationKey: vi.fn((id: string) => `friend_request:${id}:received`),
}))
const outboxMocks = vi.hoisted(() => ({
  enqueueOutboxEvent: vi.fn(),
  dispatchOutboxEvents: vi.fn(),
}))
const realtimeMocks = vi.hoisted(() => ({
  emitNotificationCreated: vi.fn(),
  emitNotificationsChanged: vi.fn(),
  emitSocialChanged: vi.fn(),
}))
const transactionMock = vi.hoisted(() => vi.fn())

vi.mock('./services/friendService.js', () => ({
  FriendServiceError: class FriendServiceError extends Error { constructor(public code: string) { super(code) } },
  sendFriendRequestInTransaction: friendMocks.sendFriendRequestInTransaction,
  acceptFriendRequestInTransaction: friendMocks.acceptFriendRequestInTransaction,
  declineFriendRequestInTransaction: friendMocks.declineFriendRequestInTransaction,
  cancelFriendRequestInTransaction: friendMocks.cancelFriendRequestInTransaction,
  removeFriendInTransaction: friendMocks.removeFriendInTransaction,
  getFriendOperationHistory: friendMocks.getFriendOperationHistory,
}))
vi.mock('./services/notificationService.js', () => notificationMocks)
vi.mock('./services/outboxService.js', () => ({ enqueueOutboxEvent: outboxMocks.enqueueOutboxEvent }))
vi.mock('./services/outboxDispatcher.js', () => ({ requestOutboxDispatch: outboxMocks.dispatchOutboxEvents }))
vi.mock('./realtime/notifications.js', () => realtimeMocks)
vi.mock('./services/playerService.js', () => ({
  getCurrentPlayer: vi.fn(async () => ({
    id: 'player-1',
    name: 'Ada',
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: new Date('2000-01-01'),
    username: 'ada',
  })),
  isPlayerProfileComplete: vi.fn(() => true),
}))
vi.mock('./lib/prisma.js', () => ({ prisma: { $transaction: transactionMock } }))

const { friendRoutes } = await import('./routes/friendRoutes.js')

function app() {
  const server = express()
  server.use(express.json())
  server.use('/api', mockAuth('user-1'), friendRoutes())
  server.use(errorHandler)
  return server
}

describe('friend request transactional route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    friendMocks.sendFriendRequestInTransaction.mockResolvedValue(createdRequest)
    friendMocks.acceptFriendRequestInTransaction.mockResolvedValue(friend)
    friendMocks.declineFriendRequestInTransaction.mockResolvedValue(friend)
    friendMocks.cancelFriendRequestInTransaction.mockResolvedValue(friend)
    friendMocks.removeFriendInTransaction.mockResolvedValue(undefined)
    friendMocks.getFriendOperationHistory.mockResolvedValue([])
    notificationMocks.createNotification.mockResolvedValue(notification)
    notificationMocks.dismissNotificationByDedupeKey.mockResolvedValue(true)
    outboxMocks.enqueueOutboxEvent.mockResolvedValue({ id: 'event-1' })
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  })

  it("retourne l'historique agrégé d'une opération pour un ami", async () => {
    const sessions = [{
      id: 'session-1',
      score: 80,
      correctAnswers: 8,
      totalQuestions: 10,
      bestStreak: 5,
      playedAt: '2026-07-19T00:00:00.000Z',
      averageResponseTimeMs: 2000,
    }]
    friendMocks.getFriendOperationHistory.mockResolvedValueOnce(sessions)

    const response = await request(app())
      .get('/api/friends/player-2/operation-history?game=addition&level=debutant&limit=5')
      .expect(200)

    expect(response.body).toEqual({ sessions })
    expect(friendMocks.getFriendOperationHistory).toHaveBeenCalledWith(
      'player-1',
      'player-2',
      'addition',
      'debutant',
      5,
    )
  })

  it('commit la demande, la notification et les deux événements dans une transaction', async () => {
    await request(app())
      .post('/api/friends/requests')
      .send({ receiverPlayerId: 'player-2' })
      .expect(201)

    expect(friendMocks.sendFriendRequestInTransaction).toHaveBeenCalledWith(tx, 'player-1', 'player-2')
    expect(notificationMocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      actorPlayerId: 'player-1',
      dedupeKey: 'friend_request:request-1:received',
    }), tx)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(2)
    expect(outboxMocks.enqueueOutboxEvent.mock.calls.every((call) => call[0] === tx)).toBe(true)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
    expect(realtimeMocks.emitSocialChanged).not.toHaveBeenCalled()
    expect(realtimeMocks.emitNotificationCreated).not.toHaveBeenCalled()
  })

  it('ne réveille pas le dispatcher si l’écriture outbox fait échouer la transaction', async () => {
    outboxMocks.enqueueOutboxEvent.mockRejectedValueOnce(new Error('outbox indisponible'))

    await request(app())
      .post('/api/friends/requests')
      .send({ receiverPlayerId: 'player-2' })
      .expect(500)

    expect(outboxMocks.dispatchOutboxEvents).not.toHaveBeenCalled()
  })

  it('accepte la demande, ferme la notification reçue et journalise les trois diffusions ensemble', async () => {
    await request(app())
      .post('/api/friends/requests/request-1/accept')
      .expect(200)

    expect(friendMocks.acceptFriendRequestInTransaction).toHaveBeenCalledWith(tx, 'player-1', 'request-1')
    expect(notificationMocks.dismissNotificationByDedupeKey).toHaveBeenCalledWith(
      'player-1',
      'friend_request:request-1:received',
      tx,
    )
    expect(notificationMocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      actorPlayerId: 'player-1',
    }), tx)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(3)
    expect(outboxMocks.enqueueOutboxEvent.mock.calls.map((call) => call[1].topic)).toEqual([
      'social.changed',
      'notification.created',
      'notifications.changed',
    ])
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it('refuse la demande et journalise le social et la fermeture de notification dans la transaction', async () => {
    await request(app())
      .post('/api/friends/requests/request-1/decline')
      .expect(200)

    expect(friendMocks.declineFriendRequestInTransaction).toHaveBeenCalledWith(tx, 'player-1', 'request-1')
    expect(notificationMocks.dismissNotificationByDedupeKey).toHaveBeenCalledWith(
      'player-1',
      'friend_request:request-1:received',
      tx,
    )
    expect(outboxMocks.enqueueOutboxEvent.mock.calls.map((call) => call[1].topic)).toEqual([
      'social.changed',
      'notifications.changed',
    ])
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it('annule la demande et cible la boîte du destinataire dans le même commit', async () => {
    await request(app())
      .post('/api/friends/requests/request-1/cancel')
      .expect(200)

    expect(friendMocks.cancelFriendRequestInTransaction).toHaveBeenCalledWith(tx, 'player-1', 'request-1')
    expect(notificationMocks.dismissNotificationByDedupeKey).toHaveBeenCalledWith(
      'player-2',
      'friend_request:request-1:received',
      tx,
    )
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(2)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it("retire l'amitié et son événement social atomiquement", async () => {
    await request(app())
      .delete('/api/friends/player-2')
      .expect(204)

    expect(friendMocks.removeFriendInTransaction).toHaveBeenCalledWith(tx, 'player-1', 'player-2')
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      topic: 'social.changed',
      aggregateType: 'friendship',
      payload: expect.objectContaining({ reason: 'friend_removed' }),
    }))
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it("ne diffuse pas un refus si l'événement durable ne peut pas être écrit", async () => {
    outboxMocks.enqueueOutboxEvent.mockRejectedValueOnce(new Error('outbox indisponible'))

    await request(app())
      .post('/api/friends/requests/request-1/decline')
      .expect(500)

    expect(outboxMocks.dispatchOutboxEvents).not.toHaveBeenCalled()
  })
})
