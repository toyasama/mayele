import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transaction = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  outboxEvent: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
}))
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  outboxEvent: {
    update: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const { claimOutboxEvents, markOutboxFailed } = await import('./outboxService.js')

describe('outboxService recovery and retry boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.outboxEvent.updateMany.mockResolvedValue({ count: 0 })
    transaction.outboxEvent.findMany.mockResolvedValue([])
    prismaMock.outboxEvent.update.mockResolvedValue({ id: 'event-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expresses stale-lock recovery and SKIP LOCKED in the atomic claim query', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([])

    await claimOutboxEvents(17)

    const [strings, limit] = transaction.$queryRaw.mock.calls[0] as [TemplateStringsArray, number]
    const sql = strings.join('?').replace(/\s+/g, ' ').trim()

    expect(sql).toContain(`"status" IN ('pending', 'failed')`)
    expect(sql).toContain(`"status" = 'processing'`)
    expect(sql).toContain(`"locked_at" < CURRENT_TIMESTAMP - INTERVAL '30 seconds'`)
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).toContain('LIMIT ?')
    expect(limit).toBe(17)
    expect(transaction.outboxEvent.updateMany).not.toHaveBeenCalled()
  })

  it('keeps simultaneous claims disjoint when the database returns disjoint locked rows', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([{ id: 'c' }, { id: 'd' }])
    transaction.outboxEvent.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([{ id: 'c' }, { id: 'd' }])

    const [first, second] = await Promise.all([claimOutboxEvents(2), claimOutboxEvents(2)])

    expect(first.map((event) => event.id)).toEqual(['a', 'b'])
    expect(second.map((event) => event.id)).toEqual(['c', 'd'])
    expect(transaction.outboxEvent.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: { in: ['a', 'b'] } },
    }))
    expect(transaction.outboxEvent.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: { in: ['c', 'd'] } },
    }))
  })

  it.each([
    { attempts: 0, delaySeconds: 1 },
    { attempts: 1, delaySeconds: 2 },
    { attempts: 2, delaySeconds: 4 },
    { attempts: 8, delaySeconds: 256 },
    { attempts: 50, delaySeconds: 256 },
  ])('schedules retry $attempts after $delaySeconds seconds', async ({ attempts, delaySeconds }) => {
    vi.useFakeTimers()
    const now = new Date('2026-07-19T12:00:00.000Z')
    vi.setSystemTime(now)

    await markOutboxFailed('event-1', attempts, new Error('temporary failure'))

    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'failed',
        lockedAt: null,
        availableAt: new Date(now.getTime() + delaySeconds * 1_000),
      }),
    })
  })

  it('truncates an oversized transport error before persisting it', async () => {
    const oversizedMessage = 'x'.repeat(5_000)

    await markOutboxFailed('event-1', 3, new Error(oversizedMessage))

    const update = prismaMock.outboxEvent.update.mock.calls[0][0]
    expect(update.data.lastError).toHaveLength(2_000)
    expect(update.data.lastError).toBe('x'.repeat(2_000))
  })
})
