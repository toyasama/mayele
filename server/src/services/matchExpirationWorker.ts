import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { requestOutboxDispatch } from './outboxDispatcher.js'
import { persistMatchExpiredEffects } from './matchOutboxEffects.js'
import { MATCH_INCLUDE, toMatchView } from './matchServiceView.js'

const MATCH_EXPIRATION_JOB_KEY = 'match-expiration'
const MATCH_EXPIRATION_INTERVAL_MS = 15_000
const MATCH_EXPIRATION_LEASE_MS = 30_000
const COMPLETED_ROOM_TTL_MS = 2 * 60 * 1_000
const ACTIVE_MATCH_STATUSES = ['pending', 'accepted', 'ready', 'in_progress'] as const
let workerStarted = false
let workerRunning = false
let lastSucceededAt: Date | null = null
let lastFailedAt: Date | null = null

type LeaseRow = { job_key: string }

export async function acquireMatchExpirationLease(
  ownerId: string,
  now = new Date(),
  leaseMs = MATCH_EXPIRATION_LEASE_MS,
) {
  const lockedUntil = new Date(now.getTime() + leaseMs)
  const rows = await prisma.$queryRaw<LeaseRow[]>(Prisma.sql`
    INSERT INTO "job_leases" ("job_key", "owner_id", "locked_until", "updated_at")
    VALUES (${MATCH_EXPIRATION_JOB_KEY}, ${ownerId}, ${lockedUntil}, ${now})
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

export async function releaseMatchExpirationLease(ownerId: string) {
  await prisma.jobLease.deleteMany({
    where: { key: MATCH_EXPIRATION_JOB_KEY, ownerId },
  })
}

export async function expirePersistedMatches(now = new Date()) {
  const completedRoomCutoff = new Date(now.getTime() - COMPLETED_ROOM_TTL_MS)

  return prisma.$transaction(async (tx) => {
    await tx.match.updateMany({
      where: {
        status: 'completed',
        finishedAt: { lte: completedRoomCutoff },
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    })

    const candidates = await tx.match.findMany({
      where: {
        status: { in: [...ACTIVE_MATCH_STATUSES] },
        expiresAt: { lte: now },
      },
      select: { id: true },
    })
    if (!candidates.length) return 0

    const candidateIds = candidates.map((candidate) => candidate.id)
    await tx.match.updateMany({
      where: {
        id: { in: candidateIds },
        status: { in: [...ACTIVE_MATCH_STATUSES] },
        expiresAt: { lte: now },
      },
      data: { status: 'expired', finishedAt: now },
    })

    const expiredMatches = await tx.match.findMany({
      where: { id: { in: candidateIds }, status: 'expired' },
      include: MATCH_INCLUDE,
    })
    for (const match of expiredMatches) {
      await persistMatchExpiredEffects(tx, toMatchView(match))
    }

    return expiredMatches.length
  })
}

export async function runMatchExpirationSweep(ownerId = `match-expiration:${randomUUID()}`, now = new Date()) {
  const acquired = await acquireMatchExpirationLease(ownerId, now)
  if (!acquired) return { acquired: false, expiredMatches: 0 }

  try {
    const expiredMatches = await expirePersistedMatches(now)
    if (expiredMatches > 0) requestOutboxDispatch()
    return { acquired: true, expiredMatches }
  } finally {
    await releaseMatchExpirationLease(ownerId)
  }
}

export function getMatchExpirationWorkerHealth() {
  return {
    started: workerStarted,
    running: workerRunning,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
  }
}

export function startMatchExpirationWorker() {
  const ownerId = `match-expiration:${process.pid}:${randomUUID()}`
  let sweepPromise: Promise<unknown> | null = null

  const sweep = () => {
    if (sweepPromise) return sweepPromise
    workerRunning = true
    sweepPromise = runMatchExpirationSweep(ownerId)
      .then((result) => {
        lastSucceededAt = new Date()
        lastFailedAt = null
        return result
      })
      .catch((error) => {
        lastFailedAt = new Date()
        logger.error('match_expiration_sweep_failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        sweepPromise = null
        workerRunning = false
      })
    return sweepPromise
  }

  workerStarted = true
  void sweep()
  const timer = setInterval(() => void sweep(), MATCH_EXPIRATION_INTERVAL_MS)
  timer.unref()

  return async () => {
    clearInterval(timer)
    workerStarted = false
    await sweepPromise
  }
}
