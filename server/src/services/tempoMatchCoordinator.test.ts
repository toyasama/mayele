import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import { serializeMatch } from './matchPresenter.js'
import { toMatchView } from './matchServiceView.js'

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  match: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  matchQuestionAnswer: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  matchParticipant: { update: vi.fn() },
}))
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const {
  processExpiredTempoQuestions,
  submitAtomicTempoAnswer,
  submitPersistedTempoAnswer,
} = await import('./tempoMatchCoordinator.js')

const players = [
  { id: 'player-a', name: 'Ada', username: 'ada', avatarUrl: null, totalXp: 0, presenceStatus: 'online', presenceUpdatedAt: new Date() },
  { id: 'player-b', name: 'Grace', username: 'grace', avatarUrl: null, totalXp: 0, presenceStatus: 'online', presenceUpdatedAt: new Date() },
]

function tempoMatch(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(Date.now() - 1_000)
  return {
    id: 'match-1',
    roomId: 'room-1',
    type: 'challenge',
    challengeMode: 'tempo',
    status: 'in_progress',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: 2,
    perQuestionTimeLimitSeconds: 10,
    questionSeed: 'seed-1',
    configVersion: 1,
    createdById: 'player-a',
    winnerPlayerId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    hostActiveAt: new Date(),
    startedAt,
    tempoQuestionIndex: 0,
    tempoQuestionStartedAt: startedAt,
    tempoQuestionDeadlineAt: new Date(Date.now() + 9_000),
    finishedAt: null,
    createdBy: players[0],
    participants: players.map((player, index) => ({
      id: `participant-${index}`,
      matchId: 'match-1',
      playerId: player.id,
      status: 'playing',
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
      joinedAt: new Date(),
      finishedAt: null,
      forfeitedAt: null,
      rematchRequestedAt: null,
      resultDismissedAt: null,
      player,
    })),
    ...overrides,
  }
}

describe('tempoMatchCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
    tx.$queryRaw.mockResolvedValue([{ id: 'match-1' }])
    tx.matchQuestionAnswer.create.mockResolvedValue({ id: 'answer-1' })
    tx.matchParticipant.update.mockResolvedValue({ id: 'participant-0' })
    tx.match.update.mockResolvedValue({ id: 'match-1' })
    prismaMock.$queryRaw.mockReset()
  })

  it('enregistre, compte et avance atomiquement via le compteur PostgreSQL', async () => {
    const match = tempoMatch()
    const question = generateMatchQuestion('seed-1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 500,
      skill: question.skill,
      source: 'manual' as const,
    }
    const nextStartedAt = new Date()
    prismaMock.$queryRaw.mockResolvedValue([{
      inserted: true,
      eligible: true,
      duplicate: false,
      answered_count: 2n,
      expected_count: 2n,
      current_index: 1,
      question_started_at: nextStartedAt,
      question_deadline_at: new Date(nextStartedAt.getTime() + 10_000),
      started_at: match.startedAt,
      status: 'in_progress',
      participant_progress: match.participants.map((participant) => ({
        player_id: participant.playerId,
        status: 'playing',
        score: participant.playerId === 'player-a' ? 100 : null,
        score_points: participant.playerId === 'player-a' ? 8 : 0,
        correct_answers: participant.playerId === 'player-a' ? 1 : 0,
        total_questions: participant.playerId === 'player-a' ? 1 : 0,
        total_response_time_ms: participant.playerId === 'player-a' ? 500 : 0,
        best_streak: participant.playerId === 'player-a' ? 1 : 0,
      })),
      terminal: false,
      advanced: true,
    }])
    const snapshot = {
      ...serializeMatch(toMatchView(match as never)),
      status: 'ready' as const,
      startedAt: null,
      participants: serializeMatch(toMatchView(match as never)).participants.map((participant) => ({
        ...participant,
        status: 'accepted' as const,
      })),
    }

    const result = await submitAtomicTempoAnswer('player-a', 'match-1', answer, snapshot)

    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      advanced: true,
      terminal: false,
      progress: { answeredCount: 2, expectedAnswerCount: 2, complete: true },
      snapshot: {
        status: 'in_progress',
        tempoQuestionIndex: 1,
        participants: expect.arrayContaining([
          expect.objectContaining({ status: 'playing' }),
        ]),
      },
    })
  })

  it('calcule la meilleure serie Tempo sur tout l historique atomique', async () => {
    const match = tempoMatch({ questionCount: 3, tempoQuestionIndex: 2 })
    const question = generateMatchQuestion('seed-1', 2, 'addition', 'debutant')
    prismaMock.$queryRaw.mockResolvedValue([{
      inserted: true,
      eligible: true,
      duplicate: false,
      answered_count: 1n,
      expected_count: 2n,
      current_index: 2,
      question_started_at: match.tempoQuestionStartedAt,
      question_deadline_at: match.tempoQuestionDeadlineAt,
      started_at: match.startedAt,
      status: 'in_progress',
      participant_progress: match.participants.map((participant) => ({
        player_id: participant.playerId,
        status: 'playing',
        score: participant.playerId === 'player-a' ? 100 : null,
        score_points: participant.playerId === 'player-a' ? 24 : 0,
        correct_answers: participant.playerId === 'player-a' ? 3 : 0,
        total_questions: participant.playerId === 'player-a' ? 3 : 0,
        total_response_time_ms: participant.playerId === 'player-a' ? 1_500 : 0,
        best_streak: participant.playerId === 'player-a' ? 3 : 0,
      })),
      terminal: false,
      advanced: false,
    }])

    const result = await submitAtomicTempoAnswer('player-a', 'match-1', {
      questionIndex: 2,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 500,
      skill: question.skill,
      source: 'manual',
    }, serializeMatch(toMatchView(match as never)))
    const query = (prismaMock.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(' ')

    expect(query).toContain('computed_best_streak')
    expect(query).toContain('GROUP BY "streak_group"')
    expect(result.snapshot.participants.find((participant) => participant.player.id === 'player-a')).toMatchObject({
      bestStreak: 3,
    })
  })

  it('verrouille le match avant d enregistrer une reponse et laisse PostgreSQL compter', async () => {
    const match = tempoMatch()
    const question = generateMatchQuestion('seed-1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 500,
      skill: question.skill,
      source: 'manual' as const,
    }
    tx.match.findFirst.mockResolvedValue(match)
    tx.matchQuestionAnswer.findUnique.mockResolvedValue(null)
    tx.matchQuestionAnswer.findMany.mockResolvedValue([{ ...answer, playerId: 'player-a' }])
    tx.matchQuestionAnswer.count.mockResolvedValue(1)
    tx.match.findUniqueOrThrow.mockResolvedValue(match)

    const result = await submitPersistedTempoAnswer('player-a', 'match-1', answer)

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.match.findFirst.mock.invocationCallOrder[0]!)
    expect(tx.matchQuestionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchId: 'match-1', playerId: 'player-a', questionIndex: 0 }),
    })
    expect(result.progress).toMatchObject({ answeredCount: 1, expectedAnswerCount: 2, complete: false })
    expect(tx.match.update).not.toHaveBeenCalled()
  })

  it('avance le curseur une seule fois dans la meme transaction que la derniere reponse', async () => {
    const match = tempoMatch()
    const advanced = tempoMatch({ tempoQuestionIndex: 1, tempoQuestionStartedAt: new Date() })
    const question = generateMatchQuestion('seed-1', 0, 'addition', 'debutant')
    const answer = {
      questionIndex: 0,
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: question.answer,
      responseTimeMs: 600,
      skill: question.skill,
      source: 'manual' as const,
    }
    tx.match.findFirst.mockResolvedValue(match)
    tx.matchQuestionAnswer.findUnique.mockResolvedValue(null)
    tx.matchQuestionAnswer.findMany.mockResolvedValue([{ ...answer, playerId: 'player-b' }])
    tx.matchQuestionAnswer.count.mockResolvedValue(2)
    tx.match.findUniqueOrThrow.mockResolvedValue(advanced)

    const result = await submitPersistedTempoAnswer('player-b', 'match-1', answer)

    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: expect.objectContaining({
        tempoQuestionIndex: 1,
        tempoQuestionStartedAt: expect.any(Date),
        tempoQuestionDeadlineAt: expect.any(Date),
      }),
    })
    expect(result).toMatchObject({ advanced: true, terminal: false })
  })

  it('force les absents et avance un timeout sous FOR UPDATE SKIP LOCKED', async () => {
    const expired = tempoMatch({ tempoQuestionDeadlineAt: new Date(0) })
    const advanced = tempoMatch({ tempoQuestionIndex: 1, tempoQuestionStartedAt: new Date() })
    tx.match.findUnique.mockResolvedValue(expired)
    tx.matchQuestionAnswer.findMany
      .mockResolvedValueOnce([{ playerId: 'player-a' }])
      .mockResolvedValueOnce([{
        correctAnswer: 2,
        userAnswer: null,
        responseTimeMs: 10_000,
      }])
    tx.matchQuestionAnswer.count.mockResolvedValue(2)
    tx.match.findUniqueOrThrow.mockResolvedValue(advanced)

    const [result] = await processExpiredTempoQuestions()

    expect(tx.matchQuestionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matchId: 'match-1',
        playerId: 'player-b',
        questionIndex: 0,
        userAnswer: null,
        responseTimeMs: 10_000,
      }),
    })
    expect(result).toMatchObject({ timedOutPlayerIds: ['player-b'], terminal: false })
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
  })
})
