import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdaptiveWorkerScheduler } from './adaptiveWorker.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('adaptive worker scheduler', () => {
  it('backs off while idle and wakes immediately on a local signal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
    const run = vi.fn().mockResolvedValue({ workCount: 0 })
    const scheduler = createAdaptiveWorkerScheduler({
      name: 'test',
      initialIdleDelayMs: 1_000,
      maxIdleDelayMs: 8_000,
      run,
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.wake()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(3)

    await scheduler.stop()
  })

  it('sleeps until the next known deadline instead of polling', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-13T10:00:00.000Z')
    vi.setSystemTime(now)
    const run = vi.fn()
      .mockResolvedValueOnce({ workCount: 0, nextRunAt: new Date(now.getTime() + 5_000) })
      .mockResolvedValue({ workCount: 0 })
    const scheduler = createAdaptiveWorkerScheduler({
      name: 'deadline-test',
      initialIdleDelayMs: 1_000,
      maxIdleDelayMs: 15_000,
      run,
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    await scheduler.stop()
  })

  it('coalesces signals received during a sweep into one immediate rerun', async () => {
    vi.useFakeTimers()
    let releaseFirstRun: (() => void) | undefined
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<{ workCount: number }>((resolve) => {
        releaseFirstRun = () => resolve({ workCount: 0 })
      }))
      .mockResolvedValue({ workCount: 0 })
    const scheduler = createAdaptiveWorkerScheduler({
      name: 'coalescing-test',
      initialIdleDelayMs: 1_000,
      maxIdleDelayMs: 8_000,
      run,
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.wake()
    scheduler.wake()
    releaseFirstRun?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)

    await scheduler.stop()
  })

  it('does not spin on an overdue deadline owned by another instance', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-13T10:00:00.000Z')
    vi.setSystemTime(now)
    const run = vi.fn().mockResolvedValue({
      workCount: 0,
      nextRunAt: new Date(now.getTime() - 1_000),
    })
    const scheduler = createAdaptiveWorkerScheduler({
      name: 'overdue-test',
      initialIdleDelayMs: 500,
      maxIdleDelayMs: 8_000,
      run,
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(499)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    await scheduler.stop()
  })
})
