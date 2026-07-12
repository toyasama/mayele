import { Router } from 'express'
import { ApiError } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { parseSessionPayload } from '../schemas/sessionSchema.js'
import { getOrCreatePlayer, isPlayerProfileComplete } from '../services/playerService.js'
import { saveSession } from '../services/sessionService.js'

export function sessionRoutes() {
  const router = Router()

  router.post('/sessions', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getOrCreatePlayer(clerkUserId)

      if (!isPlayerProfileComplete(player)) {
        throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
      }

      const payload = parseSessionPayload(req.body)
      const result = await saveSession(player.id, payload, player.timeZone)

      res.status(201).json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}
