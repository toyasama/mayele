import { Router } from 'express'
import { getRequiredAuth } from '../middleware/auth.js'
import { parseSessionPayload } from '../schemas/sessionSchema.js'
import { getOrCreatePlayer } from '../services/playerService.js'
import { saveSession } from '../services/sessionService.js'

export function sessionRoutes() {
  const router = Router()

  router.post('/sessions', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getOrCreatePlayer(clerkUserId)
      const payload = parseSessionPayload(req.body)
      const result = await saveSession(player.id, payload)

      res.status(201).json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}
