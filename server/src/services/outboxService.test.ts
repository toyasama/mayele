import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '../generated/prisma/client.js'

const transaction = {
  $queryRaw: vi.fn(),
  outboxEvent: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
}
const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  outboxEvent: {
    update: vi.fn(),
  },
}

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const { claimOutboxEvents, enqueueOutboxEvent, markOutboxFailed, markOutboxPublished } = await import('./outboxService.js')

describe('outboxService', () => {
  it('écrit l’événement dans la transaction métier reçue', async () => {
    const create = vi.fn(async ({ data }) => ({ id: 'event-1', ...data }))
    const tx = { outboxEvent: { create } } as unknown as Prisma.TransactionClient

    await enqueueOutboxEvent(tx, {
      dedupeKey: 'friend-request:1',
      topic: 'social.changed',
      aggregateType: 'friend_request',
      aggregateId: 'request-1',
      payload: { playerIds: ['a', 'b'], reason: 'friend_request_sent' },
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: 'friend-request:1',
        topic: 'social.changed',
        aggregateId: 'request-1',
      }),
    })
  })

  it('revendique un lot verrouillé et incrémente les tentatives', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: 'event-1' }, { id: 'event-2' }])
    transaction.outboxEvent.updateMany.mockResolvedValueOnce({ count: 2 })
    transaction.outboxEvent.findMany.mockResolvedValueOnce([{ id: 'event-1' }, { id: 'event-2' }])

    const result = await claimOutboxEvents(2)

    expect(result).toHaveLength(2)
    expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2'] } },
      data: {
        status: 'processing',
        lockedAt: expect.any(Date),
        attempts: { increment: 1 },
      },
    })
    expect(transaction.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2'] }, lockedAt: expect.any(Date) },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('marque explicitement le succès ou programme un retry borné', async () => {
    prismaMock.outboxEvent.update.mockResolvedValue({ id: 'event-1' })

    await markOutboxPublished('event-1')
    await markOutboxFailed('event-1', 12, new Error('transport indisponible'))

    expect(prismaMock.outboxEvent.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'event-1' },
      data: expect.objectContaining({ status: 'published', publishedAt: expect.any(Date), lockedAt: null }),
    })
    expect(prismaMock.outboxEvent.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'failed',
        lockedAt: null,
        lastError: 'transport indisponible',
        availableAt: expect.any(Date),
      }),
    })
  })
})
