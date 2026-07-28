import { Router } from 'express'
import { ApiError } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { startSoloRunSchema, submitSoloAnswerSchema } from '../schemas/soloRunSchema.js'
import { getOrCreatePlayer, isPlayerProfileComplete } from '../services/playerService.js'
import {
  finishSoloRun,
  getActiveSoloRun,
  getSoloRun,
  startSoloRun,
  submitSoloAnswer,
} from '../services/soloRunService.js'

async function requiredPlayer(clerkUserId: string) {
  const player = await getOrCreatePlayer(clerkUserId)

  if (!isPlayerProfileComplete(player)) {
    throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
  }

  return player
}

export function sessionRoutes() {
  const router = Router()

  router.post('/sessions', async (req, res, next) => {
    try {
      getRequiredAuth(req)
      throw new ApiError(
        410,
        'Cette version de sauvegarde Solo n’est plus acceptée. Démarrez une nouvelle partie.',
        'legacy_session_submission_disabled',
      )
    } catch (error) {
      next(error)
    }
  })

  router.post('/solo-runs', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await requiredPlayer(clerkUserId)
      const run = await startSoloRun(player.id, startSoloRunSchema.parse(req.body))
      res.status(201).json({ run })
    } catch (error) {
      next(error)
    }
  })

  router.get('/solo-runs/active', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await requiredPlayer(clerkUserId)
      res.json({ run: await getActiveSoloRun(player.id) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/solo-runs/:runId', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await requiredPlayer(clerkUserId)
      res.json({ run: await getSoloRun(player.id, req.params.runId) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/solo-runs/:runId/answers', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await requiredPlayer(clerkUserId)
      const response = await submitSoloAnswer(player.id, req.params.runId, submitSoloAnswerSchema.parse(req.body))
      res.json(response)
    } catch (error) {
      next(error)
    }
  })

  router.post('/solo-runs/:runId/finish', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await requiredPlayer(clerkUserId)
      res.json({ run: await finishSoloRun(player.id, req.params.runId) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
