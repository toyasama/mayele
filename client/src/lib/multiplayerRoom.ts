import type { MatchData } from './api'

const ACTIVE_MATCH_STATUSES = new Set(['pending', 'accepted', 'ready', 'in_progress'])
type MatchStatus = MatchData['status']

function participantFor(match: MatchData, playerId: string) {
  return match.participants.find((participant) => participant.player.id === playerId) ?? null
}

export function isVisibleRoomParticipantStatus(status: string | undefined) {
  return status === 'invited' || status === 'accepted' || status === 'ready' || status === 'playing' || status === 'submitting' || status === 'completed'
}

export function isActiveRoomMatch(match: MatchData, nowMs = Date.now()) {
  return ACTIVE_MATCH_STATUSES.has(match.status) && new Date(match.expiresAt).getTime() > nowMs
}

export function isDisplayableRoomMatch(match: MatchData, playerId: string | undefined, nowMs = Date.now()) {
  if (!playerId) {
    return false
  }

  const participant = participantFor(match, playerId)

  if (match.status === 'completed') {
    return Boolean(participant && !participant.resultDismissedAt && new Date(match.expiresAt).getTime() > nowMs)
  }

  if (!isActiveRoomMatch(match, nowMs)) {
    return false
  }

  if (match.createdBy.id === playerId) {
    return true
  }

  return isVisibleRoomParticipantStatus(participant?.status)
}

function matchRank(match: MatchData, playerId: string, nowMs: number) {
  if (!isDisplayableRoomMatch(match, playerId, nowMs)) {
    return -1
  }

  switch (match.status) {
    case 'in_progress':
      return 500
    case 'ready':
      return 400
    case 'accepted':
      return 300
    case 'pending':
      return match.createdBy.id === playerId ? 200 : 250
    case 'completed':
      return 100
    default:
      return -1
  }
}

function isPassiveIncomingInvite(match: MatchData, playerId: string) {
  const participant = participantFor(match, playerId)

  return match.status === 'pending' && match.createdBy.id !== playerId && participant?.status === 'invited'
}

export function selectRoomMatch(matches: MatchData[], playerId: string | undefined, selectedMatchId: string | null, nowMs = Date.now()) {
  if (!playerId) {
    return null
  }

  const displayable = matches.filter((match) => isDisplayableRoomMatch(match, playerId, nowMs))
  const ranked = [...displayable].sort((left, right) => {
    const rankDelta = matchRank(right, playerId, nowMs) - matchRank(left, playerId, nowMs)

    if (rankDelta !== 0) {
      return rankDelta
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
  const selected = selectedMatchId ? displayable.find((match) => match.id === selectedMatchId) ?? null : null

  if (!selected) {
    return ranked.find((match) => !isPassiveIncomingInvite(match, playerId)) ?? null
  }

  const best = ranked[0] ?? null

  if (selected.status === 'completed' && best && matchRank(best, playerId, nowMs) > matchRank(selected, playerId, nowMs)) {
    return best
  }

  return selected
}

export function shouldReturnToLobbyWhenMatchDisappears(currentStatus?: MatchStatus, disappearedStatus?: MatchStatus) {
  return currentStatus === 'in_progress' || currentStatus === 'completed' || disappearedStatus === 'cancelled' || disappearedStatus === 'completed'
}
