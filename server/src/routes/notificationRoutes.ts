import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getRequiredAuth } from '../middleware/auth.js'
import { dismissNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notificationService.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import { getCurrentPlayer, isPlayerProfileComplete } from '../services/playerService.js'
import { ApiError } from '../errors.js'
import { prisma } from '../lib/prisma.js'
import { requestOutboxDispatch } from '../services/outboxDispatcher.js'
import { enqueueOutboxEvent } from '../services/outboxService.js'

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

      const changed = await prisma.$transaction(async (tx) => {
        const result = await markNotificationRead(player.id, req.params.notificationId, tx)
        if (result.count === 0) return false
        await enqueueOutboxEvent(tx, {
          dedupeKey: `notification:${req.params.notificationId}:read:${randomUUID()}`,
          topic: 'notifications.changed',
          aggregateType: 'notification',
          aggregateId: req.params.notificationId,
          payload: { playerIds: [player.id], reason: 'notification_read' },
        })
        return true
      })
      if (changed) requestOutboxDispatch()
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

      const changed = await prisma.$transaction(async (tx) => {
        const result = await markAllNotificationsRead(player.id, tx)
        if (result.count === 0) return false
        await enqueueOutboxEvent(tx, {
          dedupeKey: `notifications:${player.id}:read-all:${randomUUID()}`,
          topic: 'notifications.changed',
          aggregateType: 'notification_inbox',
          aggregateId: player.id,
          payload: { playerIds: [player.id], reason: 'notifications_read' },
        })
        return true
      })
      if (changed) requestOutboxDispatch()
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

      const changed = await prisma.$transaction(async (tx) => {
        const result = await dismissNotification(player.id, req.params.notificationId, tx)
        if (result.count === 0) return false
        await enqueueOutboxEvent(tx, {
          dedupeKey: `notification:${req.params.notificationId}:dismissed:${randomUUID()}`,
          topic: 'notifications.changed',
          aggregateType: 'notification',
          aggregateId: req.params.notificationId,
          payload: { playerIds: [player.id], reason: 'notification_dismissed' },
        })
        return true
      })
      if (changed) requestOutboxDispatch()
      const payload = await listNotifications(player.id)
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
