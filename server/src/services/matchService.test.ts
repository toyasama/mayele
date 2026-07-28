import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const playerA = {
  id: 'player_a',
  name: 'Awa',
  username: 'awa',
  avatarUrl: null,
  totalXp: 100,
  presenceStatus: 'online',
  presenceUpdatedAt: new Date('2026-07-07T10:00:00.000Z'),
}

const playerB = {
  id: 'player_b',
  name: 'Binta',
  username: 'binta',
  avatarUrl: null,
  totalXp: 200,
  presenceStatus: 'away',
  presenceUpdatedAt: new Date('2026-07-07T10:00:00.000Z'),
}

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match_1',
    roomId: 'room_1',
    type: 'challenge',
    challengeMode: 'sprint',
    status: 'pending',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: 'seed_1',
    configVersion: 3,
    createdById: 'player_a',
    winnerPlayerId: null,
    createdAt: new Date('2026-07-07T10:00:00.000Z'),
    expiresAt: new Date('2026-07-07T10:30:00.000Z'),
    hostActiveAt: new Date(),
    startedAt: null,
    finishedAt: null,
    createdBy: playerA,
    participants: [
      {
        id: 'participant_a',
        matchId: 'match_1',
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
        sessionId: null,
        joinedAt: new Date('2026-07-07T10:00:00.000Z'),
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        player: playerA,
      },
      {
        id: 'participant_b',
        matchId: 'match_1',
        playerId: 'player_b',
        status: 'invited',
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
        sessionId: null,
        joinedAt: null,
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        player: playerB,
      },
    ],
    ...overrides,
  }
}

function makeAcceptedMatch(overrides: Record<string, unknown> = {}) {
  const match = makeMatch({ status: 'accepted', ...overrides })

  return {
    ...match,
    participants: match.participants.map((participant) =>
      participant.playerId === 'player_b'
        ? { ...participant, status: 'accepted', joinedAt: new Date('2026-07-07T10:01:00.000Z') }
        : participant,
    ),
  }
}

const prismaMock = {
  friendship: {
    findUnique: vi.fn(),
  },
  player: {
    findUnique: vi.fn(),
  },
  match: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
  matchParticipant: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  matchQuestionAnswer: {
    count: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const saveSessionMock = vi.fn()

vi.mock('./sessionService.js', () => ({ saveSession: saveSessionMock }))

const { generateMatchQuestion } = await import('../domain/matchQuestions.js')
const {
  acceptChallenge,
  acceptChallengeProposal,
  challengeRunDurationSeconds,
  completeChallengeResult,
  createChallenge,
  declineChallenge,
  forfeitChallenge,
  getMatch,
  leaveChallenge,
  heartbeatChallengeHost,
  listMatches,
  MatchServiceError,
  proposeChallenge,
  requestChallengeRematch,
  startChallengeProposal,
  submitTempoQuestionAnswer,
  submitSprintQuestionAnswer,
  transferChallengeHost,
  updateChallengeConfig,
} = await import('./matchService.js')

describe('matchService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (input: Array<Promise<unknown>> | ((tx: typeof prismaMock) => Promise<unknown>)) =>
      Array.isArray(input) ? Promise.all(input) : input(prismaMock),
    )
    prismaMock.match.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.match.updateManyAndReturn.mockResolvedValue([])
    prismaMock.match.findMany.mockResolvedValue([])
    prismaMock.matchParticipant.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.matchQuestionAnswer.findMany.mockResolvedValue([])
    prismaMock.matchQuestionAnswer.upsert.mockResolvedValue({})
    saveSessionMock.mockResolvedValue({
      sessionId: 'session_1',
      scorePoints: 8,
      xpEarned: 12,
      missionXpEarned: 0,
      completedMissions: [],
      playerProgress: {},
      earnedAchievements: [],
    })
  })

  it('calcule la duree reelle des manches tempo depuis le nombre de questions', () => {
    expect(challengeRunDurationSeconds({
      challengeMode: 'tempo',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
    })).toBe(300)
    expect(challengeRunDurationSeconds({
      challengeMode: 'sprint',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
    })).toBe(60)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejette l'auto-defi", async () => {
    await expect(
      createChallenge('player_a', {
        opponentPlayerId: 'player_a',
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'sprint',
      }),
    ).rejects.toMatchObject({ code: 'self_challenge' })
  })

  it("rejette un defi si l'adversaire n'est pas un ami", async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce({ id: 'player_b' })
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null)

    await expect(
      createChallenge('player_a', {
        opponentPlayerId: 'player_b',
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'sprint',
      }),
    ).rejects.toMatchObject({ code: 'not_friends' })
  })

  it('cree un defi sprint entre deux amis', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce({ id: 'player_b' })
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'friendship_1' })
    prismaMock.match.create.mockResolvedValueOnce(makeMatch())

    const match = await createChallenge('player_a', {
      opponentPlayerId: 'player_b',
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      challengeMode: 'sprint',
      durationSeconds: 90,
    })

    expect(match.id).toBe('match_1')
    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'challenge',
          challengeMode: 'sprint',
          durationSeconds: 90,
          questionCount: null,
          participants: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ playerId: 'player_a', status: 'accepted' }),
              expect.objectContaining({ playerId: 'player_b', status: 'invited' }),
            ]),
          }),
        }),
      }),
    )
  })

  it('annule les anciens salons ouverts entre les deux joueurs avant un nouveau defi direct', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce({ id: 'player_b' })
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'friendship_1' })
    prismaMock.match.create.mockResolvedValueOnce(makeMatch())

    await createChallenge('player_a', {
      opponentPlayerId: 'player_b',
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      challengeMode: 'sprint',
    })

    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: {
        type: 'challenge',
        status: { in: ['pending', 'accepted', 'ready'] },
        participants: {
          some: { playerId: 'player_a' },
        },
        AND: [
          {
            participants: {
              some: { playerId: 'player_b' },
            },
          },
        ],
      },
      data: {
        status: 'cancelled',
        finishedAt: expect.any(Date),
      },
    })
  })

  it('cree un defi tempo avec limite par question', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce({ id: 'player_b' })
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'friendship_1' })
    prismaMock.match.create.mockResolvedValueOnce(makeMatch({ challengeMode: 'tempo', questionCount: 30, perQuestionTimeLimitSeconds: 15 }))

    await createChallenge('player_a', {
      opponentPlayerId: 'player_b',
      game: 'multiplication',
      level: 'intermediaire',
      practiceSkill: null,
      challengeMode: 'tempo',
      questionCount: 30,
      perQuestionTimeLimitSeconds: 15,
    })

    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          challengeMode: 'tempo',
          durationSeconds: 450,
          questionCount: 30,
          perQuestionTimeLimitSeconds: 15,
          questionSeed: expect.any(String),
        }),
      }),
    )
  })

  it('accepte une invitation pendante', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.match.findUniqueOrThrow.mockResolvedValueOnce(makeAcceptedMatch())

    const match = await acceptChallenge('player_b', 'match_1')

    expect(match.status).toBe('accepted')
    expect(prismaMock.matchParticipant.update).toHaveBeenCalledWith({
      where: { id: 'participant_b' },
      data: { status: 'accepted', joinedAt: expect.any(Date) },
    })
  })

  it('refuse une invitation pendante et annule le match', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.match.findUniqueOrThrow.mockResolvedValueOnce(makeMatch({ status: 'cancelled', finishedAt: new Date('2026-07-07T10:02:00.000Z') }))

    const match = await declineChallenge('player_b', 'match_1')

    expect(match.status).toBe('cancelled')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match_1', status: 'pending', expiresAt: { gt: expect.any(Date) } },
      data: { status: 'cancelled', finishedAt: expect.any(Date) },
    })
  })

  it("rejette l'acceptation par le createur deja accepte", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeMatch())

    await expect(acceptChallenge('player_a', 'match_1')).rejects.toBeInstanceOf(MatchServiceError)
  })

  it("accepte l'invitation meme si le heartbeat du maitre a ete ralenti", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeMatch({ hostActiveAt: new Date(Date.now() - 3 * 60 * 1000) }))
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.match.findUniqueOrThrow.mockResolvedValueOnce(makeAcceptedMatch())

    const match = await acceptChallenge('player_b', 'match_1')

    expect(match.status).toBe('accepted')
  })

  it('permet a un participant de quitter un salon actif', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeMatch({ status: 'accepted' }))
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.match.update.mockResolvedValueOnce(makeMatch({ status: 'cancelled', finishedAt: new Date(), expiresAt: new Date() }))

    const match = await leaveChallenge('player_a', 'match_1')

    expect(match.status).toBe('cancelled')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'declined', finishedAt: expect.any(Date), rematchRequestedAt: null },
    })
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: { status: 'cancelled', finishedAt: expect.any(Date), expiresAt: expect.any(Date) },
      include: expect.any(Object),
    })
  })

  it("ferme le salon pour les deux quand l'invite quitte apres etre entre", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.match.update.mockResolvedValueOnce(makeAcceptedMatch({ status: 'cancelled', finishedAt: new Date(), expiresAt: new Date() }))

    const match = await leaveChallenge('player_b', 'match_1')

    expect(match.status).toBe('cancelled')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'declined', finishedAt: expect.any(Date), rematchRequestedAt: null },
    })
  })

  it('ferme le salon pour les deux quand un joueur quitte pendant une manche', async () => {
    const inProgressMatch = makeAcceptedMatch({
      status: 'in_progress',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.match.update.mockResolvedValueOnce({ ...inProgressMatch, status: 'cancelled', finishedAt: new Date(), expiresAt: new Date() })

    const match = await leaveChallenge('player_a', 'match_1')

    expect(match.status).toBe('cancelled')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'disconnected', finishedAt: expect.any(Date), rematchRequestedAt: null },
    })
  })

  it("ferme le salon pour les deux quand le maitre quitte un salon avec un invite present", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.match.update.mockResolvedValueOnce(makeAcceptedMatch({ status: 'cancelled', finishedAt: new Date(), expiresAt: new Date() }))

    const match = await leaveChallenge('player_a', 'match_1')

    expect(match.status).toBe('cancelled')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'declined', finishedAt: expect.any(Date), rematchRequestedAt: null },
    })
  })

  it('change le maitre du salon sans faire quitter les joueurs', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'ready' }))
    prismaMock.match.update.mockResolvedValueOnce({})
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ createdById: 'player_b', createdBy: playerB }))

    const match = await transferChallengeHost('player_a', 'match_1')

    expect(match.createdBy.id).toBe('player_b')
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: {
        createdById: 'player_b',
        status: 'accepted',
        hostActiveAt: expect.any(Date),
        expiresAt: expect.any(Date),
        configVersion: { increment: 1 },
      },
    })
  })

  it('propose la configuration sans lancer le defi', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'ready' }))

    const match = await proposeChallenge('player_a', 'match_1')

    expect(match.status).toBe('ready')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match_1', status: 'accepted', configVersion: 3 },
      data: { status: 'ready', expiresAt: expect.any(Date) },
    })
  })

  it("ne remet pas un defi en ready si l'acceptation realtime l'a deja lance", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'in_progress' }))

    const match = await proposeChallenge('player_a', 'match_1')

    expect(match.status).toBe('in_progress')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match_1', status: 'accepted', configVersion: 3 },
      data: { status: 'ready', expiresAt: expect.any(Date) },
    })
  })

  it('propose la configuration realtime exacte sans regenerer le seed', async () => {
    const realtimeConfig = {
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      challengeMode: 'tempo',
      durationSeconds: 100,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 10,
      questionSeed: 'seed_realtime',
      configVersion: 8,
    }
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({
      status: 'ready',
      ...realtimeConfig,
    }))

    const match = await proposeChallenge('player_a', 'match_1', realtimeConfig)

    expect(match.status).toBe('ready')
    expect(match.questionSeed).toBe('seed_realtime')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match_1', status: 'accepted', configVersion: 3 },
      data: {
        ...realtimeConfig,
        status: 'ready',
        expiresAt: expect.any(Date),
      },
    })
  })

  it('rejette une configuration du maitre si la version attendue est obsolete', async () => {
    prismaMock.match.update.mockRejectedValueOnce(new Error('not_found'))
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ configVersion: 4, expiresAt: new Date(Date.now() + 60_000) }))

    await expect(
      updateChallengeConfig('player_a', 'match_1', {
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'sprint',
        durationSeconds: 60,
        expectedConfigVersion: 3,
      }),
    ).rejects.toMatchObject({ code: 'match_version_conflict' })
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        configVersion: 3,
        id: 'match_1',
      }),
    }))
  })

  it("lance le defi quand l'invite accepte la proposition", async () => {
    const now = new Date('2026-07-08T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'ready' }))
    prismaMock.match.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({})
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'in_progress' }))

    const match = await acceptChallengeProposal('player_b', 'match_1')

    expect(match.status).toBe('in_progress')
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: {
        status: 'in_progress',
        startedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 1000 + 2 * 60 * 1000),
      },
    })
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'playing' },
    })
  })

  it("expire une manche tempo apres sa duree par question, pas apres durationSeconds", async () => {
    const now = new Date('2026-07-08T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({
      status: 'ready',
      challengeMode: 'tempo',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
    }))
    prismaMock.match.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({})
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({
      status: 'in_progress',
      challengeMode: 'tempo',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
    }))

    const match = await acceptChallengeProposal('player_b', 'match_1')

    expect(match.status).toBe('in_progress')
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: {
        status: 'in_progress',
        startedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 10 * 1000 + 2 * 60 * 1000),
      },
    })
  })

  it('lance la proposition realtime en une transaction avec la config exacte', async () => {
    const now = new Date('2026-07-08T12:00:00.000Z')
    const startedAt = new Date('2026-07-08T11:59:57.000Z')
    const realtimeConfig = {
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      challengeMode: 'tempo',
      durationSeconds: 60,
      questionCount: 30,
      perQuestionTimeLimitSeconds: 10,
      questionSeed: 'seed_realtime',
      configVersion: 9,
    }
    vi.useFakeTimers()
    vi.setSystemTime(now)
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'ready' }))
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({})
    prismaMock.match.findUnique.mockResolvedValueOnce(makeAcceptedMatch({
      status: 'in_progress',
      ...realtimeConfig,
      startedAt: now,
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    }))

    const match = await startChallengeProposal('player_b', 'match_1', realtimeConfig, startedAt)

    expect(match.status).toBe('in_progress')
    expect(match.questionSeed).toBe('seed_realtime')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'match_1',
        status: { in: ['accepted', 'ready'] },
      },
      data: {
        ...realtimeConfig,
        status: 'in_progress',
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 30 * 10 * 1000 + 2 * 60 * 1000),
      },
    })
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'playing' },
    })
  })

  it("lance le defi depuis un salon accepted quand l'acceptation realtime porte deja la config finale", async () => {
    const now = new Date('2026-07-08T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'accepted' }))
    prismaMock.match.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({})
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch({ status: 'in_progress' }))

    const match = await acceptChallengeProposal('player_b', 'match_1')

    expect(match.status).toBe('in_progress')
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: {
        status: 'in_progress',
        startedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 1000 + 2 * 60 * 1000),
      },
    })
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { status: 'playing' },
    })
  })

  it("ne mute jamais les participants quand le heartbeat hote est ralenti", async () => {
    prismaMock.match.findMany.mockResolvedValueOnce([])

    await listMatches('player_a')

    expect(prismaMock.match.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.match.findMany).toHaveBeenCalledWith({
      where: {
        participants: {
          some: { playerId: 'player_a' },
        },
        OR: [
          {
            status: { in: ['pending', 'accepted', 'ready', 'in_progress'] },
            expiresAt: { gt: expect.any(Date) },
          },
          {
            status: 'completed',
            expiresAt: { gt: expect.any(Date) },
            participants: { some: { playerId: 'player_a', resultDismissedAt: null } },
          },
        ],
      },
      include: expect.any(Object),
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    expect(prismaMock.match.update).not.toHaveBeenCalled()
    expect(prismaMock.match.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("enrichit plusieurs salons avec une seule requête d'historique", async () => {
    const firstMatch = makeMatch()
    const secondMatch = makeMatch({ id: 'match_2', roomId: 'room_2' })
    prismaMock.match.findMany
      .mockResolvedValueOnce([firstMatch, secondMatch])
      .mockResolvedValueOnce([
        {
          roomId: 'room_1',
          winnerPlayerId: 'player_a',
          participants: [{ playerId: 'player_a' }, { playerId: 'player_b' }],
        },
      ])

    const matches = await listMatches('player_a')

    expect(prismaMock.match.findMany).toHaveBeenCalledTimes(2)
    expect(matches[0].participants.find((participant) => participant.player.id === 'player_a')?.challengeStats.room).toEqual({
      wins: 1,
      losses: 0,
      draws: 0,
    })
    expect(matches[1].participants.find((participant) => participant.player.id === 'player_a')?.challengeStats.friendship).toEqual({
      wins: 1,
      losses: 0,
      draws: 0,
    })
  })

  it('retourne une erreur metier si le salon disparait pendant le heartbeat', async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(makeAcceptedMatch())
    prismaMock.match.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(heartbeatChallengeHost('player_a', 'match_1')).rejects.toMatchObject({ code: 'match_not_found' })
  })

  it("enregistre le resultat individuel sans terminer le match tant que l'adversaire joue", async () => {
    const startedAt = new Date(Date.now() - 5_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'playing',
        scorePoints: participant.playerId === 'player_a' ? 12 : 3,
      })),
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce([
      { playerId: 'player_a', status: 'completed', scorePoints: 8, correctAnswers: 1, totalResponseTimeMs: 800, finishedAt: new Date() },
      { playerId: 'player_b', status: 'playing', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 0, finishedAt: null },
    ]).mockResolvedValueOnce([
      { playerId: 'player_a', status: 'completed', scorePoints: 8, correctAnswers: 1, totalResponseTimeMs: 800, finishedAt: new Date() },
      { playerId: 'player_b', status: 'playing', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 0, finishedAt: null },
    ])
    prismaMock.match.findFirst.mockResolvedValueOnce({
      ...inProgressMatch,
      participants: inProgressMatch.participants.map((participant) =>
        participant.playerId === 'player_a'
          ? { ...participant, status: 'completed', score: 100, scorePoints: 8, xp: 12, correctAnswers: 1, totalQuestions: 1, totalResponseTimeMs: 800, bestStreak: 1, sessionId: 'session_1', finishedAt: new Date() }
          : participant,
      ),
    })

    const match = await completeChallengeResult(
      'player_a',
      'match_1',
      {
        durationSeconds: 5,
        bestStreak: 1,
        answers: [{ prompt: question.prompt, correctAnswer: question.answer, userAnswer: question.answer, responseTimeMs: 800, skill: question.skill }],
      },
      'Europe/Paris',
    )

    expect(match.status).toBe('in_progress')
    expect(saveSessionMock).toHaveBeenCalledWith(
      'player_a',
      expect.objectContaining({
        totalQuestions: 1,
        bestStreak: 1,
      }),
      'Europe/Paris',
      { submissionKey: 'match:match_1:participant:participant_a' },
    )
    expect(prismaMock.matchParticipant.update).toHaveBeenCalledWith({
      where: { id: 'participant_a' },
      data: expect.objectContaining({
        status: 'completed',
        score: 100,
        scorePoints: 8,
        xp: 12,
        correctAnswers: 1,
        totalQuestions: 1,
        totalResponseTimeMs: 800,
        bestStreak: 1,
        sessionId: 'session_1',
      }),
    })
  })

  it('finalise le match quand le dernier resultat concurrent a deja termine les participants', async () => {
    const startedAt = new Date(Date.now() - 5_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const completedParticipants = [
      { playerId: 'player_a', status: 'completed', scorePoints: 7, correctAnswers: 1, totalResponseTimeMs: 800, finishedAt: new Date(Date.now() - 1000) },
      { playerId: 'player_b', status: 'completed', scorePoints: 8, correctAnswers: 1, totalResponseTimeMs: 500, finishedAt: new Date() },
    ]
    const completedMatch = {
      ...inProgressMatch,
      status: 'completed',
      winnerPlayerId: 'player_b',
      finishedAt: new Date(),
      participants: inProgressMatch.participants.map((participant) => ({
        ...participant,
        status: 'completed',
        score: participant.playerId === 'player_b' ? 100 : 0,
        scorePoints: participant.playerId === 'player_b' ? 8 : 7,
        xp: participant.playerId === 'player_b' ? 12 : 5,
        correctAnswers: participant.playerId === 'player_b' ? 1 : 0,
        totalQuestions: 1,
        totalResponseTimeMs: participant.playerId === 'player_b' ? 500 : 800,
        bestStreak: participant.playerId === 'player_b' ? 1 : 0,
        sessionId: participant.playerId === 'player_b' ? 'session_1' : 'session_a',
        finishedAt: new Date(),
      })),
    }
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany
      .mockResolvedValueOnce([
        { playerId: 'player_a', status: 'completed', scorePoints: 7, correctAnswers: 1, totalResponseTimeMs: 800, finishedAt: new Date(Date.now() - 1000) },
        { playerId: 'player_b', status: 'submitting', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 0, finishedAt: null },
      ])
      .mockResolvedValueOnce(completedParticipants)
    prismaMock.match.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    prismaMock.match.findUnique.mockResolvedValueOnce(completedMatch)

    const match = await completeChallengeResult(
      'player_b',
      'match_1',
      {
        durationSeconds: 5,
        bestStreak: 1,
        answers: [{ prompt: question.prompt, correctAnswer: question.answer, userAnswer: question.answer, responseTimeMs: 500, skill: question.skill }],
      },
      'Europe/Paris',
    )

    expect(match.status).toBe('completed')
    expect(match.winnerPlayerId).toBe('player_b')
    expect(prismaMock.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match_1', status: 'in_progress' },
      data: expect.objectContaining({
        status: 'completed',
        winnerPlayerId: 'player_b',
        finishedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
    })
    expect(prismaMock.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      include: expect.any(Object),
    })
  })

  it('termine le match et designe le gagnant quand tous les resultats sont presents', async () => {
    const startedAt = new Date(Date.now() - 5_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const completedMatch = {
      ...inProgressMatch,
      status: 'completed',
      winnerPlayerId: 'player_b',
      finishedAt: new Date(),
      participants: inProgressMatch.participants.map((participant) =>
        participant.playerId === 'player_b'
          ? { ...participant, status: 'completed', score: 100, scorePoints: 8, xp: 12, correctAnswers: 1, totalQuestions: 1, totalResponseTimeMs: 500, bestStreak: 1, sessionId: 'session_1', finishedAt: new Date() }
          : { ...participant, status: 'completed', score: 0, scorePoints: 0, xp: 5, correctAnswers: 0, totalQuestions: 1, totalResponseTimeMs: 900, bestStreak: 0, sessionId: 'session_a', finishedAt: new Date() },
      ),
    }

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce([
      { playerId: 'player_a', status: 'completed', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 900, finishedAt: new Date(Date.now() - 1000) },
      { playerId: 'player_b', status: 'completed', scorePoints: 8, correctAnswers: 1, totalResponseTimeMs: 500, finishedAt: new Date() },
    ])
    prismaMock.match.update.mockResolvedValueOnce(completedMatch)

    const match = await completeChallengeResult(
      'player_b',
      'match_1',
      {
        durationSeconds: 5,
        bestStreak: 1,
        answers: [{ prompt: question.prompt, correctAnswer: question.answer, userAnswer: question.answer, responseTimeMs: 500, skill: question.skill }],
      },
      'Europe/Paris',
    )

    expect(match.status).toBe('completed')
    expect(match.winnerPlayerId).toBe('player_b')
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: expect.objectContaining({
        status: 'completed',
        winnerPlayerId: 'player_b',
        finishedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
      include: expect.any(Object),
    })
  })

  it('termine le match en nul quand les points sont egaux meme avec plus de bonnes reponses', async () => {
    const startedAt = new Date(Date.now() - 5_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')
    const completedMatch = {
      ...inProgressMatch,
      status: 'completed',
      winnerPlayerId: null,
      finishedAt: new Date(),
      participants: inProgressMatch.participants.map((participant) =>
        participant.playerId === 'player_b'
          ? { ...participant, status: 'completed', score: 90, scorePoints: 54, xp: 12, correctAnswers: 9, totalQuestions: 10, totalResponseTimeMs: 500, bestStreak: 6, sessionId: 'session_1', finishedAt: new Date() }
          : { ...participant, status: 'completed', score: 80, scorePoints: 54, xp: 5, correctAnswers: 8, totalQuestions: 10, totalResponseTimeMs: 900, bestStreak: 4, sessionId: 'session_a', finishedAt: new Date() },
      ),
    }

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce([
      { playerId: 'player_a', status: 'completed', scorePoints: 54, correctAnswers: 8, totalResponseTimeMs: 900, finishedAt: new Date(Date.now() - 1000) },
      { playerId: 'player_b', status: 'completed', scorePoints: 54, correctAnswers: 9, totalResponseTimeMs: 500, finishedAt: new Date() },
    ])
    prismaMock.match.update.mockResolvedValueOnce(completedMatch)

    const match = await completeChallengeResult(
      'player_b',
      'match_1',
      {
        durationSeconds: 5,
        bestStreak: 1,
        answers: [{ prompt: question.prompt, correctAnswer: question.answer, userAnswer: question.answer, responseTimeMs: 500, skill: question.skill }],
      },
      'Europe/Paris',
    )

    expect(match.status).toBe('completed')
    expect(match.winnerPlayerId).toBeNull()
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: expect.objectContaining({
        status: 'completed',
        winnerPlayerId: null,
        finishedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
      include: expect.any(Object),
    })
  })

  it('renvoie le match complete quand un resultat concurrent arrive apres la finalisation', async () => {
    const completedMatch = makeAcceptedMatch({
      status: 'completed',
      startedAt: new Date(Date.now() - 5_000),
      finishedAt: new Date(),
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        score: 100,
        scorePoints: 8,
        xp: 12,
        correctAnswers: 1,
        totalQuestions: 1,
        totalResponseTimeMs: 500,
        bestStreak: 1,
        sessionId: 'session_1',
        finishedAt: new Date(),
      })),
    })

    prismaMock.match.findFirst.mockResolvedValueOnce(completedMatch)
    prismaMock.match.findFirst.mockResolvedValueOnce(completedMatch)

    const match = await completeChallengeResult('player_b', 'match_1', {
      durationSeconds: 5,
      bestStreak: 1,
      answers: [],
    })

    expect(match.status).toBe('completed')
    expect(saveSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.matchParticipant.updateMany).not.toHaveBeenCalled()
  })

  it('accepte un resultat sprint sans reponse quand le chrono arrive a zero', async () => {
    const startedAt = new Date(Date.now() - 60_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const completedMatch = {
      ...inProgressMatch,
      status: 'completed',
      winnerPlayerId: null,
      finishedAt: new Date(),
      participants: inProgressMatch.participants.map((participant) =>
        participant.playerId === 'player_a'
          ? { ...participant, status: 'completed', score: 0, scorePoints: 0, xp: 0, correctAnswers: 0, totalQuestions: 0, totalResponseTimeMs: 0, bestStreak: 0, sessionId: null, finishedAt: new Date() }
          : { ...participant, status: 'disconnected', finishedAt: new Date() },
      ),
    }

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce([
      { playerId: 'player_a', status: 'completed', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 0, finishedAt: new Date() },
      { playerId: 'player_b', status: 'disconnected', scorePoints: 0, correctAnswers: 0, totalResponseTimeMs: 0, finishedAt: new Date() },
    ])
    prismaMock.match.update.mockResolvedValueOnce(completedMatch)

    const match = await completeChallengeResult(
      'player_a',
      'match_1',
      {
        durationSeconds: 60,
        bestStreak: 0,
        answers: [],
      },
      'Europe/Paris',
    )

    expect(match.status).toBe('completed')
    expect(saveSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.matchParticipant.update).toHaveBeenCalledWith({
      where: { id: 'participant_a' },
      data: expect.objectContaining({
        status: 'completed',
        score: 0,
        scorePoints: 0,
        xp: 0,
        correctAnswers: 0,
        totalQuestions: 0,
        totalResponseTimeMs: 0,
        bestStreak: 0,
        sessionId: null,
      }),
    })
  })

  it('termine le match en defaite pour le joueur qui stoppe la partie', async () => {
    const startedAt = new Date(Date.now() - 20_000)
    const progressByPlayerId = {
      player_a: {
        score: 80,
        scorePoints: 42,
        correctAnswers: 4,
        totalQuestions: 5,
        totalResponseTimeMs: 3200,
        bestStreak: 3,
      },
      player_b: {
        score: 100,
        scorePoints: 50,
        correctAnswers: 5,
        totalQuestions: 5,
        totalResponseTimeMs: 2600,
        bestStreak: 5,
      },
    }
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const completedMatch = {
      ...inProgressMatch,
      status: 'completed',
      winnerPlayerId: 'player_b',
      finishedAt: new Date(),
      participants: inProgressMatch.participants.map((participant) =>
        participant.playerId === 'player_a'
          ? { ...participant, status: 'completed', ...progressByPlayerId.player_a, xp: 0, sessionId: null, finishedAt: new Date(), forfeitedAt: new Date() }
          : { ...participant, status: 'completed', ...progressByPlayerId.player_b, xp: 0, sessionId: null, finishedAt: new Date() },
      ),
    }

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchParticipant.update.mockResolvedValue({})
    prismaMock.match.update.mockResolvedValueOnce(completedMatch)

    const match = await forfeitChallenge('player_a', 'match_1', progressByPlayerId)

    expect(match.status).toBe('completed')
    expect(match.winnerPlayerId).toBe('player_b')
    expect(match.participants.find((participant) => participant.playerId === 'player_a')?.forfeitedAt).toBeInstanceOf(Date)
    expect(saveSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.matchParticipant.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'participant_a' },
      data: expect.objectContaining({
        status: 'completed',
        score: 80,
        scorePoints: 42,
        xp: 0,
        correctAnswers: 4,
        totalQuestions: 5,
        bestStreak: 3,
        sessionId: null,
        forfeitedAt: expect.any(Date),
      }),
    })
    expect(prismaMock.matchParticipant.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'participant_b' },
      data: expect.objectContaining({
        status: 'completed',
        score: 100,
        scorePoints: 50,
        xp: 0,
        correctAnswers: 5,
        totalQuestions: 5,
        bestStreak: 5,
      }),
    })
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: expect.objectContaining({
        status: 'completed',
        winnerPlayerId: 'player_b',
        finishedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
      include: expect.any(Object),
    })
  })

  it("memorise la demande de relance sans recreer de match tant que l'adversaire n'a pas confirme", async () => {
    const completed = makeAcceptedMatch({
      status: 'completed',
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        finishedAt: new Date(),
        rematchRequestedAt: null,
      })),
    })
    const participantAReady = completed.participants.map((participant) =>
      participant.playerId === 'player_a'
        ? { ...participant, rematchRequestedAt: new Date() }
        : participant,
    )

    prismaMock.match.findFirst.mockResolvedValueOnce(completed)
    prismaMock.matchParticipant.update.mockResolvedValueOnce({})
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce(participantAReady)
    prismaMock.match.findFirst.mockResolvedValueOnce({ ...completed, participants: participantAReady })

    const match = await requestChallengeRematch('player_a', 'match_1')

    expect(match.status).toBe('completed')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { id: 'participant_a' },
      data: { rematchRequestedAt: expect.any(Date) },
    })
    expect(prismaMock.match.create).not.toHaveBeenCalled()
  })

  it("refuse la relance quand l'adversaire a deja quitte les resultats", async () => {
    const completed = makeAcceptedMatch({
      status: 'completed',
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        finishedAt: new Date(),
        rematchRequestedAt: null,
        resultDismissedAt: participant.playerId === 'player_b' ? new Date() : null,
      })),
    })

    prismaMock.match.findFirst.mockResolvedValueOnce(completed)

    await expect(requestChallengeRematch('player_a', 'match_1')).rejects.toMatchObject({ code: 'match_rematch_unavailable' })
    expect(prismaMock.matchParticipant.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.match.create).not.toHaveBeenCalled()
  })

  it('refuse la relance quand la vue de resultats du salon a expire', async () => {
    const completed = makeAcceptedMatch({
      status: 'completed',
      finishedAt: new Date(Date.now() - 3 * 60_000),
      expiresAt: new Date(Date.now() - 1_000),
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        finishedAt: new Date(Date.now() - 3 * 60_000),
        rematchRequestedAt: null,
      })),
    })

    prismaMock.match.findFirst.mockResolvedValueOnce(completed)

    await expect(requestChallengeRematch('player_a', 'match_1')).rejects.toMatchObject({ code: 'match_rematch_unavailable' })
    expect(prismaMock.matchParticipant.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.match.create).not.toHaveBeenCalled()
  })

  it('cree une nouvelle partie avec la meme configuration quand les deux joueurs relancent', async () => {
    const completed = makeAcceptedMatch({
      status: 'completed',
      winnerPlayerId: 'player_a',
      challengeMode: 'sprint',
      durationSeconds: 90,
      game: 'multiplication',
      level: 'intermediaire',
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        finishedAt: new Date(),
        rematchRequestedAt: participant.playerId === 'player_a' ? new Date(Date.now() - 1000) : null,
      })),
    })
    const bothReady = completed.participants.map((participant) => ({
      ...participant,
      rematchRequestedAt: participant.rematchRequestedAt ?? new Date(),
    }))
    const rematch = makeAcceptedMatch({
      id: 'match_2',
      roomId: 'room_1',
      status: 'accepted',
      challengeMode: 'sprint',
      durationSeconds: 90,
      game: 'multiplication',
      level: 'intermediaire',
      participants: bothReady.map((participant) => ({
        ...participant,
        matchId: 'match_2',
        status: 'accepted',
        score: null,
        xp: null,
        correctAnswers: 0,
        totalQuestions: 0,
        totalResponseTimeMs: 0,
        bestStreak: 0,
        sessionId: null,
        finishedAt: null,
        rematchRequestedAt: null,
      })),
    })

    prismaMock.match.findFirst.mockResolvedValueOnce(completed)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.matchParticipant.findMany.mockResolvedValueOnce(bothReady)
    prismaMock.match.create.mockResolvedValueOnce(rematch)
    prismaMock.match.findMany
      .mockResolvedValueOnce([
        {
          winnerPlayerId: 'player_a',
          participants: [{ playerId: 'player_a' }, { playerId: 'player_b' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          winnerPlayerId: 'player_a',
          participants: [{ playerId: 'player_a' }, { playerId: 'player_b' }],
        },
      ])

    const match = await requestChallengeRematch('player_b', 'match_1')

    expect(match.id).toBe('match_2')
    expect(match.status).toBe('accepted')
    expect(match.participants.find((participant) => participant.player.id === 'player_a')?.challengeStats.room).toEqual({
      wins: 1,
      losses: 0,
      draws: 0,
    })
    expect(match.participants.find((participant) => participant.player.id === 'player_b')?.challengeStats.room).toEqual({
      wins: 0,
      losses: 1,
      draws: 0,
    })
    expect(prismaMock.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'room_1',
          status: 'accepted',
          challengeMode: 'sprint',
          durationSeconds: 90,
          game: 'multiplication',
          level: 'intermediaire',
          createdById: 'player_a',
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({ playerId: 'player_a', status: 'accepted' }),
              expect.objectContaining({ playerId: 'player_b', status: 'accepted' }),
            ]),
          },
        }),
      }),
    )
  })

  it('quitter un resultat termine ferme la session de salon pour les deux joueurs', async () => {
    const completed = makeAcceptedMatch({
      status: 'completed',
      finishedAt: new Date(),
      participants: makeAcceptedMatch().participants.map((participant) => ({
        ...participant,
        status: 'completed',
        finishedAt: new Date(),
        rematchRequestedAt: participant.playerId === 'player_b' ? new Date() : null,
        resultDismissedAt: null,
      })),
    })
    const dismissed = {
      ...completed,
      participants: completed.participants.map((participant) =>
        ({ ...participant, resultDismissedAt: new Date(), rematchRequestedAt: null }),
      ),
    }

    prismaMock.match.findFirst.mockResolvedValueOnce(completed)
    prismaMock.matchParticipant.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.match.update.mockResolvedValueOnce({ ...completed, expiresAt: new Date() })
    prismaMock.match.findUniqueOrThrow.mockResolvedValueOnce(dismissed)

    const match = await leaveChallenge('player_a', 'match_1')

    expect(match.status).toBe('completed')
    expect(prismaMock.matchParticipant.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match_1' },
      data: { resultDismissedAt: expect.any(Date), rematchRequestedAt: null },
    })
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'match_1' },
      data: { expiresAt: expect.any(Date) },
    })
  })

  it("ne retourne pas un resultat termine deja quitte par le joueur", async () => {
    prismaMock.match.findFirst.mockResolvedValueOnce(null)

    await expect(getMatch('player_a', 'match_1')).rejects.toMatchObject({ code: 'match_not_found' })
    expect(prismaMock.match.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'match_1',
        participants: {
          some: { playerId: 'player_a' },
        },
        OR: [
          {
            status: { in: ['pending', 'accepted', 'ready', 'in_progress'] },
            expiresAt: { gt: expect.any(Date) },
          },
          {
            status: 'completed',
            expiresAt: { gt: expect.any(Date) },
            participants: { some: { playerId: 'player_a', resultDismissedAt: null } },
          },
        ],
      },
      include: expect.any(Object),
    })
  })

  it('rejette un resultat tempo dont une reponse depasse la fenetre autorisee', async () => {
    const startedAt = new Date(Date.now() - 15_000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      challengeMode: 'tempo',
      durationSeconds: 10,
      questionCount: 1,
      perQuestionTimeLimitSeconds: 10,
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)

    await expect(
      completeChallengeResult('player_a', 'match_1', {
        durationSeconds: 15,
        bestStreak: 0,
        answers: [{ prompt: question.prompt, correctAnswer: question.answer, userAnswer: question.answer, responseTimeMs: 12_000, skill: question.skill }],
      }),
    ).rejects.toMatchObject({ code: 'match_result_invalid' })
    expect(saveSessionMock).not.toHaveBeenCalled()
  })

  it('enregistre une reponse tempo et signale la question complete quand les deux joueurs ont repondu', async () => {
    const startedAt = new Date(Date.now() - 1000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      challengeMode: 'tempo',
      durationSeconds: 100,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 10,
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch)
    prismaMock.matchQuestionAnswer.upsert.mockResolvedValueOnce({})
    prismaMock.matchQuestionAnswer.count.mockResolvedValueOnce(2)

    const result = await submitTempoQuestionAnswer('player_a', 'match_1', {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    })

    expect(result.progress).toEqual({
      questionIndex: 0,
      answeredCount: 2,
      expectedAnswerCount: 2,
      complete: true,
      nextQuestionIndex: 1,
    })
    expect(prismaMock.matchQuestionAnswer.upsert).toHaveBeenCalledWith({
      where: {
        matchId_playerId_questionIndex: {
          matchId: 'match_1',
          playerId: 'player_a',
          questionIndex: 0,
        },
      },
      update: {},
      create: expect.objectContaining({
        matchId: 'match_1',
        playerId: 'player_a',
        questionIndex: 0,
        responseTimeMs: 800,
      }),
    })
  })

  it('valide et persiste chaque reponse sprint avant de mettre a jour la progression canonique', async () => {
    const startedAt = new Date(Date.now() - 1000)
    const inProgressMatch = makeMatch({
      status: 'in_progress',
      challengeMode: 'sprint',
      startedAt,
      questionSeed: 'seed_1',
      participants: makeAcceptedMatch().participants.map((participant) => ({ ...participant, status: 'playing' })),
    })
    const updatedMatch = {
      ...inProgressMatch,
      participants: inProgressMatch.participants.map((participant) => participant.playerId === 'player_a'
        ? { ...participant, score: 100, scorePoints: 8, correctAnswers: 1, totalQuestions: 1, totalResponseTimeMs: 800, bestStreak: 1 }
        : participant),
    }
    const question = generateMatchQuestion('seed_1', 0, 'addition', 'debutant')

    prismaMock.match.findFirst.mockResolvedValueOnce(inProgressMatch).mockResolvedValueOnce(updatedMatch)
    prismaMock.matchQuestionAnswer.findMany.mockResolvedValueOnce([{
      questionIndex: 0,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
    }])

    const result = await submitSprintQuestionAnswer('player_a', 'match_1', {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 800,
      skill: question.skill,
      source: 'manual',
    })

    expect(result.participants.find((participant) => participant.playerId === 'player_a')).toMatchObject({
      score: 100,
      scorePoints: 8,
      correctAnswers: 1,
      totalQuestions: 1,
      bestStreak: 1,
    })
    expect(prismaMock.matchQuestionAnswer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { matchId_playerId_questionIndex: { matchId: 'match_1', playerId: 'player_a', questionIndex: 0 } },
      update: {},
    }))
    expect(prismaMock.matchParticipant.update).toHaveBeenCalledWith({
      where: { id: 'participant_a' },
      data: expect.objectContaining({ correctAnswers: 1, totalQuestions: 1, bestStreak: 1 }),
    })
  })
})
