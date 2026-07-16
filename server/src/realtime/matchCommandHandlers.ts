import { randomUUID } from 'node:crypto'
import type { Socket } from 'socket.io'
import { logger } from '../lib/logger.js'
import {
  parseChallengePayload,
  parseRealtimeForfeitCommand,
  parseRealtimeChallengeConfigCommand,
  parseRealtimeMatchCommand,
  parseRealtimeMatchProposeCommand,
  parseRealtimeMatchProgressCommand,
  parseRealtimeMatchResultCommand,
} from '../schemas/matchSchema.js'
import {
  createNotification,
  dismissNotificationByDedupeKey,
  matchDeclinedNotificationKey,
  matchInviteNotificationKey,
} from '../services/notificationService.js'
import { serializeNotification } from '../services/notificationPresenter.js'
import {
  acceptChallenge,
  completeChallengeResult,
  createChallenge,
  declineChallenge,
  declineChallengeProposal,
  forfeitChallenge,
  leaveChallenge,
  MatchServiceError,
  proposeChallenge,
  requestChallengeRematch,
  startChallengeProposal,
  updateChallengeConfig,
  type MatchView,
} from '../services/matchService.js'
import { serializeMatch, type SerializedMatch } from '../services/matchPresenter.js'
import {
  applyChallengeProposalDraft,
  applyConfigDraft,
  applyForfeitDraft,
  applyInvitationAcceptDraft,
  applyInvitationDeclineDraft,
  applyParticipantProgressDraft,
  applyProposalAcceptDraft,
  applyProposalDeclineDraft,
  applyRematchRequestDraft,
  applyRoomClosedDraft,
  optimisticInvitationSnapshot,
  participantProgressByPlayerId,
  persistedConfigFromSnapshot,
  type RealtimePublicPlayer,
} from './matchDrafts.js'
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
  publicPlayer: RealtimePublicPlayer | undefined
  getOnlinePlayer(playerId: string): RealtimePublicPlayer | null
  getCachedMatch(matchId: string): SerializedMatch | null
  deleteCachedMatch(matchId: string): void
  commandIdFromValue(value: unknown): string | null
  ackDuplicateMatchCommand(commandId: string | null, ack?: (response: RealtimeCommandAck<{ match: SerializedMatch }>) => void): boolean
  ackError<T>(ack: ((response: RealtimeCommandAck<T>) => void) | undefined, error: unknown): void
  publishMatchRuntimeEvent(snapshot: SerializedMatch, reason: string, commandId?: string | null): RoomRuntimeEvent | null
  publishMatchSnapshot(snapshot: SerializedMatch, reason: string): void
  persistMatchSnapshotInBackground(
    matchId: string,
    persist: () => Promise<MatchView>,
    context: Record<string, unknown>,
    onPersisted?: (snapshot: SerializedMatch) => void,
  ): void
  emitMatchChanged(
    match: { id: string; status: string; participants: Array<{ player: { id: string } }> },
    reason: string,
    snapshot?: unknown,
    roomEvent?: RoomRuntimeEvent,
  ): void
  emitNotificationsChanged(playerIds: string[], reason: string): void
  emitNotificationCreated(playerId: string, reason: string, notification: ReturnType<typeof serializeNotification>): void
}

function cachedMatchFromValue(value: unknown, context: MatchCommandContext, rollbackSnapshot: SerializedMatch | null) {
  return typeof value === 'object' && value && 'matchId' in value && typeof value.matchId === 'string'
    ? rollbackSnapshot ?? context.getCachedMatch(value.matchId)
    : null
}

function latestMatchFromValue(value: unknown, context: MatchCommandContext) {
  return typeof value === 'object' && value && 'matchId' in value && typeof value.matchId === 'string'
    ? context.getCachedMatch(value.matchId)
    : null
}

function persistInvitationDeclineNotificationsInBackground(
  snapshot: SerializedMatch,
  playerId: string,
  context: MatchCommandContext,
) {
  const decliningParticipant = snapshot.participants.find((participant) => participant.player.id === playerId)

  void dismissNotificationByDedupeKey(playerId, matchInviteNotificationKey(snapshot.id))
    .then(() => {
      context.emitNotificationsChanged([playerId], 'notification_dismissed')
    })
    .catch((error) => {
      logger.error('Notification invitation refusee impossible a masquer.', {
        matchId: snapshot.id,
        playerId,
        message: error instanceof Error ? error.message : String(error),
      })
    })

  if (snapshot.createdBy.id === playerId || !decliningParticipant) {
    return
  }

  void createNotification({
    playerId: snapshot.createdBy.id,
    actorPlayerId: playerId,
    type: 'match_invite_declined',
    title: `${decliningParticipant.player.name} a refuse votre defi.`,
    href: '/jeu/multijoueur',
    dedupeKey: matchDeclinedNotificationKey(snapshot.id),
  }).then((notification) => {
    context.emitNotificationCreated(snapshot.createdBy.id, 'notification_created', serializeNotification(notification))
  }).catch((error) => {
    logger.error('Notification refus invitation impossible a creer.', {
      matchId: snapshot.id,
      playerId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

function persistInvitationCreatedNotificationInBackground(
  snapshot: SerializedMatch,
  playerId: string,
  notificationId: string,
  context: MatchCommandContext,
) {
  const opponent = snapshot.participants.find((participant) => participant.player.id !== playerId)?.player ?? null

  if (!opponent) {
    return
  }

  void createNotification({
    id: notificationId,
    playerId: opponent.id,
    actorPlayerId: playerId,
    type: 'match_invite_received',
    title: `${snapshot.createdBy.name} vous a defie.`,
    href: `/jeu/multijoueur?match=${snapshot.id}`,
    dedupeKey: matchInviteNotificationKey(snapshot.id),
  }).then((notification) => {
    context.emitNotificationCreated(opponent.id, 'notification_created', serializeNotification(notification))
  }).catch((error) => {
    logger.error('Notification invitation impossible a creer.', {
      matchId: snapshot.id,
      playerId,
      opponentPlayerId: opponent.id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export function registerMatchCommandHandlers(socket: Socket, context: MatchCommandContext) {
  const { playerId } = context

  socket.on('match:update-config', async (value: unknown, ack?: (response: MatchConfigCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyConfigDraft(cachedMatch, command.config)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_config_updated', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        updateChallengeConfig(playerId, command.matchId, command.config),
      { playerId, command: 'match:update-config' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_config_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:create-invitation', async (value: unknown, ack?: (response: MatchCreateInvitationCommandAck) => void) => {
    let optimisticSnapshot: SerializedMatch | null = null

    try {
      const command = parseChallengePayload(value)
      const commandId = context.commandIdFromValue(value)

      if (context.ackDuplicateMatchCommand(commandId, ack)) {
        return
      }

      const now = new Date()
      const matchId = `match_${randomUUID()}`
      const roomId = `room_${randomUUID()}`
      const creatorParticipantId = `participant_${randomUUID()}`
      const opponentParticipantId = `participant_${randomUUID()}`
      const creator = context.publicPlayer
      const onlineOpponent = context.getOnlinePlayer(command.opponentPlayerId)
      const notificationId = `notification_${randomUUID()}`

      if (creator && onlineOpponent) {
        optimisticSnapshot = optimisticInvitationSnapshot({
          matchId,
          roomId,
          creatorParticipantId,
          opponentParticipantId,
          creator,
          opponent: onlineOpponent,
          command,
          now,
        })
        context.publishMatchRuntimeEvent(optimisticSnapshot, 'match_created', commandId)
      }

      const createPersistedInvitation = () =>
        createChallenge(playerId, command, {
          matchId,
          roomId,
          creatorParticipantId,
          opponentParticipantId,
        })

      if (optimisticSnapshot) {
        context.persistMatchSnapshotInBackground(
          matchId,
          createPersistedInvitation,
          { playerId, command: 'match:create-invitation' },
          (snapshot) => persistInvitationCreatedNotificationInBackground(snapshot, playerId, notificationId, context),
        )
        ack?.({ ok: true, data: { match: optimisticSnapshot } })
        return
      }

      const match = await createPersistedInvitation()
      const serializedMatch = serializeMatch(match)

      context.publishMatchRuntimeEvent(serializedMatch, 'match_created', commandId)
      ack?.({ ok: true, data: { match: serializedMatch } })
      persistInvitationCreatedNotificationInBackground(serializedMatch, playerId, notificationId, context)
    } catch (error) {
      if (optimisticSnapshot) {
        context.deleteCachedMatch(optimisticSnapshot.id)
        context.emitMatchChanged({ ...optimisticSnapshot, status: 'cancelled' }, 'match_create_sync_failed', { ...optimisticSnapshot, status: 'cancelled' })
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:accept-invitation', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyInvitationAcceptDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_accepted', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        acceptChallenge(playerId, command.matchId),
      { playerId, command: 'match:accept-invitation' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_accept_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:decline-invitation', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyInvitationDeclineDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_declined', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        declineChallenge(playerId, command.matchId),
      { playerId, command: 'match:decline-invitation' })
      persistInvitationDeclineNotificationsInBackground(draftSnapshot, playerId, context)
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_decline_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:propose', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const configuredSnapshot = command.config
        ? applyConfigDraft(cachedMatch, command.config)
        : cachedMatch
      const draftSnapshot = applyChallengeProposalDraft(configuredSnapshot, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_proposed', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, async () => {
        if (command.config) {
          return proposeChallenge(playerId, command.matchId, persistedConfigFromSnapshot(draftSnapshot))
        }

        return proposeChallenge(playerId, command.matchId)
      }, { playerId, command: 'match:propose' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const latestSnapshot = latestMatchFromValue(value, context)

      if (latestSnapshot && (latestSnapshot.status === 'in_progress' || latestSnapshot.status === 'completed')) {
        ack?.({ ok: true, data: { match: latestSnapshot } })
        return
      }

      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_propose_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:decline-proposal', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyProposalDeclineDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_proposal_declined', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        declineChallengeProposal(playerId, command.matchId),
      { playerId, command: 'match:decline-proposal' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_decline_proposal_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:accept-proposal', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyProposalAcceptDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch
      const startedAt = new Date(draftSnapshot.startedAt ?? '')

      if (Number.isNaN(startedAt.getTime())) {
        throw new MatchServiceError('match_not_ready')
      }

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_started', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        startChallengeProposal(playerId, command.matchId, persistedConfigFromSnapshot(draftSnapshot), startedAt),
      { playerId, command: 'match:accept-proposal' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_start_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:forfeit', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const progressSnapshot = command.progress
        ? applyParticipantProgressDraft(cachedMatch, playerId, command.progress)
        : cachedMatch
      const draftSnapshot = applyForfeitDraft(progressSnapshot, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_forfeited', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        forfeitChallenge(playerId, command.matchId, participantProgressByPlayerId(draftSnapshot)),
      { playerId, command: 'match:forfeit' })
      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_forfeit_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:request-rematch', async (value: unknown, ack?: (response: MatchRematchCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyRematchRequestDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_rematch_requested', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        requestChallengeRematch(playerId, command.matchId),
      { playerId, command: 'match:request-rematch' }, (snapshot) => {
        if (snapshot.id !== draftSnapshot.id) {
          context.publishMatchRuntimeEvent(snapshot, 'match_rematch_started')
        }
      })

      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_rematch_sync_failed')
      }
      context.ackError(ack, error)
    }
  })

  socket.on('match:leave', async (value: unknown, ack?: (response: MatchActionCommandAck) => void) => {
    let rollbackSnapshot: SerializedMatch | null = null

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

      const draftSnapshot = applyRoomClosedDraft(cachedMatch, playerId)
      rollbackSnapshot = cachedMatch

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_left', commandId)
      context.persistMatchSnapshotInBackground(command.matchId, () =>
        leaveChallenge(playerId, command.matchId),
      { playerId, command: 'match:leave' })

      ack?.({ ok: true, data: { match: draftSnapshot } })
    } catch (error) {
      const cachedMatch = cachedMatchFromValue(value, context, rollbackSnapshot)

      if (cachedMatch) {
        context.publishMatchSnapshot(cachedMatch, 'match_leave_sync_failed')
      }
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

      const draftSnapshot = applyParticipantProgressDraft(cachedMatch, playerId, command.progress)

      context.publishMatchRuntimeEvent(draftSnapshot, 'match_progress_updated', commandId)
      ack?.({ ok: true, data: { match: draftSnapshot } })
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
