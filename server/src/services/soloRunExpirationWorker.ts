import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { ApiError } from '../errors.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { finishSoloRun } from './soloRunService.js'
import { createAdaptiveWorkerScheduler, IDLE_SCAN_MS } from './adaptiveWorker.js'
import { signalBackgroundWork, subscribeToBackgroundWork } from './backgroundWorkSignals.js'

const SOLO_RUN_EXPIRATION_JOB_KEY = 'solo-run-expiration'
const SOLO_RUN_EXPIRATION_LEASE_MS = 60_000
const SOLO_RUN_EXPIRATION_BATCH_SIZE = 50

let workerStarted = false
let workerRunning = false
let lastSucceededAt: Date | null = null
let lastFailedAt: Date | null = null

type LeaseRow = { job_key: string }

export type SoloRunExpirationSweepResult = {
  candidates: number
  completed: number
  skipped: number
}

export async function acquireSoloRunExpirationLease(
  ownerId: string,
  now = new Date(),
  leaseMs = SOLO_RUN_EXPIRATION_LEASE_MS,
) {
  const lockedUntil = new Date(now.getTime() + leaseMs)
  const rows = await prisma.$queryRaw<LeaseRow[]>(Prisma.sql`
    INSERT INTO "job_leases" ("job_key", "owner_id", "locked_until", "updated_at")
    VALUES (${SOLO_RUN_EXPIRATION_JOB_KEY}, ${ownerId}, ${lockedUntil}, ${now})
    ON CONFLICT ("job_key") DO UPDATE
    SET "owner_id" = EXCLUDED."owner_id",
        "locked_until" = EXCLUDED."locked_until",
        "updated_at" = EXCLUDED."updated_at"
    WHERE "job_leases"."locked_until" <= ${now}
       OR "job_leases"."owner_id" = ${ownerId}
    RETURNING "job_key"
  `)

  return rows.length === 1
}

export async function releaseSoloRunExpirationLease(ownerId: string) {
  await prisma.jobLease.deleteMany({
    where: { key: SOLO_RUN_EXPIRATION_JOB_KEY, ownerId },
  })
}

function wasClosedConcurrently(error: unknown) {
  return error instanceof ApiError
    && (error.code === 'solo_run_closed' || error.code === 'solo_run_completed' || error.code === 'solo_run_not_found')
}

export async function finalizeExpiredSoloRuns(
  now = new Date(),
  batchSize = SOLO_RUN_EXPIRATION_BATCH_SIZE,
): Promise<SoloRunExpirationSweepResult> {
  const candidates = await prisma.soloRun.findMany({
    where: { status: 'active', endsAt: { lte: now } },
    orderBy: { endsAt: 'asc' },
    take: batchSize,
    select: { id: true, playerId: true },
  })

  let completed = 0
  let skipped = 0
  const failures: Array<{ runId: string; error: unknown }> = []

  for (const candidate of candidates) {
    try {
      await finishSoloRun(candidate.playerId, candidate.id)
      completed += 1
    } catch (error) {
      // A player can start another run between candidate selection and the row lock.
      // That transition abandons the old run and is a successful concurrent outcome.
      if (wasClosedConcurrently(error)) {
        skipped += 1
        continue
      }
      failures.push({ runId: candidate.id, error })
      logger.error('solo_run_expiration_finalize_failed', {
        runId: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (failures.length > 0) {
    throw new Error(`Impossible de finaliser ${failures.length} run(s) Solo expire(s).`, {
      cause: failures[0]?.error,
    })
  }

  return { candidates: candidates.length, completed, skipped }
}

export async function runSoloRunExpirationSweep(
  ownerId = `solo-run-expiration:${randomUUID()}`,
  now = new Date(),
) {
  const acquired = await acquireSoloRunExpirationLease(ownerId, now)
  if (!acquired) {
    return {
      acquired: false,
      candidates: 0,
      completed: 0,
      skipped: 0,
    }
  }

  try {
    return {
      acquired: true,
      ...await finalizeExpiredSoloRuns(now),
    }
  } finally {
    await releaseSoloRunExpirationLease(ownerId)
  }
}

async function nextSoloRunExpirationAt(now = new Date()) {
  const run = await prisma.soloRun.findFirst({
    where: { status: 'active' },
    orderBy: { endsAt: 'asc' },
    select: { endsAt: true },
  })
  return run?.endsAt ?? null
}

export function getSoloRunExpirationWorkerHealth() {
  return {
    started: workerStarted,
    running: workerRunning,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
  }
}

export function startSoloRunExpirationWorker() {
  const ownerId = `solo-run-expiration:${process.pid}:${randomUUID()}`
  const scheduler = createAdaptiveWorkerScheduler({
    name: 'solo-run-expiration',
    initialIdleDelayMs: IDLE_SCAN_MS,
    maxIdleDelayMs: IDLE_SCAN_MS,
    overdueRetryDelayMs: 1_000,
    run: async () => {
      const now = new Date()
      const pendingExpiration = await nextSoloRunExpirationAt(now)
      if (!pendingExpiration || pendingExpiration > now) {
        return { workCount: 0, nextRunAt: pendingExpiration }
      }
      const result = await runSoloRunExpirationSweep(ownerId)
      return {
        workCount: result.candidates,
        nextRunAt: result.acquired
          ? await nextSoloRunExpirationAt()
          : new Date(Date.now() + SOLO_RUN_EXPIRATION_LEASE_MS),
      }
    },
    onRunStarted: () => { workerRunning = true },
    onRunSucceeded: () => {
      lastSucceededAt = new Date()
      lastFailedAt = null
    },
    onRunFailed: (error) => {
      lastFailedAt = new Date()
      logger.error('solo_run_expiration_sweep_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    },
    onRunFinished: () => { workerRunning = false },
  })
  const unsubscribe = subscribeToBackgroundWork('solo-run-expiration', () => scheduler.wake())

  workerStarted = true
  scheduler.start()

  return async () => {
    unsubscribe()
    workerStarted = false
    await scheduler.stop()
  }
}

export function requestSoloRunExpirationSweep() {
  signalBackgroundWork('solo-run-expiration')
}
