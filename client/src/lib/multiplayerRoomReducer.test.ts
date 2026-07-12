import { describe, expect, it } from 'vitest'
import { initialMultiplayerRoomState, multiplayerRoomReducer } from './multiplayerRoomReducer'
import type { MatchData, PublicPlayer } from './api'

const host: PublicPlayer = {
  id: 'host',
  name: 'Host',
  username: 'host',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-07-10T10:00:00.000Z',
}

const guest: PublicPlayer = {
  id: 'guest',
  name: 'Guest',
  username: 'guest',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-07-10T10:00:00.000Z',
}

function match(overrides: Partial<MatchData> = {}): MatchData {
  return {
    id: 'match_1',
    roomId: 'room_1',
    type: 'challenge',
    challengeMode: null,
    status: 'accepted',
    game: null,
    level: null,
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: null,
    configVersion: 0,
    winnerPlayerId: null,
    createdAt: '2026-07-10T10:00:00.000Z',
    expiresAt: '2026-07-10T10:20:00.000Z',
    endsAt: null,
    serverNow: '2026-07-10T10:00:00.000Z',
    hostActiveAt: null,
    startedAt: null,
    finishedAt: null,
    createdBy: host,
    participants: [
      {
        id: 'participant_host',
        status: 'accepted',
        preferredChallengeMode: null,
        preferredGame: null,
        preferredLevel: null,
        score: null,
        scorePoints: 0,
        xp: null,
        correctAnswers: 0,
        totalQuestions: 0,
        totalResponseTimeMs: 0,
        bestStreak: 0,
        joinedAt: '2026-07-10T10:00:00.000Z',
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: { room: { wins: 0, losses: 0, draws: 0 }, friendship: { wins: 0, losses: 0, draws: 0 } },
        player: host,
      },
      {
        id: 'participant_guest',
        status: 'accepted',
        preferredChallengeMode: null,
        preferredGame: null,
        preferredLevel: null,
        score: null,
        scorePoints: 0,
        xp: null,
        correctAnswers: 0,
        totalQuestions: 0,
        totalResponseTimeMs: 0,
        bestStreak: 0,
        joinedAt: '2026-07-10T10:00:00.000Z',
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: { room: { wins: 0, losses: 0, draws: 0 }, friendship: { wins: 0, losses: 0, draws: 0 } },
        player: guest,
      },
    ],
    ...overrides,
  }
}

describe('multiplayerRoomReducer', () => {
  it('applies a newer room event even before view selection depends on a profile', () => {
    const state = multiplayerRoomReducer(initialMultiplayerRoomState, {
      type: 'room-event',
      selectedMatchId: 'match_1',
      event: {
        roomId: 'room_1',
        matchId: 'match_1',
        eventId: 'event_1',
        revision: 1,
        type: 'match_config_updated',
        reason: 'match_config_updated',
        serverTime: '2026-07-10T10:00:01.000Z',
        match: match({ challengeMode: 'tempo', configVersion: 1 }),
      },
    })

    expect(state.activeMatch?.challengeMode).toBe('tempo')
    expect(state.roomRevisions.room_1).toBe(1)
    expect(state.lastEventIds.room_1).toBe('event_1')
  })

  it('ignores older room events for the same room', () => {
    const current = multiplayerRoomReducer(initialMultiplayerRoomState, {
      type: 'room-event',
      selectedMatchId: 'match_1',
      event: {
        roomId: 'room_1',
        matchId: 'match_1',
        eventId: 'event_2',
        revision: 2,
        type: 'match_config_updated',
        reason: 'match_config_updated',
        serverTime: '2026-07-10T10:00:02.000Z',
        match: match({ challengeMode: 'tempo', configVersion: 2 }),
      },
    })

    const stale = multiplayerRoomReducer(current, {
      type: 'room-event',
      selectedMatchId: 'match_1',
      event: {
        roomId: 'room_1',
        matchId: 'match_1',
        eventId: 'event_1',
        revision: 1,
        type: 'match_config_updated',
        reason: 'match_config_updated',
        serverTime: '2026-07-10T10:00:01.000Z',
        match: match({ challengeMode: 'sprint', configVersion: 1 }),
      },
    })

    expect(stale.activeMatch?.challengeMode).toBe('tempo')
    expect(stale.lastEventIds.room_1).toBe('event_2')
  })

  it('accepts a recovery snapshot at the current or newer revision', () => {
    const state = multiplayerRoomReducer(initialMultiplayerRoomState, {
      type: 'room-snapshot',
      selectedMatchId: 'match_1',
      snapshot: {
        roomId: 'room_1',
        matchId: 'match_1',
        revision: 3,
        serverTime: '2026-07-10T10:00:03.000Z',
        match: match({ game: 'mixte', configVersion: 3 }),
      },
    })

    expect(state.activeMatch?.game).toBe('mixte')
    expect(state.roomRevisions.room_1).toBe(3)
  })
})
