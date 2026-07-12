import { Router } from 'express'
import { ApiError } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { getDashboard, getPracticePlan } from '../services/dashboardService.js'
import { getCurrentPlayer, getOrCreatePlayer, isPlayerProfileComplete } from '../services/playerService.js'

export function dashboardRoutes() {
  const router = Router()

  router.get('/dashboard', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCurrentPlayer(clerkUserId)

      if (!isPlayerProfileComplete(player)) {
        throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
      }

      const dashboard = await getDashboard(player.id, player.timeZone)

      res.json({
        player: {
          id: player.id,
          clerkUserId: player.clerkUserId,
          name: player.name,
          firstName: player.firstName,
          lastName: player.lastName,
          birthDate: player.birthDate ? player.birthDate.toISOString().slice(0, 10) : null,
          username: player.username,
          avatarUrl: player.avatarUrl,
          timeZone: player.timeZone,
          presenceStatus: player.presenceStatus,
          presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
          email: player.email,
          profileComplete: isPlayerProfileComplete(player),
          createdAt: player.createdAt.toISOString(),
        },
        ...dashboard,
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/practice-plan', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getOrCreatePlayer(clerkUserId)

      if (!isPlayerProfileComplete(player)) {
        throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
      }

      const practicePlan = await getPracticePlan(player.id)
      res.json({ practicePlan })
    } catch (error) {
      next(error)
    }
  })

  return router
}
