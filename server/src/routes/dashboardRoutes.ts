import { Router } from 'express'
import { getRequiredAuth } from '../middleware/auth.js'
import { getDashboard } from '../services/dashboardService.js'
import { getOrCreatePlayer } from '../services/playerService.js'

export function dashboardRoutes() {
  const router = Router()

  router.get('/dashboard', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getOrCreatePlayer(clerkUserId)
      res.json(await getDashboard(player.id))
    } catch (error) {
      next(error)
    }
  })

  router.get('/practice-plan', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getOrCreatePlayer(clerkUserId)
      const dashboard = await getDashboard(player.id)
      res.json({ practicePlan: dashboard.practicePlan })
    } catch (error) {
      next(error)
    }
  })

  return router
}
