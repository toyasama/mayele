import { Router } from 'express'
import { ApiError, badRequest } from '../errors.js'
import { getRequiredAuth } from '../middleware/auth.js'
import {
  emitMatchSnapshot,
  getInFlightRealtimeMatchSnapshot,
  getPendingRealtimeHeartbeatSnapshot,
  listInFlightRealtimeMatchSnapshots,
} from '../realtime/notifications.js'
import { parseMatchResultPayload } from '../schemas/matchSchema.js'
import {
  completeChallengeResult,
  declineChallenge,
  declineChallengeProposal,
  getMatch,
  heartbeatChallengeHost,
  leaveChallenge,
  listMatches,
  MatchServiceError,
  transferChallengeHost,
} from '../services/matchService.js'
import { listFriends } from '../services/friendService.js'
import { serializeMatch, serializePublicPlayer, type SerializedMatch } from '../services/matchPresenter.js'
import { getCurrentPlayer, isPlayerProfileComplete } from '../services/playerService.js'
import { persistInvitationDeclinedEffects, persistMatchLeftEffects } from '../services/matchOutboxEffects.js'
import { requestOutboxDispatch } from '../services/outboxDispatcher.js'

async function getCompleteCurrentPlayer(clerkUserId: string) {
  const player = await getCurrentPlayer(clerkUserId)

  if (!isPlayerProfileComplete(player)) {
    throw new ApiError(428, 'Profil incomplet. Veuillez renseigner vos informations avant de continuer.', 'profile_incomplete')
  }

  return player
}

function mergeMatchSnapshots(persistedMatches: SerializedMatch[], inFlightMatches: SerializedMatch[]) {
  const matchesById = new Map(persistedMatches.map((match) => [match.id, match]))

  for (const match of inFlightMatches) {
    matchesById.set(match.id, match)
  }

  return Array.from(matchesById.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function matchServiceErrorToApiError(error: MatchServiceError) {
  switch (error.code) {
    case 'self_challenge':
      return badRequest('Vous ne pouvez pas vous defier vous-meme.')
    case 'opponent_not_found':
    case 'match_not_found':
      return new ApiError(404, 'Ressource introuvable.', error.code)
    case 'not_friends':
      return new ApiError(403, 'Vous devez etre amis pour lancer un defi.', error.code)
    case 'match_not_participant':
      return new ApiError(403, 'Vous ne participez pas a ce defi.', error.code)
    case 'match_not_owned':
      return new ApiError(403, 'Seul le maitre du salon peut effectuer cette action.', error.code)
    case 'match_host_inactive':
      return new ApiError(410, "L'hote n'est plus dans ce salon.", error.code)
    case 'match_not_pending':
    case 'match_not_accepted':
    case 'match_not_ready':
    case 'match_config_incomplete':
    case 'participant_not_invited':
      return new ApiError(409, "Ce defi n'est plus en attente.", error.code)
    case 'match_not_in_progress':
      return new ApiError(409, "Ce defi n'est pas en cours.", error.code)
    case 'match_result_invalid':
    case 'match_tempo_answer_invalid':
      return new ApiError(409, 'Resultat de defi invalide.', error.code)
    case 'match_already_completed':
      return new ApiError(409, 'Votre resultat est deja enregistre.', error.code)
    case 'match_version_conflict':
      return new ApiError(409, 'La configuration du salon a change. Synchronisation en cours.', error.code)
    case 'match_not_completed':
      return new ApiError(409, "Ce defi n'est pas termine.", error.code)
    case 'match_rematch_unavailable':
      return new ApiError(409, "L'adversaire a deja quitte les resultats.", error.code)
    case 'match_host_transfer_unavailable':
      return new ApiError(409, 'Le maitre du salon ne peut pas etre change maintenant.', error.code)
  }
}

export function matchRoutes() {
  const router = Router()

  router.get('/matches', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const matches = await listMatches(player.id)
      const serializedMatches = mergeMatchSnapshots(
        matches.map(serializeMatch),
        listInFlightRealtimeMatchSnapshots(player.id),
      )

      res.set('Cache-Control', 'no-store')
      res.json({ matches: serializedMatches })
    } catch (error) {
      next(error)
    }
  })

  router.get('/matches/room-overview', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const [friends, matches] = await Promise.all([listFriends(player.id), listMatches(player.id)])
      const serializedMatches = mergeMatchSnapshots(
        matches.map(serializeMatch),
        listInFlightRealtimeMatchSnapshots(player.id),
      )

      res.set('Cache-Control', 'no-store')
      res.json({ friends: friends.map(serializePublicPlayer), matches: serializedMatches })
    } catch (error) {
      next(error)
    }
  })

  router.get('/matches/:matchId', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      try {
        const match = await getMatch(player.id, req.params.matchId)

        res.set('Cache-Control', 'no-store')
        res.json({ match: serializeMatch(match) })
      } catch (error) {
        const inFlightMatch = error instanceof MatchServiceError && error.code === 'match_not_found'
          ? getInFlightRealtimeMatchSnapshot(player.id, req.params.matchId)
          : null

        if (!inFlightMatch) {
          throw error
        }

        res.set('Cache-Control', 'no-store')
        res.json({ match: inFlightMatch })
      }
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/decline', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const match = await declineChallenge(
        player.id,
        req.params.matchId,
        (tx, persistedMatch) => persistInvitationDeclinedEffects(tx, persistedMatch, player.id),
      )

      emitMatchSnapshot(match, 'match_declined')
      requestOutboxDispatch()
      res.json({ match: serializeMatch(match) })
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/results', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const payload = parseMatchResultPayload(req.body)
      const match = await completeChallengeResult(player.id, req.params.matchId, payload, player.timeZone)

      emitMatchSnapshot(match, 'match_completed')
      res.status(201).json({ match: serializeMatch(match) })
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/proposal/decline', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const match = await declineChallengeProposal(player.id, req.params.matchId)

      emitMatchSnapshot(match, 'match_proposal_declined')
      res.json({ match: serializeMatch(match) })
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/heartbeat', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      try {
        const match = await heartbeatChallengeHost(player.id, req.params.matchId)

        res.json({ match: serializeMatch(match) })
      } catch (error) {
        const pendingSnapshot = error instanceof MatchServiceError && error.code === 'match_not_found'
          ? getPendingRealtimeHeartbeatSnapshot(player.id, req.params.matchId)
          : null

        if (pendingSnapshot) {
          res.status(202).json({ match: pendingSnapshot })
          return
        }

        throw error
      }
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/transfer-host', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const match = await transferChallengeHost(player.id, req.params.matchId)

      emitMatchSnapshot(match, 'match_host_transferred')
      res.json({ match: serializeMatch(match) })
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  router.post('/matches/:matchId/leave', async (req, res, next) => {
    try {
      const { clerkUserId } = getRequiredAuth(req)
      const player = await getCompleteCurrentPlayer(clerkUserId)
      const match = await leaveChallenge(
        player.id,
        req.params.matchId,
        (tx, persistedMatch) => persistMatchLeftEffects(tx, persistedMatch),
      )

      emitMatchSnapshot(match, 'match_left')
      requestOutboxDispatch()
      res.json({ match: serializeMatch(match) })
    } catch (error) {
      next(error instanceof MatchServiceError ? matchServiceErrorToApiError(error) : error)
    }
  })

  return router
}
