import { Router } from 'express'
import { ApiError, badRequest } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import { parseFriendRequestPayload, parsePlayerSearchQuery } from '../schemas/friendSchema.js'
import { emitNotificationCreated, emitNotificationsChanged, emitSocialChanged } from '../realtime/notifications.js'
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  FriendServiceError,
  getFriendPublicProfile,
  getSocialOverview,
  listFriendRequests,
  listFriends,
  removeFriend,
  searchPlayersByUsername,
  sendFriendRequest,
  type PublicPlayer,
} from '../services/friendService.js'
import {
  createNotification,
  dismissNotificationByDedupeKey,
  friendAcceptedNotificationKey,
  friendRequestNotificationKey,
} from '../services/notificationService.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import { getCurrentPlayer, isPlayerProfileComplete } from '../services/playerService.js'

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
      })
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
      const request = await sendFriendRequest(player.id, payload.receiverPlayerId)
      const notification = await createNotification({
        playerId: request.player.id,
        actorPlayerId: player.id,
        type: 'friend_request_received',
        title: `${player.name} vous a envoye une demande d'ami.`,
        href: '/amis?filter=incoming',
        dedupeKey: friendRequestNotificationKey(request.id),
      })

      emitSocialChanged([player.id, request.player.id], 'friend_request_sent')
      emitNotificationCreated(request.player.id, 'notification_created', serializeNotification(notification))
      res.status(201).json({ request: serializeFriendRequest(request) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/accept', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const friend = await acceptFriendRequest(player.id, req.params.requestId)
      const notificationDismissed = await dismissNotificationByDedupeKey(player.id, friendRequestNotificationKey(req.params.requestId))
      const notification = await createNotification({
        playerId: friend.id,
        actorPlayerId: player.id,
        type: 'friend_request_accepted',
        title: `${player.name} a accepte votre demande d'ami.`,
        href: '/amis?filter=friend',
        dedupeKey: friendAcceptedNotificationKey(req.params.requestId),
      })

      emitSocialChanged([player.id, friend.id], 'friend_request_accepted')
      emitNotificationCreated(friend.id, 'notification_created', serializeNotification(notification))
      if (notificationDismissed) {
        emitNotificationsChanged([player.id], 'notification_dismissed')
      }
      res.json({ friend: serializePublicPlayer(friend) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/decline', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const declinedPlayer = await declineFriendRequest(player.id, req.params.requestId)
      const notificationDismissed = await dismissNotificationByDedupeKey(player.id, friendRequestNotificationKey(req.params.requestId))

      emitSocialChanged([player.id, declinedPlayer.id], 'friend_request_declined')
      if (notificationDismissed) {
        emitNotificationsChanged([player.id], 'notification_dismissed')
      }
      res.json({ player: serializePublicPlayer(declinedPlayer) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.post('/friends/requests/:requestId/cancel', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const cancelledPlayer = await cancelFriendRequest(player.id, req.params.requestId)
      const notificationDismissed = await dismissNotificationByDedupeKey(cancelledPlayer.id, friendRequestNotificationKey(req.params.requestId))

      emitSocialChanged([player.id, cancelledPlayer.id], 'friend_request_cancelled')
      if (notificationDismissed) {
        emitNotificationsChanged([cancelledPlayer.id], 'notification_dismissed')
      }
      res.json({ player: serializePublicPlayer(cancelledPlayer) })
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  router.delete('/friends/:friendId', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)

      await removeFriend(player.id, req.params.friendId)
      emitSocialChanged([player.id, req.params.friendId], 'friend_removed')
      res.status(204).send()
    } catch (error) {
      next(error instanceof FriendServiceError ? friendServiceErrorToApiError(error) : error)
    }
  })

  return router
}
