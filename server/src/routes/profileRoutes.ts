import { Router } from 'express'
import { badRequest } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { emitPresenceChanged } from '../realtime/notifications.js'
import { parsePresencePayload, parseProfilePayload, parseTimeZonePayload } from '../schemas/profileSchema.js'
import { listFriends } from '../services/friendService.js'
import {
  getCurrentPlayer,
  isPlayerProfileComplete,
  ProfileServiceError,
  updatePlayerPresence,
  updatePlayerTimeZone,
  upsertPlayerProfile,
} from '../services/playerService.js'

function serializeProfileUser(player: Awaited<ReturnType<typeof getCurrentPlayer>>) {
  const birthDate = player.birthDate ? player.birthDate.toISOString().slice(0, 10) : null

  return {
    id: player.id,
    clerkUserId: player.clerkUserId,
    name: player.name,
    firstName: player.firstName,
    lastName: player.lastName,
    birthDate,
    username: player.username,
    avatarUrl: player.avatarUrl,
    timeZone: player.timeZone,
    presenceStatus: player.presenceStatus,
    presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
    email: player.email,
    profileComplete: isPlayerProfileComplete(player),
    createdAt: player.createdAt.toISOString(),
  }
}

function isUniqueUsernameConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002' &&
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'target' in error.meta &&
    Array.isArray(error.meta.target) &&
    error.meta.target.includes('username')
  )
}

export function profileRoutes() {
  const router = Router()

  router.get('/me', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCurrentPlayer(clerkUserId)

      res.json({
        user: serializeProfileUser(player),
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/me/profile', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const payload = parseProfilePayload(req.body)
      const player = await upsertPlayerProfile(clerkUserId, payload)

      res.json({
        user: serializeProfileUser(player),
      })
    } catch (error) {
      if (error instanceof ProfileServiceError && error.code === 'username_locked') {
        next(badRequest("Le nom d’utilisateur ne peut plus être modifié."))
        return
      }

      if (error instanceof ProfileServiceError && error.code === 'username_required') {
        next(badRequest("Le nom d’utilisateur est obligatoire."))
        return
      }

      if (isUniqueUsernameConstraintError(error)) {
        next(badRequest("Ce nom d’utilisateur est déjà utilisé."))
        return
      }

      next(error)
    }
  })

  router.put('/me/time-zone', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const payload = parseTimeZonePayload(req.body)
      const player = await updatePlayerTimeZone(clerkUserId, payload.timeZone)

      res.json({
        user: serializeProfileUser(player),
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/me/presence', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const payload = parsePresencePayload(req.body)
      const player = await updatePlayerPresence(clerkUserId, payload.presenceStatus)
      const friends = await listFriends(player.id)

      emitPresenceChanged([player.id, ...friends.map((friend) => friend.id)], 'presence_updated')

      res.json({
        user: serializeProfileUser(player),
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
