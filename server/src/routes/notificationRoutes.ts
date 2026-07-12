import { Router } from 'express'
import { getRequiredAuth } from '../middleware/auth.js'
import { dismissNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notificationService.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import { emitNotificationsChanged } from '../realtime/notifications.js'
import { getCurrentPlayer, isPlayerProfileComplete } from '../services/playerService.js'
import { ApiError } from '../errors.js'

async function getCompleteCurrentPlayer(clerkUserId: string) {
  const player = await getCurrentPlayer(clerkUserId)

  if (!isPlayerProfileComplete(player)) {
    throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
  }

  return player
}

export function notificationRoutes() {
  const router = Router()

  router.get('/notifications', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const payload = await listNotifications(player.id)

      res.json({
        notifications: payload.notifications.map(serializeNotification),
        unreadCount: payload.unreadCount,
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/notifications/:notificationId/read', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)

      await markNotificationRead(player.id, req.params.notificationId)
      const payload = await listNotifications(player.id)

      res.json({
        notifications: payload.notifications.map(serializeNotification),
        unreadCount: payload.unreadCount,
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/notifications/read-all', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)

      await markAllNotificationsRead(player.id)
      const payload = await listNotifications(player.id)

      res.json({
        notifications: payload.notifications.map(serializeNotification),
        unreadCount: payload.unreadCount,
      })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notifications/:notificationId', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)

      await dismissNotification(player.id, req.params.notificationId)
      const payload = await listNotifications(player.id)

      emitNotificationsChanged([player.id], 'notification_dismissed')
      res.json({
        notifications: payload.notifications.map(serializeNotification),
        unreadCount: payload.unreadCount,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
