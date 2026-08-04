import { Router } from 'express'
import { getMatchExpirationWorkerHealth } from '../services/matchExpirationWorker.js'
import { getOutboxDispatcherHealth } from '../services/outboxDispatcher.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { isAdminClerkUser, requireAdmin, requireRecentVerification } from '../middleware/admin.js'
import { adminDestructiveActionSchema, adminPlayerParamsSchema, adminUsersQuerySchema } from '../schemas/adminSchema.js'
import { deletePlayerAccount, getAdminOverview, listAdminUsers, resetPlayerProgress } from '../services/adminService.js'

export function adminRoutes() {
  const router = Router()

  router.get('/admin/access', (req, res) => {
    const { clerkUserId } = getRequiredAuth(req)
    res.set('Cache-Control', 'private, no-store')
    res.json({ isAdmin: isAdminClerkUser(clerkUserId) })
  })

  router.use('/admin', requireAdmin)

  router.get('/admin/overview', async (_req, res, next) => {
    try {
      const overview = await getAdminOverview()
      res.set('Cache-Control', 'private, no-store')
      res.json({
        ...overview,
        workers: {
          outbox: getOutboxDispatcherHealth(),
          matchExpiration: getMatchExpirationWorkerHealth(),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/users', async (req, res, next) => {
    try {
      const query = adminUsersQuerySchema.parse(req.query)
      res.set('Cache-Control', 'private, no-store')
      res.json(await listAdminUsers(query))
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/users/:playerId/reset-progress', requireRecentVerification, async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const { playerId } = adminPlayerParamsSchema.parse(req.params)
      const { confirmation } = adminDestructiveActionSchema.parse(req.body)
      const result = await resetPlayerProgress(clerkUserId, playerId, confirmation)
      res.json({ success: true, ...result })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/admin/users/:playerId', requireRecentVerification, async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const { playerId } = adminPlayerParamsSchema.parse(req.params)
      const { confirmation } = adminDestructiveActionSchema.parse(req.body)
      await deletePlayerAccount(clerkUserId, playerId, confirmation)
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}
