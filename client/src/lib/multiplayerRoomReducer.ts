import type { MatchData } from './api'

export type MultiplayerRoomEvent = {
  roomId: string
  matchId: string
  eventId: string
  revision: number
  type: string
  reason: string
  serverTime: string
  match: MatchData
}

export type MultiplayerRoomSnapshot = {
  roomId: string
  matchId: string
  revision: number
  serverTime: string
  match: MatchData
}

export type MultiplayerRoomState = {
  matches: MatchData[]
  activeMatch: MatchData | null
  roomRevisions: Record<string, number>
  lastEventIds: Record<string, string>
}

export type MultiplayerRoomAction =
  | { type: 'bootstrap'; matches: MatchData[]; selectedMatchId?: string | null }
  | { type: 'match-upsert'; match: MatchData; selectedMatchId?: string | null }
  | { type: 'room-event'; event: MultiplayerRoomEvent; selectedMatchId?: string | null }
  | { type: 'room-snapshot'; snapshot: MultiplayerRoomSnapshot; selectedMatchId?: string | null }
  | { type: 'dismiss-match'; matchId: string }
  | { type: 'clear-active' }

export const initialMultiplayerRoomState: MultiplayerRoomState = {
  matches: [],
  activeMatch: null,
  roomRevisions: {},
  lastEventIds: {},
}

function matchRoomId(match: MatchData) {
  return match.roomId ?? match.id
}

function upsertMatch(matches: MatchData[], match: MatchData) {
  return [match, ...matches.filter((item) => item.id !== match.id)]
}

function selectActive(matches: MatchData[], selectedMatchId?: string | null, current?: MatchData | null) {
  if (selectedMatchId) {
    return matches.find((match) => match.id === selectedMatchId) ?? current ?? null
  }

  if (current) {
    return matches.find((match) => match.id === current.id) ?? current
  }

  return null
}

function applyMatch(state: MultiplayerRoomState, match: MatchData, selectedMatchId?: string | null) {
  const matches = upsertMatch(state.matches, match)

  return {
    ...state,
    matches,
    activeMatch: selectActive(matches, selectedMatchId, state.activeMatch),
  }
}

export function multiplayerRoomReducer(state: MultiplayerRoomState, action: MultiplayerRoomAction): MultiplayerRoomState {
  switch (action.type) {
    case 'bootstrap': {
      return {
        ...state,
        matches: action.matches,
        activeMatch: selectActive(action.matches, action.selectedMatchId, state.activeMatch),
      }
    }

    case 'match-upsert':
      return applyMatch(state, action.match, action.selectedMatchId)

    case 'room-event': {
      const currentRevision = state.roomRevisions[action.event.roomId] ?? 0

      if (action.event.revision <= currentRevision) {
        return state
      }

      const next = applyMatch(state, action.event.match, action.selectedMatchId)

      return {
        ...next,
        roomRevisions: {
          ...next.roomRevisions,
          [action.event.roomId]: action.event.revision,
        },
        lastEventIds: {
          ...next.lastEventIds,
          [action.event.roomId]: action.event.eventId,
        },
      }
    }

    case 'room-snapshot': {
      const currentRevision = state.roomRevisions[action.snapshot.roomId] ?? 0

      if (action.snapshot.revision < currentRevision) {
        return state
      }

      const next = applyMatch(state, action.snapshot.match, action.selectedMatchId)

      return {
        ...next,
        roomRevisions: {
          ...next.roomRevisions,
          [action.snapshot.roomId]: action.snapshot.revision,
        },
      }
    }

    case 'dismiss-match': {
      const matches = state.matches.filter((match) => match.id !== action.matchId)
      const activeMatch = state.activeMatch?.id === action.matchId ? null : state.activeMatch

      return { ...state, matches, activeMatch }
    }

    case 'clear-active':
      return { ...state, activeMatch: null }
  }
}

export function lastSeenEventIdForMatch(state: MultiplayerRoomState, match: MatchData | null | undefined) {
  if (!match) {
    return null
  }

  return state.lastEventIds[matchRoomId(match)] ?? null
}
