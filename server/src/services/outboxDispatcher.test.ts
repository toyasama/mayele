import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboxMocks = vi.hoisted(() => ({
  claimOutboxEvents: vi.fn(),
  markOutboxPublished: vi.fn(),
  markOutboxFailed: vi.fn(),
}))
const realtimeMocks = vi.hoisted(() => ({
  emitNotificationCreated: vi.fn(),
  emitNotificationsChanged: vi.fn(),
  emitSocialChanged: vi.fn(),
  emitSerializedMatchSnapshot: vi.fn(),
}))

vi.mock('./outboxService.js', () => outboxMocks)
vi.mock('../realtime/notifications.js', () => realtimeMocks)
vi.mock('../lib/logger.js', () => ({ logger: { error: vi.fn() } }))

const { dispatchOutboxEvents } = await import('./outboxDispatcher.js')

describe('outboxDispatcher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publie les signaux sociaux et notifications puis acquitte chaque événement', async () => {
    outboxMocks.claimOutboxEvents.mockResolvedValueOnce([
      {
        id: 'social-1',
        topic: 'social.changed',
        attempts: 1,
        payload: { playerIds: ['a', 'b'], reason: 'friend_request_sent' },
      },
      {
        id: 'notification-1',
        topic: 'notification.created',
        attempts: 1,
        payload: { playerId: 'b', reason: 'notification_created', notification: { id: 'n-1' } },
      },
      {
        id: 'match-1',
        topic: 'match.changed',
        attempts: 1,
        payload: { match: { id: 'm-1' }, reason: 'match_expired', commandId: null },
      },
    ])

    await dispatchOutboxEvents()

    expect(realtimeMocks.emitSocialChanged).toHaveBeenCalledWith(['a', 'b'], 'friend_request_sent')
    expect(realtimeMocks.emitNotificationCreated).toHaveBeenCalledWith('b', 'notification_created', { id: 'n-1' })
    expect(realtimeMocks.emitSerializedMatchSnapshot).toHaveBeenCalledWith({ id: 'm-1' }, 'match_expired', null)
    expect(outboxMocks.markOutboxPublished).toHaveBeenCalledTimes(3)
    expect(outboxMocks.markOutboxFailed).not.toHaveBeenCalled()
  })

  it('conserve l’événement en échec quand le topic ne peut pas être publié', async () => {
    outboxMocks.claimOutboxEvents.mockResolvedValueOnce([
      { id: 'bad-1', topic: 'unknown', attempts: 3, payload: {} },
    ])

    await dispatchOutboxEvents()

    expect(outboxMocks.markOutboxPublished).not.toHaveBeenCalled()
    expect(outboxMocks.markOutboxFailed).toHaveBeenCalledWith('bad-1', 3, expect.any(Error))
  })
})
