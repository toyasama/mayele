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
}))
const loggerMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('./outboxService.js', () => outboxMocks)
vi.mock('../realtime/notifications.js', () => realtimeMocks)
vi.mock('../lib/logger.js', () => ({ logger: loggerMocks }))

const { dispatchOutboxEvents } = await import('./outboxDispatcher.js')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function socialEvent(index: number) {
  return {
    id: `social-${index}`,
    topic: 'social.changed',
    attempts: 1,
    payload: { playerIds: [`player-${index}`, 'observer'], reason: `burst-${index}` },
  }
}

describe('outboxDispatcher under concurrency and bursts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    outboxMocks.claimOutboxEvents.mockResolvedValue([])
    outboxMocks.markOutboxPublished.mockResolvedValue(undefined)
    outboxMocks.markOutboxFailed.mockResolvedValue(undefined)
  })

  it('coalesces simultaneous wake-ups into one database claim', async () => {
    const claim = deferred<Array<ReturnType<typeof socialEvent>>>()
    outboxMocks.claimOutboxEvents.mockReturnValueOnce(claim.promise)

    const wakeUps = Array.from({ length: 100 }, () => dispatchOutboxEvents())

    expect(new Set(wakeUps).size).toBe(1)
    expect(outboxMocks.claimOutboxEvents).toHaveBeenCalledTimes(1)

    claim.resolve([socialEvent(1)])
    await Promise.all(wakeUps)

    expect(realtimeMocks.emitSocialChanged).toHaveBeenCalledTimes(1)
    expect(outboxMocks.markOutboxPublished).toHaveBeenCalledWith('social-1')
  })

  it('allows a later wake-up after a claim failure', async () => {
    outboxMocks.claimOutboxEvents
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([socialEvent(2)])

    await expect(dispatchOutboxEvents()).rejects.toThrow('database unavailable')
    await expect(dispatchOutboxEvents()).resolves.toBeUndefined()

    expect(outboxMocks.claimOutboxEvents).toHaveBeenCalledTimes(2)
    expect(outboxMocks.markOutboxPublished).toHaveBeenCalledWith('social-2')
  })

  it('publishes a full batch without losing order', async () => {
    const events = Array.from({ length: 25 }, (_, index) => socialEvent(index))
    outboxMocks.claimOutboxEvents.mockResolvedValueOnce(events)

    await dispatchOutboxEvents()

    expect(realtimeMocks.emitSocialChanged).toHaveBeenCalledTimes(25)
    expect(outboxMocks.markOutboxPublished.mock.calls.map(([id]) => id)).toEqual(
      events.map((event) => event.id),
    )
    expect(outboxMocks.markOutboxFailed).not.toHaveBeenCalled()
  })

  it('isolates one broken event and continues publishing the rest of the batch', async () => {
    const events = Array.from({ length: 12 }, (_, index) => socialEvent(index))
    outboxMocks.claimOutboxEvents.mockResolvedValueOnce(events)
    realtimeMocks.emitSocialChanged.mockImplementation((_playerIds, reason: string) => {
      if (reason === 'burst-5') throw new Error('socket adapter unavailable')
    })

    await dispatchOutboxEvents()

    expect(outboxMocks.markOutboxFailed).toHaveBeenCalledOnce()
    expect(outboxMocks.markOutboxFailed).toHaveBeenCalledWith(
      'social-5',
      1,
      expect.objectContaining({ message: 'socket adapter unavailable' }),
    )
    expect(outboxMocks.markOutboxPublished).toHaveBeenCalledTimes(11)
    expect(outboxMocks.markOutboxPublished).toHaveBeenLastCalledWith('social-11')
    expect(loggerMocks.error).toHaveBeenCalledOnce()
  })

  it('rejects malformed payloads while preserving valid neighbors', async () => {
    outboxMocks.claimOutboxEvents.mockResolvedValueOnce([
      socialEvent(1),
      { id: 'malformed', topic: 'social.changed', attempts: 4, payload: null },
      socialEvent(3),
    ])

    await dispatchOutboxEvents()

    expect(outboxMocks.markOutboxPublished.mock.calls.map(([id]) => id)).toEqual(['social-1', 'social-3'])
    expect(outboxMocks.markOutboxFailed).toHaveBeenCalledWith('malformed', 4, expect.any(Error))
  })
})
