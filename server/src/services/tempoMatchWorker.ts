import { logger } from '../lib/logger.js'
import {
  emitMatchSnapshot,
  emitMatchTempoAnswerRecorded,
  emitMatchTempoProgress,
} from '../realtime/notifications.js'
import { completePersistedTempoMatch } from './matchService.js'
import { serializeMatch } from './matchPresenter.js'
import { processExpiredTempoQuestions } from './tempoMatchCoordinator.js'

const TEMPO_SWEEP_INTERVAL_MS = 250
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

export function getTempoMatchWorkerHealth() {
  return {
    started: workerStarted,
    running: workerRunning,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
  }
}

export function startTempoMatchWorker() {
  let sweepPromise: Promise<unknown> | null = null

  const sweep = () => {
    if (sweepPromise) return sweepPromise
    workerRunning = true
    sweepPromise = runTempoMatchSweep()
      .then((result) => {
        lastSucceededAt = new Date()
        lastFailedAt = null
        return result
      })
      .catch((error) => {
        lastFailedAt = new Date()
        logger.error('tempo_match_sweep_failed', {
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
  const timer = setInterval(() => void sweep(), TEMPO_SWEEP_INTERVAL_MS)
  timer.unref()

  return async () => {
    clearInterval(timer)
    workerStarted = false
    await sweepPromise
  }
}
