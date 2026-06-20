import { Router } from 'express'
import { getRequiredAuth } from '../middleware/auth.js'
import { syncPlayerProfile } from '../services/playerService.js'

export function profileRoutes() {
  const router = Router()

  router.get('/me', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await syncPlayerProfile(clerkUserId)

      res.json({
        user: {
          id: player.id,
          clerkUserId: player.clerkUserId,
          name: player.name,
          email: player.email,
          createdAt: player.createdAt.toISOString(),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
