import { describe, expect, it } from 'vitest'
import { isActiveRoomMatch, selectRoomMatch, shouldReturnToLobbyWhenMatchDisappears } from './multiplayerRoom'
import type { MatchData, PublicPlayer } from './api'

const host: PublicPlayer = {
  id: 'host',
  name: 'Host',
  username: 'host',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-07-08T10:00:00.000Z',
}

const guest: PublicPlayer = {
  id: 'guest',
  name: 'Guest',
  username: 'guest',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-07-08T10:00:00.000Z',
}

function match(overrides: Partial<MatchData> = {}): MatchData {
  return {
    id: 'match_1',
    type: 'challenge',
    challengeMode: 'sprint',
    status: 'accepted',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: 'seed',
    configVersion: 1,
    winnerPlayerId: null,
    createdAt: '2026-07-08T10:00:00.000Z',
    expiresAt: '2026-07-08T10:20:00.000Z',
    endsAt: null,
    serverNow: '2026-07-08T10:01:00.000Z',
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
        joinedAt: '2026-07-08T10:00:00.000Z',
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
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
        joinedAt: '2026-07-08T10:00:00.000Z',
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        player: guest,
      },
    ],
    ...overrides,
  }
}

describe('multiplayer room selection', () => {
  it('does not depend on hostActiveAt for active rooms', () => {
    expect(isActiveRoomMatch(match({ hostActiveAt: '2026-07-08T09:00:00.000Z' }), Date.parse('2026-07-08T10:01:00.000Z'))).toBe(true)
  })

  it('keeps a selected completed match when no active rematch exists', () => {
    const completed = match({
      id: 'completed',
      status: 'completed',
      finishedAt: '2026-07-08T10:02:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) => ({ ...participant, status: 'completed' })),
    })

    expect(selectRoomMatch([completed], 'host', 'completed', Date.parse('2026-07-08T10:03:00.000Z'))?.id).toBe('completed')
  })

  it("garde un match en cours visible pour l'invite qui a deja envoye son resultat", () => {
    const waitingForOpponent = match({
      status: 'in_progress',
      startedAt: '2026-07-08T10:01:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) =>
        participant.player.id === 'guest'
          ? { ...participant, status: 'completed', finishedAt: '2026-07-08T10:02:00.000Z' }
          : { ...participant, status: 'playing' },
      ),
    })

    expect(selectRoomMatch([waitingForOpponent], 'guest', 'match_1', Date.parse('2026-07-08T10:03:00.000Z'))?.id).toBe('match_1')
  })

  it("garde un match en cours visible pour l'invite pendant la soumission du resultat", () => {
    const submitting = match({
      status: 'in_progress',
      startedAt: '2026-07-08T10:01:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) =>
        participant.player.id === 'guest'
          ? { ...participant, status: 'submitting' }
          : { ...participant, status: 'playing' },
      ),
    })

    expect(selectRoomMatch([submitting], 'guest', 'match_1', Date.parse('2026-07-08T10:03:00.000Z'))?.id).toBe('match_1')
  })

  it('switches both players from a selected completed match to the active rematch', () => {
    const completed = match({
      id: 'completed',
      status: 'completed',
      finishedAt: '2026-07-08T10:02:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) => ({ ...participant, status: 'completed' })),
    })
    const rematch = match({
      id: 'rematch',
      status: 'accepted',
      createdAt: '2026-07-08T10:03:00.000Z',
      expiresAt: '2026-07-08T10:13:00.000Z',
    })

    expect(selectRoomMatch([completed, rematch], 'host', 'completed', Date.parse('2026-07-08T10:04:00.000Z'))?.id).toBe('rematch')
    expect(selectRoomMatch([completed, rematch], 'guest', 'completed', Date.parse('2026-07-08T10:04:00.000Z'))?.id).toBe('rematch')
  })

  it('hides a completed match only for the participant who dismissed the results', () => {
    const completed = match({
      id: 'completed',
      status: 'completed',
      finishedAt: '2026-07-08T10:02:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        resultDismissedAt: participant.player.id === 'host' ? '2026-07-08T10:03:00.000Z' : null,
      })),
    })

    expect(selectRoomMatch([completed], 'host', 'completed', Date.parse('2026-07-08T10:04:00.000Z'))).toBeNull()
    expect(selectRoomMatch([completed], 'guest', 'completed', Date.parse('2026-07-08T10:04:00.000Z'))?.id).toBe('completed')
  })

  it("masque un resultat termine quand la fenetre du salon a expire", () => {
    const completed = match({
      id: 'completed',
      status: 'completed',
      finishedAt: '2026-07-08T10:02:00.000Z',
      expiresAt: '2026-07-08T10:04:00.000Z',
      participants: match().participants.map((participant) => ({ ...participant, status: 'completed' })),
    })

    expect(selectRoomMatch([completed], 'host', 'completed', Date.parse('2026-07-08T10:04:01.000Z'))).toBeNull()
  })

  it("ne selectionne pas automatiquement une invitation recue sans match dans l'URL", () => {
    const invite = match({
      id: 'incoming_invite',
      status: 'pending',
      participants: match().participants.map((participant) =>
        participant.player.id === 'guest'
          ? { ...participant, status: 'invited', joinedAt: null }
          : participant,
      ),
    })

    expect(selectRoomMatch([invite], 'guest', null, Date.parse('2026-07-08T10:04:00.000Z'))).toBeNull()
    expect(selectRoomMatch([invite], 'guest', 'incoming_invite', Date.parse('2026-07-08T10:04:00.000Z'))?.id).toBe('incoming_invite')
  })

  it("ne laisse pas une invitation recue masquer un resultat encore visible", () => {
    const completed = match({
      id: 'completed',
      status: 'completed',
      finishedAt: '2026-07-08T10:02:00.000Z',
      expiresAt: '2026-07-08T10:22:00.000Z',
      participants: match().participants.map((participant) => ({ ...participant, status: 'completed' })),
    })
    const invite = match({
      id: 'incoming_invite',
      status: 'pending',
      createdAt: '2026-07-08T10:04:00.000Z',
      participants: match().participants.map((participant) =>
        participant.player.id === 'guest'
          ? { ...participant, status: 'invited', joinedAt: null }
          : participant,
      ),
    })

    expect(selectRoomMatch([completed, invite], 'guest', null, Date.parse('2026-07-08T10:05:00.000Z'))?.id).toBe('completed')
  })

  it("garde le salon ouvert cote hote pendant que l'invitation est en attente", () => {
    const invite = match({
      id: 'outgoing_invite',
      status: 'pending',
      participants: match().participants.map((participant) =>
        participant.player.id === 'guest'
          ? { ...participant, status: 'invited', joinedAt: null }
          : participant,
      ),
    })

    expect(selectRoomMatch([invite], 'host', null, Date.parse('2026-07-08T10:04:00.000Z'))?.id).toBe('outgoing_invite')
  })
})

describe('multiplayer room disappearance policy', () => {
  it('renvoie au lobby quand une partie ou des resultats disparaissent', () => {
    expect(shouldReturnToLobbyWhenMatchDisappears('in_progress')).toBe(true)
    expect(shouldReturnToLobbyWhenMatchDisappears('completed')).toBe(true)
    expect(shouldReturnToLobbyWhenMatchDisappears('accepted', 'completed')).toBe(true)
    expect(shouldReturnToLobbyWhenMatchDisappears('accepted', 'cancelled')).toBe(true)
  })

  it('garde le draft-room pour les salons non termines devenus indisponibles', () => {
    expect(shouldReturnToLobbyWhenMatchDisappears('pending')).toBe(false)
    expect(shouldReturnToLobbyWhenMatchDisappears('accepted')).toBe(false)
    expect(shouldReturnToLobbyWhenMatchDisappears('ready')).toBe(false)
  })
})
