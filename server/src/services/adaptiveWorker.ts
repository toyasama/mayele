import { env } from '../config/env.js'

// With one API replica, local mutation signals wake workers immediately. A
// longer fallback scan leaves enough idle time for Neon to scale to zero.
export const IDLE_SCAN_MS = env.realtimePostgresAdapterEnabled ? 5 * 60_000 : 30 * 60_000

export type AdaptiveSweepResult = {
  workCount: number
  nextRunAt?: Date | null
}

type AdaptiveWorkerOptions = {
  name: string
  initialIdleDelayMs: number
  maxIdleDelayMs: number
  busyDelayMs?: number
  errorDelayMs?: number
  overdueRetryDelayMs?: number
  run: () => Promise<AdaptiveSweepResult>
  onRunStarted?: () => void
  onRunSucceeded?: (result: AdaptiveSweepResult) => void
  onRunFailed?: (error: unknown) => void
  onRunFinished?: () => void
}

export type AdaptiveWorkerScheduler = ReturnType<typeof createAdaptiveWorkerScheduler>

function boundedDelay(delayMs: number, maximumMs: number) {
  if (!Number.isFinite(delayMs)) return maximumMs
  return Math.max(0, Math.min(maximumMs, Math.ceil(delayMs)))
}

/**
 * Schedules durable database work without a permanently hot polling loop.
 *
 * A local mutation can call wake() for immediate processing. The deadline
 * returned by a sweep is used when known, while maxIdleDelayMs remains a
 * cross-instance/restart safety scan for work created elsewhere.
 */
export function createAdaptiveWorkerScheduler(options: AdaptiveWorkerOptions) {
  let started = false
  let timer: NodeJS.Timeout | null = null
  let runningPromise: Promise<void> | null = null
  let wakeRequested = false
  let idleDelayMs = 0
  let scheduledFor: Date | null = null

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
    scheduledFor = null
  }

  const schedule = (delayMs: number) => {
    if (!started) return
    clearTimer()
    const delay = boundedDelay(delayMs, options.maxIdleDelayMs)
    scheduledFor = new Date(Date.now() + delay)
    timer = setTimeout(() => {
      timer = null
      scheduledFor = null
      void execute()
    }, delay)
    timer.unref()
  }

  const nextDelay = (result: AdaptiveSweepResult) => {
    if (result.workCount > 0) {
      idleDelayMs = 0
      return options.busyDelayMs ?? 25
    }
    if (result.nextRunAt) {
      idleDelayMs = 0
      const deadlineDelayMs = result.nextRunAt.getTime() - Date.now()
      // A different instance can still own an overdue item. Avoid spinning on
      // the same past deadline while its transaction or lease is in flight.
      return deadlineDelayMs <= 0
        ? options.overdueRetryDelayMs ?? Math.min(options.initialIdleDelayMs, 1_000)
        : boundedDelay(deadlineDelayMs, options.maxIdleDelayMs)
    }
    idleDelayMs = idleDelayMs === 0
      ? options.initialIdleDelayMs
      : Math.min(options.maxIdleDelayMs, idleDelayMs * 2)
    return idleDelayMs
  }

  const execute = async () => {
    if (!started) return
    if (runningPromise) {
      wakeRequested = true
      return runningPromise
    }

    options.onRunStarted?.()
    runningPromise = (async () => {
      let delayAfterRun = options.errorDelayMs ?? 1_000
      try {
        const result = await options.run()
        options.onRunSucceeded?.(result)
        delayAfterRun = nextDelay(result)
      } catch (error) {
        options.onRunFailed?.(error)
      } finally {
        options.onRunFinished?.()
      }

      const runAgainImmediately = wakeRequested
      wakeRequested = false
      runningPromise = null
      if (started) schedule(runAgainImmediately ? 0 : delayAfterRun)
    })()

    return runningPromise
  }

  return {
    start() {
      if (started) return
      started = true
      wakeRequested = false
      schedule(0)
    },
    wake() {
      if (!started) {
        wakeRequested = true
        return
      }
      idleDelayMs = 0
      if (runningPromise) {
        wakeRequested = true
        return
      }
      schedule(0)
    },
    async stop() {
      started = false
      wakeRequested = false
      clearTimer()
      await runningPromise
    },
    getState() {
      return {
        name: options.name,
        started,
        running: Boolean(runningPromise),
        scheduledFor: scheduledFor?.toISOString() ?? null,
      }
    },
  }
}
