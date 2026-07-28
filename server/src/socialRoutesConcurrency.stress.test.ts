import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errors.js'
import { mockAuth } from './middleware/auth.js'

const tx = { id: 'social-stress-transaction' }
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
  title: 'Notification',
  body: null,
  href: '/amis',
  dedupeKey: 'friend_request:request-1:received',
  createdAt: new Date('2026-07-19T00:00:00.000Z'),
  readAt: null,
  dismissedAt: null,
  actorPlayer: null,
}

const friendMocks = vi.hoisted(() => {
  class FriendServiceError extends Error {
    constructor(public code: string) {
      super(code)
    }
  }

  return {
    FriendServiceError,
    sendFriendRequestInTransaction: vi.fn(),
    acceptFriendRequestInTransaction: vi.fn(),
    declineFriendRequestInTransaction: vi.fn(),
    cancelFriendRequestInTransaction: vi.fn(),
    removeFriendInTransaction: vi.fn(),
  }
})
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
const transactionMock = vi.hoisted(() => vi.fn())

vi.mock('./services/friendService.js', () => ({
  FriendServiceError: friendMocks.FriendServiceError,
  sendFriendRequestInTransaction: friendMocks.sendFriendRequestInTransaction,
  acceptFriendRequestInTransaction: friendMocks.acceptFriendRequestInTransaction,
  declineFriendRequestInTransaction: friendMocks.declineFriendRequestInTransaction,
  cancelFriendRequestInTransaction: friendMocks.cancelFriendRequestInTransaction,
  removeFriendInTransaction: friendMocks.removeFriendInTransaction,
}))
vi.mock('./services/notificationService.js', () => notificationMocks)
vi.mock('./services/outboxService.js', () => ({ enqueueOutboxEvent: outboxMocks.enqueueOutboxEvent }))
vi.mock('./services/outboxDispatcher.js', () => ({ requestOutboxDispatch: outboxMocks.dispatchOutboxEvents }))
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

describe('social routes under concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    notificationMocks.createNotification.mockResolvedValue(notification)
    notificationMocks.dismissNotificationByDedupeKey.mockResolvedValue(true)
    outboxMocks.enqueueOutboxEvent.mockResolvedValue({ id: 'event' })
    outboxMocks.dispatchOutboxEvents.mockResolvedValue(undefined)
  })

  it('commits one request and one notification during a 50-request duplicate burst', async () => {
    let pending = false
    friendMocks.sendFriendRequestInTransaction.mockImplementation(async () => {
      if (pending) throw new friendMocks.FriendServiceError('friend_request_already_pending')
      pending = true
      return createdRequest
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => request(server).post('/api/friends/requests').send({ receiverPlayerId: 'player-2' })),
    )

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 409)).toHaveLength(49)
    expect(notificationMocks.createNotification).toHaveBeenCalledTimes(1)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(2)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
  })

  it('lets exactly one terminal action win an accept-versus-decline race', async () => {
    const raceState: { status: 'pending' | 'accepted' | 'declined' } = { status: 'pending' }
    const terminalAction = (nextStatus: 'accepted' | 'declined') => async () => {
      if (raceState.status !== 'pending') throw new friendMocks.FriendServiceError('friend_request_not_pending')
      raceState.status = nextStatus
      return friend
    }
    friendMocks.acceptFriendRequestInTransaction.mockImplementation(terminalAction('accepted'))
    friendMocks.declineFriendRequestInTransaction.mockImplementation(terminalAction('declined'))
    const server = app()

    const responses = await Promise.all([
      request(server).post('/api/friends/requests/request-1/accept'),
      request(server).post('/api/friends/requests/request-1/decline'),
    ])

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1)
    const topics = outboxMocks.enqueueOutboxEvent.mock.calls.map(([, event]) => event.topic)
    if (raceState.status === 'accepted') {
      expect(topics).toEqual(['social.changed', 'notification.created', 'notifications.changed'])
      expect(notificationMocks.createNotification).toHaveBeenCalledOnce()
    } else {
      expect(topics).toEqual(['social.changed', 'notifications.changed'])
      expect(notificationMocks.createNotification).not.toHaveBeenCalled()
    }
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledOnce()
  })

  it('lets exactly one of 30 concurrent removals publish a social change', async () => {
    let friendshipExists = true
    friendMocks.removeFriendInTransaction.mockImplementation(async () => {
      if (!friendshipExists) throw new friendMocks.FriendServiceError('friendship_not_found')
      friendshipExists = false
    })
    const server = app()

    const responses = await Promise.all(
      Array.from({ length: 30 }, () => request(server).delete('/api/friends/player-2')),
    )

    expect(responses.filter((response) => response.status === 204)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 404)).toHaveLength(29)
    expect(outboxMocks.enqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
  })

  it('can retry the business command after an outbox rollback without publishing the failed attempt', async () => {
    friendMocks.sendFriendRequestInTransaction.mockResolvedValue(createdRequest)
    outboxMocks.enqueueOutboxEvent
      .mockRejectedValueOnce(new Error('outbox unavailable'))
      .mockResolvedValue({ id: 'event' })
    const server = app()

    const first = await request(server).post('/api/friends/requests').send({ receiverPlayerId: 'player-2' })
    const retry = await request(server).post('/api/friends/requests').send({ receiverPlayerId: 'player-2' })

    expect(first.status).toBe(500)
    expect(retry.status).toBe(201)
    expect(outboxMocks.dispatchOutboxEvents).toHaveBeenCalledTimes(1)
    expect(friendMocks.sendFriendRequestInTransaction).toHaveBeenCalledTimes(2)
  })
})
