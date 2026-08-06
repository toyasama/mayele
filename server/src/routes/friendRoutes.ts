import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { ApiError, badRequest } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { operationHistoryQuerySchema } from '../schemas/dashboardSchema.js'
import { parseFriendRequestPayload, parsePlayerSearchQuery } from '../schemas/friendSchema.js'
import {
  acceptFriendRequestInTransaction,
  cancelFriendRequestInTransaction,
  declineFriendRequestInTransaction,
  FriendServiceError,
  getFriendOperationHistory,
  getFriendPublicProfile,
  getSocialOverview,
  listFriendRequests,
  listFriends,
  removeFriendInTransaction,
  searchPlayersByUsername,
  sendFriendRequestInTransaction,
  type PublicPlayer,
} from '../services/friendService.js'
import {
  createNotification,
  dismissNotificationByDedupeKey,
  friendAcceptedNotificationKey,
  friendRequestNotificationKey,
} from '../services/notificationService.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import { requestOutboxDispatch } from '../services/outboxDispatcher.js'
import { enqueueOutboxEvent } from '../services/outboxService.js'
import { getCurrentPlayer, isPlayerProfileComplete } from '../services/playerService.js'
import { prisma } from '../lib/prisma.js'

function serializePublicPlayer(player: PublicPlayer) {
  return {
    id: player.id,
    name: player.name,
    username: player.username,
    avatarUrl: player.avatarUrl,
    totalXp: player.totalXp,
    presenceStatus: player.presenceStatus,
    presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
  }
}

function serializeFriendRequest(request: { id: string; createdAt: Date; player: PublicPlayer }) {
  return {
    id: request.id,
    createdAt: request.createdAt.toISOString(),
    player: serializePublicPlayer(request.player),
  }
}

async function getCompleteCurrentPlayer(clerkUserId: string) {
  const player = await getCurrentPlayer(clerkUserId)

  if (!isPlayerProfileComplete(player)) {
    throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
  }

  return player
}

function friendServiceErrorToApiError(error: FriendServiceError) {
  switch (error.code) {
    case 'self_friend_request':
      return badRequest("Vous ne pouvez pas vous ajouter vous-meme en ami.")
    case 'player_not_found':
    case 'friend_request_not_found':
    case 'friendship_not_found':
      return new ApiError(404, 'Ressource introuvable.', error.code)
    case 'friend_request_not_owned':
      return new ApiError(403, "Cette demande d'ami ne vous appartient pas.", error.code)
    case 'already_friends':
      return new ApiError(409, 'Ce joueur est deja dans vos amis.', error.code)
    case 'friend_request_already_pending':
      return new ApiError(409, "Une demande d'ami est deja en attente.", error.code)
    case 'incoming_friend_request_exists':
      return new ApiError(409, "Ce joueur vous a deja envoye une demande. Acceptez la demande existante.", error.code)
    case 'friend_request_not_pending':
      return new ApiError(409, "Cette demande d'ami n'est plus en attente.", error.code)
  }
}

export function friendRoutes() {
  const router = Router()

  router.get('/players/search', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const { username } = parsePlayerSearchQuery(req.query)
      const players = await searchPlayersByUsername(player.id, username)

      res.json({ players: players.map(serializePublicPlayer) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/friends/overview', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const overview = await getSocialOverview(player.id)

      res.json({
        friends: overview.friends.map(serializePublicPlayer),
        incoming: overview.incoming.map(serializeFriendRequest),
        outgoing: overview.outgoing.map(serializeFriendRequest),
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/friends', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const friends = await listFriends(player.id)

      res.json({ friends: friends.map(serializePublicPlayer) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/friends/:friendId/profile', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const profile = await getFriendPublicProfile(player.id, req.params.friendId, player.timeZone)

      res.json({
        player: serializePublicPlayer(profile.player),
        badges: profile.badges,
        stats: profile.stats,
        progressByMode: profile.progressByMode,
        headToHead: profile.headToHead,
      })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.get('/friends/:friendId/operation-history', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const query = operationHistoryQuerySchema.parse(req.query)
      const sessions = await getFriendOperationHistory(
        player.id,
        req.params.friendId,
        query.game,
        query.level,
        query.limit,
      )

      res.json({ sessions })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.get('/friends/requests', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const requests = await listFriendRequests(player.id)

      res.json({
        incoming: requests.incoming.map(serializeFriendRequest),
        outgoing: requests.outgoing.map(serializeFriendRequest),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/friends/requests', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const payload = parseFriendRequestPayload(req.body)
      const request = await prisma.$transaction(async (tx) => {
        const createdRequest = await sendFriendRequestInTransaction(tx, player.id, payload.receiverPlayerId)
        const notification = await createNotification({
          playerId: createdRequest.player.id,
          actorPlayerId: player.id,
          type: 'friend_request_received',
          title: `${player.name} vous a envoye une demande d'ami.`,
          href: '/amis?filter=incoming',
          dedupeKey: friendRequestNotificationKey(createdRequest.id),
        }, tx)
        const serializedNotification = serializeNotification(notification)

        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${createdRequest.id}:social:${randomUUID()}`,
          topic: 'social.changed',
          aggregateType: 'friend_request',
          aggregateId: createdRequest.id,
          payload: { playerIds: [player.id, createdRequest.player.id], reason: 'friend_request_sent' },
        })
        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${createdRequest.id}:notification:${randomUUID()}`,
          topic: 'notification.created',
          aggregateType: 'friend_request',
          aggregateId: createdRequest.id,
          payload: {
            playerId: createdRequest.player.id,
            reason: 'notification_created',
            notification: serializedNotification,
          },
        })

        return createdRequest
      })

      requestOutboxDispatch()
      res.status(201).json({ request: serializeFriendRequest(request) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/accept', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const friend = await prisma.$transaction(async (tx) => {
        const acceptedFriend = await acceptFriendRequestInTransaction(tx, player.id, req.params.requestId)
        const dismissed = await dismissNotificationByDedupeKey(
          player.id,
          friendRequestNotificationKey(req.params.requestId),
          tx,
        )
        const notification = await createNotification({
          playerId: acceptedFriend.id,
          actorPlayerId: player.id,
          type: 'friend_request_accepted',
          title: `${player.name} a accepte votre demande d'ami.`,
          href: '/amis?filter=friend',
          dedupeKey: friendAcceptedNotificationKey(req.params.requestId),
        }, tx)
        const serializedNotification = serializeNotification(notification)

        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${req.params.requestId}:accepted-social:${randomUUID()}`,
          topic: 'social.changed',
          aggregateType: 'friend_request',
          aggregateId: req.params.requestId,
          payload: { playerIds: [player.id, acceptedFriend.id], reason: 'friend_request_accepted' },
        })
        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${req.params.requestId}:accepted-notification:${randomUUID()}`,
          topic: 'notification.created',
          aggregateType: 'friend_request',
          aggregateId: req.params.requestId,
          payload: {
            playerId: acceptedFriend.id,
            reason: 'notification_created',
            notification: serializedNotification,
          },
        })
        if (dismissed) {
          await enqueueOutboxEvent(tx, {
            dedupeKey: `friend-request:${req.params.requestId}:dismissed-notification:${randomUUID()}`,
            topic: 'notifications.changed',
            aggregateType: 'friend_request',
            aggregateId: req.params.requestId,
            payload: { playerIds: [player.id], reason: 'notification_dismissed' },
          })
        }

        return acceptedFriend
      })

      requestOutboxDispatch()
      res.json({ friend: serializePublicPlayer(friend) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/decline', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const declinedPlayer = await prisma.$transaction(async (tx) => {
        const declined = await declineFriendRequestInTransaction(tx, player.id, req.params.requestId)
        const dismissed = await dismissNotificationByDedupeKey(
          player.id,
          friendRequestNotificationKey(req.params.requestId),
          tx,
        )
        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${req.params.requestId}:declined-social:${randomUUID()}`,
          topic: 'social.changed',
          aggregateType: 'friend_request',
          aggregateId: req.params.requestId,
          payload: { playerIds: [player.id, declined.id], reason: 'friend_request_declined' },
        })
        if (dismissed) {
          await enqueueOutboxEvent(tx, {
            dedupeKey: `friend-request:${req.params.requestId}:declined-notification:${randomUUID()}`,
            topic: 'notifications.changed',
            aggregateType: 'friend_request',
            aggregateId: req.params.requestId,
            payload: { playerIds: [player.id], reason: 'notification_dismissed' },
          })
        }
        return declined
      })

      requestOutboxDispatch()
      res.json({ player: serializePublicPlayer(declinedPlayer) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/cancel', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const cancelledPlayer = await prisma.$transaction(async (tx) => {
        const cancelled = await cancelFriendRequestInTransaction(tx, player.id, req.params.requestId)
        const dismissed = await dismissNotificationByDedupeKey(
          cancelled.id,
          friendRequestNotificationKey(req.params.requestId),
          tx,
        )
        await enqueueOutboxEvent(tx, {
          dedupeKey: `friend-request:${req.params.requestId}:cancelled-social:${randomUUID()}`,
          topic: 'social.changed',
          aggregateType: 'friend_request',
          aggregateId: req.params.requestId,
          payload: { playerIds: [player.id, cancelled.id], reason: 'friend_request_cancelled' },
        })
        if (dismissed) {
          await enqueueOutboxEvent(tx, {
            dedupeKey: `friend-request:${req.params.requestId}:cancelled-notification:${randomUUID()}`,
            topic: 'notifications.changed',
            aggregateType: 'friend_request',
            aggregateId: req.params.requestId,
            payload: { playerIds: [cancelled.id], reason: 'notification_dismissed' },
          })
        }
        return cancelled
      })

      requestOutboxDispatch()
      res.json({ player: serializePublicPlayer(cancelledPlayer) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.delete('/friends/:friendId', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)

      await prisma.$transaction(async (tx) => {
        await removeFriendInTransaction(tx, player.id, req.params.friendId)
        await enqueueOutboxEvent(tx, {
          dedupeKey: `friendship:${[player.id, req.params.friendId].sort().join(':')}:removed:${randomUUID()}`,
          topic: 'social.changed',
          aggregateType: 'friendship',
          aggregateId: [player.id, req.params.friendId].sort().join(':'),
          payload: { playerIds: [player.id, req.params.friendId], reason: 'friend_removed' },
        })
      })
      requestOutboxDispatch()
      res.status(204).send()
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  return router
}
