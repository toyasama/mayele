import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

export function healthRoutes() {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/ready', async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: 'ready' })
    } catch (error) {
      next(error)
    }
  })

  return router
}
