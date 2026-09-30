import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  emitMatchSnapshot,
  emitMatchTempoAnswerRecorded,
  emitMatchTempoProgress,
} from '../realtime/notifications.js'
import { completePersistedTempoMatch } from './matchService.js'
import { serializeMatch } from './matchPresenter.js'
import { processExpiredTempoQuestions } from './tempoMatchCoordinator.js'
import { createAdaptiveWorkerScheduler, IDLE_SCAN_MS } from './adaptiveWorker.js'
import { signalBackgroundWork, subscribeToBackgroundWork } from './backgroundWorkSignals.js'

let workerStarted = false
let workerRunning = false
let lastSucceededAt: Date | null = null
let lastFailedAt: Date | null = null

export async function runTempoMatchSweep() {
  const resolvedQuestions = await processExpiredTempoQuestions()

  for (const resolved of resolvedQuestions) {
    if (resolved.terminal) {
      const completed = await completePersistedTempoMatch(resolved.match.id)
      if (completed) {
        emitMatchSnapshot(completed, 'match_completed')
      }
      continue
    }

    const snapshot = serializeMatch(resolved.match)
    emitMatchTempoProgress(snapshot, resolved.progress, 'match_tempo_question_timeout')
    for (const playerId of resolved.timedOutPlayerIds) {
      emitMatchTempoAnswerRecorded(
        snapshot,
        resolved.progress.questionIndex,
        playerId,
        'match_tempo_timeout_recorded',
      )
    }
    emitMatchSnapshot(resolved.match, 'match_tempo_question_timeout')
  }

  return resolvedQuestions.length
}

async function nextTempoDeadline() {
  const [match] = await prisma.$queryRaw<Array<{ deadline: Date | null }>>`
    SELECT "tempo_question_deadline_at" AS "deadline"
    FROM "matches"
    WHERE "status" = 'in_progress' AND "challenge_mode" = 'tempo'
    ORDER BY "tempo_question_deadline_at" ASC NULLS FIRST
    LIMIT 1
  `
  // A terminal Tempo match has no next deadline but still needs finalizing.
  return match ? match.deadline ?? new Date(0) : null
}

export function getTempoMatchWorkerHealth() {
  return {
    started: workerStarted,
    running: workerRunning,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
  }
}

export function startTempoMatchWorker() {
  const scheduler = createAdaptiveWorkerScheduler({
    name: 'tempo-match',
    initialIdleDelayMs: IDLE_SCAN_MS,
    maxIdleDelayMs: IDLE_SCAN_MS,
    overdueRetryDelayMs: 250,
    run: async () => {
      const now = new Date()
      const pendingDeadline = await nextTempoDeadline()
      if (!pendingDeadline || pendingDeadline > now) {
        return { workCount: 0, nextRunAt: pendingDeadline }
      }
      return {
        workCount: await runTempoMatchSweep(),
        nextRunAt: await nextTempoDeadline(),
      }
    },
    onRunStarted: () => { workerRunning = true },
    onRunSucceeded: () => {
      lastSucceededAt = new Date()
      lastFailedAt = null
    },
    onRunFailed: (error) => {
      lastFailedAt = new Date()
      logger.error('tempo_match_sweep_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    },
    onRunFinished: () => { workerRunning = false },
  })
  const unsubscribe = subscribeToBackgroundWork('tempo-match', () => scheduler.wake())

  workerStarted = true
  scheduler.start()

  return async () => {
    unsubscribe()
    workerStarted = false
    await scheduler.stop()
  }
}

export function requestTempoMatchSweep() {
  signalBackgroundWork('tempo-match')
}
