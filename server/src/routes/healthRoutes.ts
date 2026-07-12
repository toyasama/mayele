import { Router } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { getRealtimeHealth } from '../realtime/notifications.js'

export function healthRoutes() {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/ready', async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      const realtime = getRealtimeHealth()

      if (env.isProduction && !realtime.initialized) {
        res.status(503).json({ status: 'not_ready', realtime })
        return
      }

      res.json({ status: 'ready', realtime })
    } catch (error) {
      next(error)
    }
  })

  return router
}
