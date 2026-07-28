import { randomUUID } from 'node:crypto'
import type { Socket } from 'socket.io'
import {
  parseChallengePayload,
  parseRealtimeForfeitCommand,
  parseRealtimeChallengeConfigCommand,
  parseRealtimeMatchCommand,
  parseRealtimeMatchProposeCommand,
  parseRealtimeMatchProgressCommand,
  parseRealtimeMatchResultCommand,
} from '../schemas/matchSchema.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import {
  acceptChallenge,
  acceptChallengeProposal,
  completeChallengeResult,
  createChallenge,
  declineChallenge,
  declineChallengeProposal,
  forfeitChallenge,
  leaveChallenge,
  MatchServiceError,
  proposeChallenge,
  requestChallengeRematch,
  updateChallengeConfig,
} from '../services/matchService.js'
import {
  persistInvitationAcceptedEffects,
  persistInvitationCreatedEffects,
  persistInvitationDeclinedEffects,
  persistMatchLeftEffects,
} from '../services/matchOutboxEffects.js'
import { requestOutboxDispatch } from '../services/outboxDispatcher.js'
import { serializeMatch, type SerializedMatch } from '../services/matchPresenter.js'
import type { RoomRuntimeEvent } from './roomRuntime.js'

type RealtimeCommandAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; status: number; code: string | null } }

type MatchConfigCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchCreateInvitationCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchActionCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchRematchCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>

type MatchCommandContext = {
  playerId: string
  getCachedMatch(matchId: string): SerializedMatch | null
  commandIdFromValue(value: unknown): string | null
  ackDuplicateMatchCommand(commandId: string | null, ack?: (response: RealtimeCommandAck<{ match: SerializedMatch }>) => void): boolean
  ackError<T>(ack: ((response: RealtimeCommandAck<T>) => void) | undefined, error: unknown): void
  publishMatchRuntimeEvent(snapshot: SerializedMatch, reason: string, commandId?: string | null): RoomRuntimeEvent | null
  emitNotificationsChanged(playerIds: string[], reason: string): void
  emitNotificationCreated(playerId: string, reason: string, notification: ReturnType<typeof serializeNotification>): void
  enqueueMatchPersistence<T>(matchId: string, persist: () => Promise<T>): Promise<T>
}

function latestMatchFromValue(value: unknown, context: MatchCommandContext) {
  return typeof value === 'object' && value && 'matchId' in value && typeof value.matchId === 'string'
    ? context.getCachedMatch(value.matchId)
    : null
}

export function registerMatchCommandHandlers(socket: Socket, context: MatchCommandContext) {
  const { playerId } = context

  socket.on('match:update-config', async (value: unknown, ack?: (response: MatchConfigCommandAck) => void) => {
    try {
      const command = parseRealtimeChallengeConfigCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      if (cachedMatch.createdBy.id !== playerId) {
        throw new MatchServiceError('match_not_owned')
      }

      if (cachedMatch.status !== 'pending' && cachedMatch.status !== 'accepted' && cachedMatch.status !== 'ready') {
        throw new MatchServiceError('match_not_pending')
      }

      if (
        command.config.expectedConfigVersion !== undefined &&
        command.config.expectedConfigVersion !== cachedMatch.configVersion
      ) {
        throw new MatchServiceError('match_version_conflict')
      }

      const match = await updateChallengeConfig(playerId, command.matchId, command.config)
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_config_updated', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      context.ackError(ack, error)
    }
  })

  socket.on('match:create-invitation', async (value: unknown, ack?: (response: MatchCreateInvitationCommandAck) => void) => {
    try {
      const command = parseChallengePayload(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const matchId = `match_${randomUUID()}`
      const roomId = `room_${randomUUID()}`
      const creatorParticipantId = `participant_${randomUUID()}`
      const opponentParticipantId = `participant_${randomUUID()}`
      const notificationId = `notification_${randomUUID()}`

      const createPersistedInvitation = () =>
        createChallenge(playerId, command, {
          matchId,
          roomId,
          creatorParticipantId,
          opponentParticipantId,
          onPersisted: (tx, persistedMatch) => persistInvitationCreatedEffects(
            tx,
            persistedMatch,
            playerId,
            notificationId,
            { commandId },
          ),
        })

      const match = await createPersistedInvitation()
      const serializedMatch = serializeMatch(match)

      context.publishMatchRuntimeEvent(serializedMatch, 'match_created', commandId)
      ack?.({ ok: true, data: { match: serializedMatch } })
      requestOutboxDispatch()
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:accept-invitation', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await acceptChallenge(
        playerId,
        command.matchId,
        (tx, persistedMatch) => persistInvitationAcceptedEffects(tx, persistedMatch, playerId, { commandId }),
      )
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_accepted', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
      requestOutboxDispatch()
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      context.ackError(ack, error)
    }
  })

  socket.on('match:decline-invitation', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await declineChallenge(
        playerId,
        command.matchId,
        (tx, persistedMatch) => persistInvitationDeclinedEffects(tx, persistedMatch, playerId, { commandId }),
      )
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_declined', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
      requestOutboxDispatch()
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:propose', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchProposeCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = command.config
        ? await proposeChallenge(playerId, command.matchId, command.config)
        : await proposeChallenge(playerId, command.matchId)
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_proposed', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      context.ackError(ack, error)
    }
  })

  socket.on('match:decline-proposal', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await declineChallengeProposal(playerId, command.matchId)
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_proposal_declined', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:accept-proposal', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await acceptChallengeProposal(playerId, command.matchId)
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_started', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:forfeit', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeForfeitCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await context.enqueueMatchPersistence(
        command.matchId,
        () => forfeitChallenge(playerId, command.matchId),
      )
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_forfeited', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:request-rematch', async (value: unknown, ack?: (response: MatchRematchCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await requestChallengeRematch(playerId, command.matchId)
      const snapshot = serializeMatch(match)
      const reason = snapshot.id === command.matchId ? 'match_rematch_requested' : 'match_rematch_started'

      context.publishMatchRuntimeEvent(snapshot, reason, commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:leave', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      const match = await leaveChallenge(
        playerId,
        command.matchId,
        (tx, persistedMatch) => persistMatchLeftEffects(tx, persistedMatch, { commandId }),
      )
      const snapshot = serializeMatch(match)

      context.publishMatchRuntimeEvent(snapshot, 'match_left', commandId)
      ack?.({ ok: true, data: { match: snapshot } })
      requestOutboxDispatch()
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:update-progress', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchProgressCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const cachedMatch = context.getCachedMatch(command.matchId)

      if (!cachedMatch) {
        throw new MatchServiceError('match_not_found')
      }

      // Progress is derived from server-recorded answers. Client progress packets are
      // accepted for backwards compatibility but never mutate or broadcast match state.
      ack?.({ ok: true, data: { match: cachedMatch } })
    } catch (error) {
      context.ackError(ack, error)
    }
  })

  socket.on('match:submit-result', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    try {
      const command = parseRealtimeMatchResultCommand(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const match = await completeChallengeResult(playerId, command.matchId, command.result)
      const snapshot = serializeMatch(match)
      const reason = snapshot.status === 'completed' ? 'match_completed' : 'match_participant_completed'

      context.publishMatchRuntimeEvent(snapshot, reason, commandId)
      ack?.({ ok: true, data: { match: snapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot?.status === 'completed') {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      context.ackError(ack, error)
    }
  })
}
