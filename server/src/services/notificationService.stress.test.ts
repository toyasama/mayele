import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  notification: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const {
  createNotification,
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = await import('./notificationService.js')

describe('notificationService under large inboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caps the payload at 20 while counting every unread notification', async () => {
    const notifications = Array.from({ length: 20 }, (_, index) => ({ id: `notification-${index}` }))
    prismaMock.notification.findMany.mockResolvedValueOnce(notifications)
    prismaMock.notification.count.mockResolvedValueOnce(1_500)

    await expect(listNotifications('player-1')).resolves.toEqual({
      notifications,
      unreadCount: 1_500,
    })

    expect(prismaMock.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { playerId: 'player-1', status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }))
    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { playerId: 'player-1', status: 'active', readAt: null },
    })
  })

  it('uses player-scoped dedupe keys for a 100-notification creation burst', async () => {
    prismaMock.notification.upsert.mockImplementation(async ({ where, create }) => ({
      ...create,
      id: `${where.playerId_dedupeKey.playerId}:${where.playerId_dedupeKey.dedupeKey}`,
    }))

    const created = await Promise.all(
      Array.from({ length: 100 }, (_, index) => createNotification({
        playerId: 'player-1',
        type: 'stress',
        title: `Notification ${index}`,
        dedupeKey: `stress:${index}`,
      })),
    )

    expect(created).toHaveLength(100)
    expect(new Set(created.map((notification) => notification.id)).size).toBe(100)
    expect(prismaMock.notification.upsert).toHaveBeenCalledTimes(100)
    expect(prismaMock.notification.upsert.mock.calls.every(([input]) =>
      input.where.playerId_dedupeKey.playerId === 'player-1')).toBe(true)
  })

  it('reactivates the same dedupe key instead of requiring a second row', async () => {
    prismaMock.notification.upsert.mockResolvedValue({ id: 'stable-notification' })

    await Promise.all(
      Array.from({ length: 30 }, () => createNotification({
        playerId: 'player-1',
        actorPlayerId: 'player-2',
        type: 'friend_request_received',
        title: 'Nouvelle demande',
        dedupeKey: 'friend_request:request-1:received',
      })),
    )

    expect(prismaMock.notification.upsert).toHaveBeenCalledTimes(30)
    expect(prismaMock.notification.upsert.mock.calls.every(([input]) =>
      input.where.playerId_dedupeKey.playerId === 'player-1'
      && input.where.playerId_dedupeKey.dedupeKey === 'friend_request:request-1:received'
      && input.update.status === 'active'
      && input.update.readAt === null
      && input.update.dismissedAt === null)).toBe(true)
  })

  it('keeps read and dismiss mutations scoped to the owner and active state', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 })

    await markNotificationRead('player-1', 'notification-1')
    await dismissNotification('player-1', 'notification-1')

    expect(prismaMock.notification.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'notification-1',
        playerId: 'player-1',
        status: 'active',
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    })
    expect(prismaMock.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'notification-1', playerId: 'player-1', status: 'active' },
      data: { status: 'dismissed', dismissedAt: expect.any(Date) },
    })
  })

  it('marks only active unread rows during read-all', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 2_000 })

    await expect(markAllNotificationsRead('player-1')).resolves.toEqual({ count: 2_000 })
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { playerId: 'player-1', status: 'active', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })
})
