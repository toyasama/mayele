import { Router } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { getRealtimeHealth } from '../realtime/notifications.js'
import { getMatchExpirationWorkerHealth } from '../services/matchExpirationWorker.js'
import { getOutboxDispatcherHealth } from '../services/outboxDispatcher.js'

export function healthRoutes() {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      const realtime = getRealtimeHealth()
      const outbox = getOutboxDispatcherHealth()
      const matchExpiration = getMatchExpirationWorkerHealth()
      const backgroundReady = (
        outbox.started
        && Boolean(outbox.lastSucceededAt)
        && !outbox.lastFailedAt
        && matchExpiration.started
        && Boolean(matchExpiration.lastSucceededAt)
        && !matchExpiration.lastFailedAt
      )

      if (env.isProduction && (!realtime.initialized || !backgroundReady)) {
        res.status(503).json({ status: 'not_ready', realtime, background: { outbox, matchExpiration } })
        return
      }

      res.json({ status: 'ready', realtime, background: { outbox, matchExpiration } })
    } catch (error) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'database_unavailable',
        message: env.isProduction ? undefined : error instanceof Error ? error.message : String(error),
      })
    }
  })

  return router
}
