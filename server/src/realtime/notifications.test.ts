import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import {
  closeRealtime,
  emitMatchSnapshot,
  emitSocialChanged,
  getInFlightRealtimeMatchSnapshot,
  listInFlightRealtimeMatchSnapshots,
  getRealtimeHealth,
  getPendingRealtimeHeartbeatSnapshot,
  initRealtime,
  waitForRealtimePersistenceIdle,
} from './notifications.js'

const matchServiceMocks = vi.hoisted(() => ({
  acceptChallenge: vi.fn(),
  acceptChallengeProposal: vi.fn(),
  challengeRunDurationSeconds: (config: {
    challengeMode: string | null
    durationSeconds: number
    questionCount: number | null
    perQuestionTimeLimitSeconds: number | null
  }) => {
    if (config.challengeMode === 'tempo') {
      return Math.max(1, config.questionCount ?? 1) * Math.max(1, config.perQuestionTimeLimitSeconds ?? 10)
    }

    return Math.max(1, config.durationSeconds)
  },
  completeChallengeResult: vi.fn(),
  createChallenge: vi.fn(),
  declineChallenge: vi.fn(),
  declineChallengeProposal: vi.fn(),
  forfeitChallenge: vi.fn(),
  leaveChallenge: vi.fn(),
  proposeChallenge: vi.fn(),
  startChallengeProposal: vi.fn(),
  updateChallengeConfig: vi.fn(),
  requestChallengeRematch: vi.fn(),
  persistTempoQuestionAnswer: vi.fn(),
  MATCH_IN_PROGRESS_GRACE_MS: 2 * 60 * 1000,
  MatchServiceError: class MatchServiceError extends Error {
    constructor(public readonly code: string) {
      super(code)
    }
  },
}))

const notificationServiceMocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  dismissNotificationByDedupeKey: vi.fn(),
  matchDeclinedNotificationKey: (matchId: string) => `match:${matchId}:declined`,
  matchInviteNotificationKey: (matchId: string) => `match:${matchId}:invite`,
}))

vi.mock('../services/matchService.js', () => matchServiceMocks)
vi.mock('../services/notificationService.js', () => notificationServiceMocks)

let httpServer: HttpServer | null = null
const sockets: ClientSocket[] = []

function listen(server: HttpServer) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function closeServer(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function connectClient(port: number, token: string) {
  const socket = createClient(`http://127.0.0.1:${port}`, {
    auth: { token },
    forceNew: true,
    transports: ['websocket'],
  })

  sockets.push(socket)

  await new Promise<void>((resolve, reject) => {
    socket.once('realtime:ready', () => resolve())
    socket.once('connect_error', reject)
  })

  return socket
}

const playerA = {
  id: 'player_a',
  name: 'Awa',
  username: 'awa',
  avatarUrl: null,
  totalXp: 100,
  presenceStatus: 'online',
  presenceUpdatedAt: new Date('2026-07-09T10:00:00.000Z'),
}

const playerB = {
  id: 'player_b',
  name: 'Binta',
  username: 'binta',
  avatarUrl: null,
  totalXp: 200,
  presenceStatus: 'online',
  presenceUpdatedAt: new Date('2026-07-09T10:00:00.000Z'),
}

function notificationView() {
  return {
    id: 'notification_1',
    playerId: 'player_b',
    actorPlayerId: 'player_a',
    type: 'match_invite_received',
    status: 'active',
    title: 'Awa vous a defie.',
    body: null,
    href: '/jeu/multijoueur?match=match_1',
    dedupeKey: 'match:match_1:invite',
    readAt: null,
    dismissedAt: null,
    createdAt: new Date('2026-07-09T10:00:01.000Z'),
    actorPlayer: playerA,
  }
}

function matchView() {
  return {
    id: 'match_1',
    roomId: 'room_1',
    type: 'challenge',
    challengeMode: 'sprint',
    status: 'accepted',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: 'seed_1',
    configVersion: 2,
    winnerPlayerId: null,
    createdAt: new Date('2026-07-09T10:00:00.000Z'),
    expiresAt: new Date('2026-07-09T10:20:00.000Z'),
    hostActiveAt: new Date('2026-07-09T10:00:00.000Z'),
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    createdBy: playerA,
    participants: [
      {
        id: 'participant_a',
        playerId: 'player_a',
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
        joinedAt: new Date('2026-07-09T10:00:00.000Z'),
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: { room: { wins: 0, losses: 0, draws: 0 }, friendship: { wins: 0, losses: 0, draws: 0 } },
        player: playerA,
      },
      {
        id: 'participant_b',
        playerId: 'player_b',
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
        joinedAt: new Date('2026-07-09T10:00:00.000Z'),
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: { room: { wins: 0, losses: 0, draws: 0 }, friendship: { wins: 0, losses: 0, draws: 0 } },
        player: playerB,
      },
    ],
  }
}

function pendingMatchView() {
  return {
    ...matchView(),
    status: 'pending',
    participants: matchView().participants.map((participant) =>
      participant.playerId === 'player_b'
        ? { ...participant, status: 'invited', joinedAt: null }
        : participant,
    ),
  }
}

function readyMatchView() {
  return {
    ...matchView(),
    status: 'ready',
  }
}

function startedMatchView() {
  const startedAt = new Date('2026-07-09T10:05:00.000Z')

  return {
    ...matchView(),
    status: 'in_progress',
    startedAt,
    endsAt: new Date(startedAt.getTime() + 60_000),
    participants: matchView().participants.map((participant) => ({
      ...participant,
      status: 'playing',
    })),
  }
}

function completedMatchView() {
  return {
    ...matchView(),
    challengeMode: 'tempo',
    status: 'completed',
    questionCount: 10,
    perQuestionTimeLimitSeconds: 10,
    winnerPlayerId: 'player_a',
    startedAt: new Date('2026-07-09T10:01:00.000Z'),
    finishedAt: new Date('2026-07-09T10:03:00.000Z'),
    participants: matchView().participants.map((participant) => ({
      ...participant,
      status: 'completed',
      score: participant.playerId === 'player_a' ? 100 : 80,
      scorePoints: participant.playerId === 'player_a' ? 10 : 8,
      xp: participant.playerId === 'player_a' ? 95 : 75,
      correctAnswers: participant.playerId === 'player_a' ? 10 : 8,
      totalQuestions: 10,
      finishedAt: new Date('2026-07-09T10:03:00.000Z'),
    })),
  }
}

function cancelledMatchView() {
  const finishedAt = new Date('2026-07-09T10:04:00.000Z')

  return {
    ...matchView(),
    status: 'cancelled',
    finishedAt,
    expiresAt: finishedAt,
    participants: matchView().participants.map((participant) => ({
      ...participant,
      status: 'declined',
      finishedAt,
      rematchRequestedAt: null,
    })),
  }
}

function inProgressTempoMatchView() {
  return {
    ...matchView(),
    challengeMode: 'tempo',
    status: 'in_progress',
    questionCount: 10,
    perQuestionTimeLimitSeconds: 10,
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    participants: matchView().participants.map((participant) => ({
      ...participant,
      status: 'playing',
    })),
  }
}

describe('realtime notifications', () => {
  beforeEach(() => {
    matchServiceMocks.acceptChallenge.mockReset()
    matchServiceMocks.acceptChallengeProposal.mockReset()
    matchServiceMocks.completeChallengeResult.mockReset()
    matchServiceMocks.createChallenge.mockReset()
    matchServiceMocks.declineChallenge.mockReset()
    matchServiceMocks.declineChallengeProposal.mockReset()
    matchServiceMocks.forfeitChallenge.mockReset()
    matchServiceMocks.leaveChallenge.mockReset()
    matchServiceMocks.proposeChallenge.mockReset()
    matchServiceMocks.startChallengeProposal.mockReset()
    matchServiceMocks.updateChallengeConfig.mockReset()
    matchServiceMocks.requestChallengeRematch.mockReset()
    matchServiceMocks.persistTempoQuestionAnswer.mockReset()
    notificationServiceMocks.createNotification.mockReset()
    notificationServiceMocks.createNotification.mockResolvedValue(notificationView())
    notificationServiceMocks.dismissNotificationByDedupeKey.mockReset()
    notificationServiceMocks.dismissNotificationByDedupeKey.mockResolvedValue(false)
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect()
    }

    closeRealtime()

    if (httpServer) {
      await closeServer(httpServer)
      httpServer = null
    }
  })

  it("expose l'etat de readiness Socket.IO", async () => {
    expect(getRealtimeHealth()).toMatchObject({ initialized: false, connectedSockets: 0, onlinePlayers: 0 })

    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => (token === 'token_a' ? { clerkUserId: 'clerk_a', playerId: 'player_a' } : null),
    })

    expect(getRealtimeHealth()).toMatchObject({ initialized: true, connectedSockets: 0, onlinePlayers: 0 })

    const port = await listen(httpServer)
    await connectClient(port, 'token_a')

    expect(getRealtimeHealth()).toMatchObject({ initialized: true, connectedSockets: 1, onlinePlayers: 0 })
  })

  it('envoie les evenements sociaux uniquement aux rooms des joueurs cibles', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    const port = await listen(httpServer)
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    let clientBReceived = false
    clientB.on('social:changed', () => {
      clientBReceived = true
    })

    const receivedByA = new Promise<{ reason: string }>((resolve) => {
      clientA.once('social:changed', resolve)
    })

    emitSocialChanged(['player_a'], 'friend_request_sent')

    await expect(receivedByA).resolves.toMatchObject({ reason: 'friend_request_sent' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(clientBReceived).toBe(false)
  })

  it('refuse une connexion realtime sans token valide', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async () => null,
    })
    const port = await listen(httpServer)
    const socket = createClient(`http://127.0.0.1:${port}`, {
      auth: { token: 'invalid' },
      forceNew: true,
      transports: ['websocket'],
    })
    sockets.push(socket)

    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('connect_error', reject)
      }),
    ).rejects.toThrow('unauthorized')
  })

  it('autorise les origines locales Socket.IO identiques a REST en developpement', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async () => null,
    })
    const port = await listen(httpServer)

    const response = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
  })

  it('met a jour la configuration du salon par commande Socket.IO avec ACK et broadcast', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.updateChallengeConfig.mockResolvedValueOnce(matchView())
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...matchView(), configVersion: 1 }, 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToGuest = new Promise<{ reason: string; match: { id: string; configVersion: number } }>((resolve) => {
      clientB.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; configVersion: number } } }>((resolve) => {
      clientA.emit(
        'match:update-config',
        {
          matchId: 'match_1',
          config: {
            game: 'addition',
            level: 'debutant',
            practiceSkill: null,
            challengeMode: 'sprint',
            durationSeconds: 60,
            expectedConfigVersion: 1,
          },
        },
        resolve,
      )
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', configVersion: 2 } } })
    await expect(broadcastToGuest).resolves.toMatchObject({
      reason: 'match_config_updated',
      match: { id: 'match_1', configVersion: 2 },
    })
    expect(matchServiceMocks.updateChallengeConfig).toHaveBeenCalledWith(
      'player_a',
      'match_1',
      expect.objectContaining({
        game: 'addition',
        level: 'debutant',
        challengeMode: 'sprint',
        expectedConfigVersion: 1,
      }),
    )
  })

  it('dedoublonne une commande realtime par clientCommandId avant la persistance', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.updateChallengeConfig.mockResolvedValueOnce(matchView())
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...matchView(), configVersion: 1 }, 'match_seeded')
    const clientA = await connectClient(port, 'token_a')

    const command = {
      matchId: 'match_1',
      clientCommandId: 'cmd_config_1',
      config: {
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'tempo',
        questionCount: 10,
        expectedConfigVersion: 1,
      },
    }
    const firstAck = await new Promise<{ ok: boolean; data?: { match: { id: string; challengeMode: string | null } } }>((resolve) => {
      clientA.emit('match:update-config', command, resolve)
    })
    const secondAck = await new Promise<{ ok: boolean; data?: { match: { id: string; challengeMode: string | null } } }>((resolve) => {
      clientA.emit('match:update-config', command, resolve)
    })

    expect(firstAck).toMatchObject({ ok: true, data: { match: { id: 'match_1' } } })
    expect(secondAck).toMatchObject({ ok: true, data: { match: { id: 'match_1', challengeMode: 'tempo' } } })
    expect(matchServiceMocks.updateChallengeConfig).toHaveBeenCalledTimes(1)
  })

  it('rejoint une room et rejoue les evenements manques apres le dernier eventId connu', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...matchView(), configVersion: 1 }, 'match_seeded')
    const clientA = await connectClient(port, 'token_a')

    await new Promise<void>((resolve) => {
      clientA.emit('room:join', { roomId: 'room_1' }, () => resolve())
    })
    const secondEventPromise = new Promise<{ eventId: string; revision: number; match: { configVersion: number } }>((resolve) => {
      clientA.once('room:event', resolve)
    })
    emitMatchSnapshot({ ...matchView(), configVersion: 2 }, 'match_config_updated')
    const secondEvent = await secondEventPromise

    emitMatchSnapshot({ ...matchView(), configVersion: 3 }, 'match_config_updated')
    const clientB = await connectClient(port, 'token_b')
    const replayedEventPromise = new Promise<{ revision: number; match: { configVersion: number } }>((resolve) => {
      clientB.once('room:event', resolve)
    })

    await new Promise<void>((resolve) => {
      clientB.emit('room:join', { roomId: 'room_1', lastSeenEventId: secondEvent.eventId }, () => resolve())
    })

    await expect(replayedEventPromise).resolves.toMatchObject({
      revision: secondEvent.revision + 1,
      match: { configVersion: 3 },
    })
  })

  it('cree une invitation de defi par commande Socket.IO avec match et notification diffuses', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.createChallenge.mockResolvedValueOnce(pendingMatchView())
    notificationServiceMocks.createNotification.mockResolvedValueOnce(notificationView())
    const port = await listen(httpServer)
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const matchToGuest = new Promise<{ reason: string; match: { id: string; status: string } }>((resolve) => {
      clientB.once('match:changed', resolve)
    })
    const notificationToGuest = new Promise<{ reason: string; notification: { id: string; title: string; href: string } }>((resolve) => {
      clientB.once('notifications:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientA.emit(
        'match:create-invitation',
        {
          opponentPlayerId: 'player_b',
          game: 'addition',
          level: 'debutant',
          practiceSkill: null,
          challengeMode: 'sprint',
          durationSeconds: 60,
        },
        resolve,
      )
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'pending' } } })
    await expect(matchToGuest).resolves.toMatchObject({
      reason: 'match_created',
      match: { id: 'match_1', status: 'pending' },
    })
    await expect(notificationToGuest).resolves.toMatchObject({
      reason: 'notification_created',
      notification: {
        id: 'notification_1',
        title: 'Awa vous a defie.',
        href: '/jeu/multijoueur?match=match_1',
      },
    })
    expect(matchServiceMocks.createChallenge).toHaveBeenCalledWith(
      'player_a',
      expect.objectContaining({ opponentPlayerId: 'player_b', challengeMode: 'sprint' }),
      expect.objectContaining({
        matchId: expect.any(String),
        roomId: expect.any(String),
        creatorParticipantId: expect.any(String),
        opponentParticipantId: expect.any(String),
      }),
    )
    expect(notificationServiceMocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player_b',
      actorPlayerId: 'player_a',
      dedupeKey: 'match:match_1:invite',
    }))
  })

  it('autorise le heartbeat hote uniquement pendant la persistance realtime en attente', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return {
            clerkUserId: 'clerk_a',
            playerId: 'player_a',
            player: { ...playerA, presenceUpdatedAt: playerA.presenceUpdatedAt.toISOString() },
          }
        }

        if (token === 'token_b') {
          return {
            clerkUserId: 'clerk_b',
            playerId: 'player_b',
            player: { ...playerB, presenceUpdatedAt: playerB.presenceUpdatedAt.toISOString() },
          }
        }

        return null
      },
    })

    let unblockCreate!: () => void
    const createUnblocked = new Promise<void>((resolve) => {
      unblockCreate = resolve
    })
    matchServiceMocks.createChallenge.mockImplementationOnce(async (_playerId, _command, ids) => {
      await createUnblocked
      const baseMatch = pendingMatchView()

      return {
        ...baseMatch,
        id: ids.matchId,
        roomId: ids.roomId,
        participants: baseMatch.participants.map((participant) => {
          if (participant.playerId === 'player_a') {
            return { ...participant, id: ids.creatorParticipantId }
          }

          return { ...participant, id: ids.opponentParticipantId }
        }),
      }
    })

    const port = await listen(httpServer)
    const [clientA] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string; hostActiveAt: string | null } } }>((resolve) => {
      clientA.emit(
        'match:create-invitation',
        {
          opponentPlayerId: 'player_b',
          game: 'addition',
          level: 'debutant',
          practiceSkill: null,
          challengeMode: 'sprint',
          durationSeconds: 60,
        },
        resolve,
      )
    })

    const matchId = ack.data?.match.id
    expect(ack).toMatchObject({ ok: true, data: { match: { status: 'pending' } } })
    expect(matchId).toEqual(expect.any(String))

    const pendingSnapshot = getPendingRealtimeHeartbeatSnapshot('player_a', matchId!)

    expect(pendingSnapshot).toMatchObject({
      id: matchId,
      status: 'pending',
      createdBy: { id: 'player_a' },
      hostActiveAt: expect.any(String),
    })
    const guestInFlightMatch = getInFlightRealtimeMatchSnapshot('player_b', matchId!)

    expect(guestInFlightMatch).toMatchObject({ id: matchId })
    expect(guestInFlightMatch?.participants.some((participant) => participant.player.id === 'player_b')).toBe(true)
    expect(listInFlightRealtimeMatchSnapshots('player_b')).toEqual([
      expect.objectContaining({ id: matchId }),
    ])
    expect(getInFlightRealtimeMatchSnapshot('player_unknown', matchId!)).toBeNull()
    expect(getPendingRealtimeHeartbeatSnapshot('player_b', matchId!)).toBeNull()
    expect(getPendingRealtimeHeartbeatSnapshot('player_a', 'match_missing')).toBeNull()

    unblockCreate()
    await waitForRealtimePersistenceIdle()

    expect(getPendingRealtimeHeartbeatSnapshot('player_a', matchId!)).toBeNull()
    expect(listInFlightRealtimeMatchSnapshots('player_b')).toEqual([])
  })

  it("fait entrer l'invite dans le salon par commande Socket.IO avec ACK et broadcast", async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.acceptChallenge.mockResolvedValueOnce(matchView())
    const port = await listen(httpServer)
    emitMatchSnapshot(pendingMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; status: string; participants: Array<{ id: string; status: string }> } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientB.emit('match:accept-invitation', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'accepted' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_accepted',
      match: {
        id: 'match_1',
        status: 'accepted',
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'participant_b', status: 'accepted', joinedAt: expect.any(String) }),
        ]),
      },
    })
    expect(matchServiceMocks.acceptChallenge).toHaveBeenCalledWith('player_b', 'match_1')
  })

  it("refuse une invitation par commande Socket.IO et annule le salon pour l'hote", async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.declineChallenge.mockResolvedValueOnce(cancelledMatchView())
    notificationServiceMocks.dismissNotificationByDedupeKey.mockResolvedValueOnce(true)
    const port = await listen(httpServer)
    emitMatchSnapshot(pendingMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; status: string; participants: Array<{ id: string; status: string }> } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientB.emit('match:decline-invitation', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'cancelled' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_declined',
      match: {
        id: 'match_1',
        status: 'cancelled',
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'participant_b', status: 'declined', finishedAt: expect.any(String) }),
        ]),
      },
    })
    expect(matchServiceMocks.declineChallenge).toHaveBeenCalledWith('player_b', 'match_1')
    await expect.poll(() => notificationServiceMocks.dismissNotificationByDedupeKey.mock.calls.length).toBe(1)
    expect(notificationServiceMocks.dismissNotificationByDedupeKey).toHaveBeenCalledWith('player_b', 'match:match_1:invite')
  })

  it('ignore les champs de configuration inactifs avant validation realtime', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.updateChallengeConfig.mockResolvedValueOnce({
      ...matchView(),
      challengeMode: 'tempo',
      durationSeconds: 100,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 10,
    })
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...matchView(), configVersion: 1 }, 'match_seeded')
    const clientA = await connectClient(port, 'token_a')

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string } }; error?: { message: string } }>((resolve) => {
      clientA.emit(
        'match:update-config',
        {
          matchId: 'match_1',
          config: {
            game: 'addition',
            level: 'debutant',
            practiceSkill: null,
            challengeMode: 'tempo',
            durationSeconds: 60,
            questionCount: 10,
            perQuestionTimeLimitSeconds: 5,
            expectedConfigVersion: 1,
          },
        },
        resolve,
      )
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1' } } })
    expect(matchServiceMocks.updateChallengeConfig).toHaveBeenCalledWith(
      'player_a',
      'match_1',
      expect.objectContaining({ perQuestionTimeLimitSeconds: 5 }),
    )
    expect(matchServiceMocks.updateChallengeConfig).toHaveBeenCalledWith(
      'player_a',
      'match_1',
      expect.not.objectContaining({ durationSeconds: expect.anything() }),
    )
  })

  it('propose le defi par commande Socket.IO avec ACK et broadcast', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.proposeChallenge.mockResolvedValueOnce(readyMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot(matchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToGuest = new Promise<{ reason: string; match: { id: string; status: string } }>((resolve) => {
      clientB.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientA.emit('match:propose', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'ready' } } })
    await expect(broadcastToGuest).resolves.toMatchObject({
      reason: 'match_proposed',
      match: { id: 'match_1', status: 'ready' },
    })
    expect(matchServiceMocks.proposeChallenge).toHaveBeenCalledWith('player_a', 'match_1')
  })

  it('refuse une proposition par commande Socket.IO et remet le salon en configuration', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.declineChallengeProposal.mockResolvedValueOnce({
      ...matchView(),
      status: 'accepted',
      configVersion: 4,
    })
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...readyMatchView(), configVersion: 3 }, 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; status: string; configVersion: number } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string; configVersion: number } } }>((resolve) => {
      clientB.emit('match:decline-proposal', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'accepted', configVersion: 4 } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_proposal_declined',
      match: { id: 'match_1', status: 'accepted', configVersion: 4 },
    })
    expect(matchServiceMocks.declineChallengeProposal).toHaveBeenCalledWith('player_b', 'match_1')
  })

  it('propose le defi avec la configuration finale dans une seule commande Socket.IO', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.updateChallengeConfig.mockResolvedValueOnce({
      ...matchView(),
      challengeMode: 'tempo',
      questionCount: 10,
      perQuestionTimeLimitSeconds: 10,
      configVersion: 3,
    })
    matchServiceMocks.proposeChallenge.mockResolvedValueOnce({
      ...readyMatchView(),
      challengeMode: 'tempo',
      questionCount: 10,
      durationSeconds: 50,
      perQuestionTimeLimitSeconds: 5,
      configVersion: 3,
    })
    const port = await listen(httpServer)
    emitMatchSnapshot({
      ...matchView(),
      game: null,
      level: null,
      challengeMode: null,
      questionSeed: null,
      configVersion: 2,
    }, 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToGuest = new Promise<{ reason: string; match: { id: string; status: string; challengeMode: string; questionCount: number; configVersion: number; questionSeed: string } }>((resolve) => {
      clientB.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientA.emit(
        'match:propose',
        {
          matchId: 'match_1',
          config: {
            game: 'addition',
            level: 'debutant',
            practiceSkill: null,
            challengeMode: 'tempo',
            durationSeconds: 60,
            questionCount: 10,
            perQuestionTimeLimitSeconds: 5,
          },
        },
        resolve,
      )
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'ready' } } })
    await expect(broadcastToGuest).resolves.toMatchObject({
      reason: 'match_proposed',
      match: {
        id: 'match_1',
        status: 'ready',
        challengeMode: 'tempo',
        questionCount: 10,
        configVersion: 3,
        questionSeed: expect.any(String),
      },
    })
    expect(matchServiceMocks.updateChallengeConfig).not.toHaveBeenCalled()
    expect(matchServiceMocks.proposeChallenge).toHaveBeenCalledWith(
      'player_a',
      'match_1',
      expect.objectContaining({
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'tempo',
        durationSeconds: 50,
        questionCount: 10,
        perQuestionTimeLimitSeconds: 5,
        questionSeed: expect.any(String),
        configVersion: 3,
      }),
    )
  })

  it('lance le defi par commande Socket.IO avec ACK et broadcast', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.startChallengeProposal.mockResolvedValueOnce(startedMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot(readyMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; status: string; participants: Array<{ id: string; status: string }> } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientB.emit('match:accept-proposal', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'in_progress' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_started',
      match: {
        id: 'match_1',
        status: 'in_progress',
        startedAt: expect.any(String),
        endsAt: expect.any(String),
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'participant_a', status: 'playing' }),
          expect.objectContaining({ id: 'participant_b', status: 'playing' }),
        ]),
      },
    })
    expect(matchServiceMocks.startChallengeProposal).toHaveBeenCalledWith(
      'player_b',
      'match_1',
      expect.objectContaining({
        game: 'addition',
        level: 'debutant',
        challengeMode: 'sprint',
        durationSeconds: 60,
        questionSeed: 'seed_1',
      }),
      expect.any(Date),
    )
    expect(matchServiceMocks.updateChallengeConfig).not.toHaveBeenCalled()
    expect(matchServiceMocks.acceptChallengeProposal).not.toHaveBeenCalled()
  })

  it("diffuse une duree d'execution tempo basee sur le nombre de questions", async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.startChallengeProposal.mockResolvedValueOnce(startedMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot({
      ...readyMatchView(),
      challengeMode: 'tempo',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
    }, 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ match: { startedAt: string; endsAt: string; expiresAt: string } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      clientB.emit('match:accept-proposal', { matchId: 'match_1' }, resolve)
    })
    const broadcast = await broadcastToHost
    const startedAtMs = Date.parse(broadcast.match.startedAt)

    expect(ack.ok).toBe(true)
    expect(Date.parse(broadcast.match.endsAt) - startedAtMs).toBe(30 * 10 * 1000)
    expect(Date.parse(broadcast.match.expiresAt) - startedAtMs).toBe(30 * 10 * 1000 + 2 * 60 * 1000)
    expect(matchServiceMocks.startChallengeProposal).toHaveBeenCalledWith(
      'player_b',
      'match_1',
      expect.objectContaining({
        challengeMode: 'tempo',
        durationSeconds: 60,
        questionCount: 30,
        perQuestionTimeLimitSeconds: 10,
      }),
      expect.any(Date),
    )
  })

  it('termine un defi par abandon avec victoire adverse et badge abandon dans le snapshot realtime', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })

    const finishedAt = new Date('2026-07-09T10:06:00.000Z')
    const hostProgress = {
      score: 75,
      scorePoints: 34,
      correctAnswers: 3,
      totalQuestions: 4,
      totalResponseTimeMs: 2200,
      bestStreak: 2,
    }
    const guestProgress = {
      score: 50,
      scorePoints: 18,
      correctAnswers: 2,
      totalQuestions: 4,
      totalResponseTimeMs: 2600,
      bestStreak: 1,
    }
    matchServiceMocks.forfeitChallenge.mockResolvedValueOnce({
      ...startedMatchView(),
      status: 'completed',
      winnerPlayerId: 'player_a',
      finishedAt,
      participants: startedMatchView().participants.map((participant) => ({
        ...participant,
        ...(participant.playerId === 'player_a' ? hostProgress : guestProgress),
        status: 'completed',
        finishedAt,
        forfeitedAt: participant.playerId === 'player_b' ? finishedAt : null,
      })),
    })

    const port = await listen(httpServer)
    emitMatchSnapshot(startedMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    await new Promise<{ ok: boolean }>((resolve) => {
      clientA.emit('match:update-progress', { matchId: 'match_1', progress: hostProgress, clientCommandId: 'cmd_progress_host' }, resolve)
    })
    const broadcastToHost = new Promise<{
      reason: string
      match: {
        id: string
        status: string
        winnerPlayerId: string | null
        participants: Array<{
          id: string
          status: string
          scorePoints: number
          correctAnswers: number
          totalQuestions: number
          bestStreak: number
          forfeitedAt: string | null
        }>
      }
    }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string; winnerPlayerId: string | null } } }>((resolve) => {
      clientB.emit('match:forfeit', { matchId: 'match_1', progress: guestProgress }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'completed', winnerPlayerId: 'player_a' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_forfeited',
      match: {
        id: 'match_1',
        status: 'completed',
        winnerPlayerId: 'player_a',
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'participant_a', status: 'completed', scorePoints: 34, correctAnswers: 3, totalQuestions: 4, bestStreak: 2, forfeitedAt: null }),
          expect.objectContaining({ id: 'participant_b', status: 'completed', scorePoints: 18, correctAnswers: 2, totalQuestions: 4, bestStreak: 1, forfeitedAt: expect.any(String) }),
        ]),
      },
    })
    expect(matchServiceMocks.forfeitChallenge).toHaveBeenCalledWith('player_b', 'match_1', expect.objectContaining({
      player_a: expect.objectContaining(hostProgress),
      player_b: expect.objectContaining(guestProgress),
    }))
  })

  it('soumet un resultat par commande Socket.IO avec ACK et evenement de salon', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.completeChallengeResult.mockResolvedValueOnce(completedMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot(startedMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; status: string }; roomEvent?: { reason: string; revision: number } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })
    const result = {
      durationSeconds: 10,
      bestStreak: 1,
      answers: [
        {
          prompt: '1 + 1',
          correctAnswer: 2,
          userAnswer: 2,
          responseTimeMs: 500,
          skill: 'addition',
        },
      ],
    }

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientB.emit('match:submit-result', { matchId: 'match_1', result, clientCommandId: 'cmd_result_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'completed' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_completed',
      roomEvent: {
        reason: 'match_completed',
        revision: expect.any(Number),
      },
      match: {
        id: 'match_1',
        status: 'completed',
      },
    })
    expect(matchServiceMocks.completeChallengeResult).toHaveBeenCalledWith('player_b', 'match_1', result)
  })

  it('notifie une demande de relance par commande Socket.IO avec ACK et broadcast', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.requestChallengeRematch.mockResolvedValueOnce({
      ...completedMatchView(),
      participants: completedMatchView().participants.map((participant) =>
        participant.playerId === 'player_b'
          ? { ...participant, rematchRequestedAt: new Date('2026-07-09T10:04:00.000Z') }
          : participant,
      ),
    })
    const port = await listen(httpServer)
    emitMatchSnapshot(completedMatchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToHost = new Promise<{ reason: string; match: { id: string; participants: Array<{ id: string; rematchRequestedAt: string | null }> } }>((resolve) => {
      clientA.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string } } }>((resolve) => {
      clientB.emit('match:request-rematch', { matchId: 'match_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1' } } })
    await expect(broadcastToHost).resolves.toMatchObject({
      reason: 'match_rematch_requested',
      match: {
        id: 'match_1',
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'participant_b', rematchRequestedAt: expect.any(String) }),
        ]),
      },
    })
    expect(matchServiceMocks.requestChallengeRematch).toHaveBeenCalledWith('player_b', 'match_1')
  })

  it('ferme le salon par commande Socket.IO et diffuse match_left aux deux joueurs', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.leaveChallenge.mockResolvedValueOnce(cancelledMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot(matchView(), 'match_seeded')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const broadcastToGuest = new Promise<{ reason: string; match: { id: string; status: string } }>((resolve) => {
      clientB.once('match:changed', resolve)
    })

    const ack = await new Promise<{ ok: boolean; data?: { match: { id: string; status: string } } }>((resolve) => {
      clientA.emit('match:leave', { matchId: 'match_1', clientCommandId: 'cmd_leave_1' }, resolve)
    })

    expect(ack).toMatchObject({ ok: true, data: { match: { id: 'match_1', status: 'cancelled' } } })
    await expect(broadcastToGuest).resolves.toMatchObject({
      reason: 'match_left',
      match: { id: 'match_1', status: 'cancelled' },
    })
    expect(matchServiceMocks.leaveChallenge).toHaveBeenCalledWith('player_a', 'match_1')
  })

  it('enregistre une reponse tempo sans avancer avant que les deux joueurs aient repondu', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    const port = await listen(httpServer)
    emitMatchSnapshot(inProgressTempoMatchView(), 'match_started')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    }

    let progressEmitted = false
    clientA.once('match:tempo-progress', () => {
      progressEmitted = true
    })
    const answerRecorded = new Promise<{ reason: string; questionIndex: number; playerId: string; match: { participants: Array<{ scorePoints: number; totalQuestions: number }> } }>((resolve) => {
      clientA.once('match:tempo-answer-recorded', resolve)
    })
    const firstAck = await new Promise<{ ok: boolean; data?: { progress: { complete: boolean; answeredCount: number } } }>((resolve) => {
      clientA.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })
    const recordedPayload = await answerRecorded

    expect(firstAck).toMatchObject({ ok: true, data: { progress: { complete: false, answeredCount: 1 } } })
    expect(recordedPayload).toMatchObject({
      reason: 'match_tempo_answer_recorded',
      questionIndex: 0,
      playerId: 'player_a',
      match: {
        participants: expect.arrayContaining([
          expect.objectContaining({ scorePoints: expect.any(Number), totalQuestions: 1 }),
        ]),
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(progressEmitted).toBe(false)
    await expect.poll(() => matchServiceMocks.persistTempoQuestionAnswer.mock.calls.length).toBe(1)
  })

  it('fait avancer une question tempo des que les deux joueurs ont repondu', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    const port = await listen(httpServer)
    emitMatchSnapshot(inProgressTempoMatchView(), 'match_started')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    }

    const progressToHost = new Promise<{ reason: string; questionIndex: number; nextQuestionIndex: number }>((resolve) => {
      clientA.once('match:tempo-progress', resolve)
    })
    const firstAck = await new Promise<{ ok: boolean; data?: { progress: { complete: boolean; answeredCount: number } } }>((resolve) => {
      clientA.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })
    const secondAck = await new Promise<{ ok: boolean; data?: { progress: { complete: boolean; answeredCount: number } } }>((resolve) => {
      clientB.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })

    expect(firstAck).toMatchObject({ ok: true, data: { progress: { complete: false, answeredCount: 1 } } })
    expect(secondAck).toMatchObject({ ok: true, data: { progress: { complete: true, answeredCount: 2 } } })
    await expect(progressToHost).resolves.toMatchObject({
      reason: 'match_tempo_question_completed',
      questionIndex: 0,
      nextQuestionIndex: 1,
    })
    await expect.poll(() => matchServiceMocks.persistTempoQuestionAnswer.mock.calls.length).toBe(2)
  })

  it('ignore une reponse tempo dupliquee sans changer la reponse canonique', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => token === 'token_a' ? { clerkUserId: 'clerk_a', playerId: 'player_a' } : null,
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    const port = await listen(httpServer)
    emitMatchSnapshot(inProgressTempoMatchView(), 'match_started')
    const clientA = await connectClient(port, 'token_a')
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    }

    const firstAck = await new Promise<{ ok: boolean; data?: { progress: { complete: boolean; answeredCount: number } } }>((resolve) => {
      clientA.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })
    const duplicateAck = await new Promise<{ ok: boolean; data?: { progress: { complete: boolean; answeredCount: number } } }>((resolve) => {
      clientA.emit('match:submit-tempo-answer', {
        matchId: 'match_1',
        answer: { ...answer, userAnswer: question.answer + 1, responseTimeMs: 1200 },
      }, resolve)
    })

    expect(firstAck).toMatchObject({ ok: true, data: { progress: { complete: false, answeredCount: 1 } } })
    expect(duplicateAck).toMatchObject({ ok: true, data: { progress: { complete: false, answeredCount: 1 } } })
    await expect.poll(() => matchServiceMocks.persistTempoQuestionAnswer.mock.calls.length).toBe(1)
    expect(matchServiceMocks.persistTempoQuestionAnswer).toHaveBeenCalledWith('player_a', 'match_1', expect.objectContaining({
      userAnswer: question.answer,
      responseTimeMs: 800,
    }))
  })

  it('force une reponse tempo absente a null quand le serveur atteint le timeout', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => token === 'token_a' ? { clerkUserId: 'clerk_a', playerId: 'player_a' } : null,
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    const port = await listen(httpServer)
    emitMatchSnapshot({
      ...inProgressTempoMatchView(),
      questionCount: 2,
      perQuestionTimeLimitSeconds: 1,
      startedAt: new Date(Date.now() - 1000),
    }, 'match_started')
    const clientA = await connectClient(port, 'token_a')
    const progressToHost = new Promise<{ reason: string; questionIndex: number; nextQuestionIndex: number }>((resolve) => {
      clientA.once('match:tempo-progress', resolve)
    })

    await expect(progressToHost).resolves.toMatchObject({
      reason: 'match_tempo_question_timeout',
      questionIndex: 0,
      nextQuestionIndex: 1,
    })
    await expect.poll(() => matchServiceMocks.persistTempoQuestionAnswer.mock.calls.length).toBe(2)
    expect(matchServiceMocks.persistTempoQuestionAnswer).toHaveBeenCalledWith('player_a', 'match_1', expect.objectContaining({
      questionIndex: 0,
      userAnswer: null,
      source: 'timeout',
    }))
    expect(matchServiceMocks.persistTempoQuestionAnswer).toHaveBeenCalledWith('player_b', 'match_1', expect.objectContaining({
      questionIndex: 0,
      userAnswer: null,
      source: 'timeout',
    }))
  })

  it('finalise une manche tempo quand la derniere reponse manquante est forcee par timeout', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    matchServiceMocks.completeChallengeResult.mockResolvedValue(completedMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot({
      ...inProgressTempoMatchView(),
      questionCount: 1,
      perQuestionTimeLimitSeconds: 1,
    }, 'match_started')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const completedToGuest = new Promise<{ status: string; match: { status: string } }>((resolve) => {
      clientB.on('match:changed', (payload) => {
        if (payload.status === 'completed') {
          resolve(payload)
        }
      })
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    }

    await new Promise((resolve) => {
      clientA.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })

    await expect(completedToGuest).resolves.toMatchObject({
      status: 'completed',
      match: { status: 'completed' },
    })
    await expect.poll(() => matchServiceMocks.persistTempoQuestionAnswer.mock.calls.length).toBe(2)
    expect(matchServiceMocks.persistTempoQuestionAnswer).toHaveBeenCalledWith('player_b', 'match_1', expect.objectContaining({
      questionIndex: 0,
      userAnswer: null,
      source: 'timeout',
    }))
  })

  it('finalise une manche tempo cote serveur quand la derniere question est resolue', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => {
        if (token === 'token_a') {
          return { clerkUserId: 'clerk_a', playerId: 'player_a' }
        }

        if (token === 'token_b') {
          return { clerkUserId: 'clerk_b', playerId: 'player_b' }
        }

        return null
      },
    })
    matchServiceMocks.persistTempoQuestionAnswer.mockResolvedValue(undefined)
    matchServiceMocks.completeChallengeResult.mockResolvedValue(completedMatchView())
    const port = await listen(httpServer)
    emitMatchSnapshot({ ...inProgressTempoMatchView(), questionCount: 1 }, 'match_started')
    const [clientA, clientB] = await Promise.all([connectClient(port, 'token_a'), connectClient(port, 'token_b')])
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    }
    const completedToHost = new Promise<{ status: string; match: { status: string; winnerPlayerId: string | null } }>((resolve) => {
      clientA.on('match:changed', (payload) => {
        if (payload.status === 'completed') {
          resolve(payload)
        }
      })
    })

    await new Promise((resolve) => {
      clientA.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })
    await new Promise((resolve) => {
      clientB.emit('match:submit-tempo-answer', { matchId: 'match_1', answer }, resolve)
    })

    await expect(completedToHost).resolves.toMatchObject({
      status: 'completed',
      match: {
        status: 'completed',
        winnerPlayerId: null,
      },
    })
    await expect.poll(() => matchServiceMocks.completeChallengeResult.mock.calls.length).toBe(2)
  })

  it('ne rediffuse pas un snapshot tempo in_progress plus ancien apres une completion', async () => {
    httpServer = createServer()
    initRealtime(httpServer, {
      authenticateToken: async (token) => token === 'token_a' ? { clerkUserId: 'clerk_a', playerId: 'player_a' } : null,
    })
    const port = await listen(httpServer)
    emitMatchSnapshot(completedMatchView(), 'match_completed')
    const clientA = await connectClient(port, 'token_a')
    let staleSnapshotBroadcast = false

    clientA.on('match:changed', (payload) => {
      if (payload.reason === 'match_completed_persisted' && payload.status === 'in_progress') {
        staleSnapshotBroadcast = true
      }
    })

    emitMatchSnapshot(inProgressTempoMatchView(), 'match_completed_persisted')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(staleSnapshotBroadcast).toBe(false)
  })
})
