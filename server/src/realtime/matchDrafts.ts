import type { GameLevel, GameType } from '../domain/constants.js'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import { calculateSessionXp } from '../domain/progression.js'
import { buildChallengeConfig, determineMatchWinner, type ChallengeMode } from '../domain/matchRules.js'
import { calculateSessionScorePoints } from '../domain/scoring.js'
import type {
  ChallengeConfigPayload,
  MatchResultPayload,
  ParticipantProgressPayload,
  TempoAnswerPayload,
} from '../schemas/matchSchema.js'
import {
  challengeRunDurationSeconds,
  MATCH_IN_PROGRESS_GRACE_MS,
  MatchServiceError,
  type PersistedChallengeConfig,
} from '../services/matchService.js'
import type { SerializedMatch } from '../services/matchPresenter.js'

const REALTIME_COMPLETED_ROOM_TTL_MS = 2 * 60 * 1000
const ACCEPTED_MATCH_TTL_MS = 10 * 60 * 1000

export type RealtimePublicPlayer = {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  totalXp: number
  presenceStatus: string
  presenceUpdatedAt: string
}

export type TempoRuntimeState = {
  expectedPlayerIds: string[]
  questions: Map<number, { questionIndex: number; answers: Map<string, TempoAnswerPayload> }>
}

export function applyConfigDraft(snapshot: SerializedMatch, config: ChallengeConfigPayload): SerializedMatch {
  const nextChallengeMode = config.challengeMode ?? null
  const hasCompleteConfig = Boolean(config.game && config.level && nextChallengeMode)
  const nextConfig = nextChallengeMode && hasCompleteConfig
    ? buildChallengeConfig({
        challengeMode: nextChallengeMode,
        durationSeconds: config.durationSeconds,
        questionCount: config.questionCount,
        perQuestionTimeLimitSeconds: config.perQuestionTimeLimitSeconds,
      })
    : null

  return {
    ...snapshot,
    game: config.game ?? null,
    level: config.level ?? null,
    practiceSkill: config.practiceSkill ?? null,
    challengeMode: nextChallengeMode,
    durationSeconds: nextConfig?.durationSeconds ?? (nextChallengeMode === 'sprint' ? config.durationSeconds ?? snapshot.durationSeconds : snapshot.durationSeconds),
    questionCount: nextConfig?.questionCount ?? null,
    perQuestionTimeLimitSeconds: nextConfig?.perQuestionTimeLimitSeconds ?? null,
    questionSeed: nextConfig?.questionSeed ?? null,
    configVersion: snapshot.configVersion + 1,
    status: snapshot.status === 'ready' ? 'accepted' : snapshot.status,
    serverNow: new Date().toISOString(),
  }
}

export function emptyParticipantChallengeStats() {
  return {
    room: { wins: 0, losses: 0, draws: 0 },
    friendship: { wins: 0, losses: 0, draws: 0 },
  }
}

export function optimisticInvitationSnapshot(options: {
  matchId: string
  roomId: string
  creatorParticipantId: string
  opponentParticipantId: string
  creator: RealtimePublicPlayer
  opponent: RealtimePublicPlayer
  command: {
    game?: SerializedMatch['game']
    level?: SerializedMatch['level']
    practiceSkill?: SerializedMatch['practiceSkill']
    challengeMode?: ChallengeMode | null
    durationSeconds?: number
    questionCount?: number
    perQuestionTimeLimitSeconds?: number
  }
  now: Date
}): SerializedMatch {
  const hasCompleteConfig = Boolean(options.command.game && options.command.level && options.command.challengeMode)
  const config = options.command.challengeMode && hasCompleteConfig
    ? buildChallengeConfig({
        challengeMode: options.command.challengeMode,
        durationSeconds: options.command.durationSeconds,
        questionCount: options.command.questionCount,
        perQuestionTimeLimitSeconds: options.command.perQuestionTimeLimitSeconds,
      })
    : null
  const nowIso = options.now.toISOString()

  return {
    id: options.matchId,
    roomId: options.roomId,
    type: 'challenge',
    challengeMode: config?.challengeMode ?? null,
    status: 'pending',
    game: options.command.game ?? null,
    level: options.command.level ?? null,
    practiceSkill: options.command.practiceSkill ?? null,
    durationSeconds: config?.durationSeconds ?? 60,
    questionCount: config?.questionCount ?? null,
    perQuestionTimeLimitSeconds: config?.perQuestionTimeLimitSeconds ?? null,
    questionSeed: config?.questionSeed ?? null,
    configVersion: 0,
    winnerPlayerId: null,
    createdAt: nowIso,
    expiresAt: new Date(options.now.getTime() + 20 * 60 * 1000).toISOString(),
    endsAt: null,
    serverNow: nowIso,
    hostActiveAt: nowIso,
    startedAt: null,
    finishedAt: null,
    createdBy: options.creator,
    participants: [
      {
        id: options.creatorParticipantId,
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
        joinedAt: nowIso,
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: emptyParticipantChallengeStats(),
        player: options.creator,
      },
      {
        id: options.opponentParticipantId,
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
        joinedAt: null,
        finishedAt: null,
        forfeitedAt: null,
        rematchRequestedAt: null,
        resultDismissedAt: null,
        challengeStats: emptyParticipantChallengeStats(),
        player: options.opponent,
      },
    ],
  }
}

export function applyInvitationAcceptDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.status !== 'pending') {
    throw new MatchServiceError('match_not_pending')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status !== 'invited') {
    throw new MatchServiceError('participant_not_invited')
  }

  const now = new Date().toISOString()

  return {
    ...snapshot,
    status: 'accepted',
    serverNow: now,
    participants: snapshot.participants.map((item) =>
      item.id === participant.id
        ? { ...item, status: 'accepted', joinedAt: now }
        : item,
    ),
  }
}

export function applyInvitationDeclineDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.status !== 'pending') {
    throw new MatchServiceError('match_not_pending')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status !== 'invited') {
    throw new MatchServiceError('participant_not_invited')
  }

  const now = new Date().toISOString()

  return {
    ...snapshot,
    status: 'cancelled',
    serverNow: now,
    finishedAt: now,
    expiresAt: now,
    participants: snapshot.participants.map((item) =>
      item.id === participant.id
        ? { ...item, status: 'declined', finishedAt: now }
        : item,
    ),
  }
}

export function applyChallengeProposalDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.createdBy.id !== playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (snapshot.status !== 'accepted') {
    throw new MatchServiceError('match_not_accepted')
  }

  assertSerializedCompleteConfig(snapshot)

  if (!snapshot.participants.every((participant) => participant.status === 'accepted')) {
    throw new MatchServiceError('participant_not_invited')
  }

  return {
    ...snapshot,
    status: 'ready',
    serverNow: new Date().toISOString(),
  }
}

export function applyProposalDeclineDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.createdBy.id === playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (snapshot.status !== 'ready') {
    throw new MatchServiceError('match_not_ready')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant || participant.status !== 'accepted') {
    throw new MatchServiceError('match_not_participant')
  }

  return {
    ...snapshot,
    status: 'accepted',
    serverNow: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ACCEPTED_MATCH_TTL_MS).toISOString(),
    configVersion: snapshot.configVersion + 1,
  }
}

export function applyProposalAcceptDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.createdBy.id === playerId) {
    throw new MatchServiceError('match_not_owned')
  }

  if (snapshot.status !== 'ready' && snapshot.status !== 'accepted') {
    throw new MatchServiceError('match_not_ready')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant || participant.status !== 'accepted') {
    throw new MatchServiceError('match_not_participant')
  }

  assertSerializedCompleteConfig(snapshot)

  if (!snapshot.participants.every((item) => item.status === 'accepted')) {
    throw new MatchServiceError('participant_not_invited')
  }

  const now = new Date()
  const startedAt = now.toISOString()
  const runDurationMs = challengeRunDurationSeconds(snapshot) * 1000

  return {
    ...snapshot,
    status: 'in_progress',
    serverNow: startedAt,
    startedAt,
    endsAt: new Date(now.getTime() + runDurationMs).toISOString(),
    expiresAt: new Date(now.getTime() + runDurationMs + MATCH_IN_PROGRESS_GRACE_MS).toISOString(),
    participants: snapshot.participants.map((item) => ({ ...item, status: 'playing' })),
  }
}

export function applyForfeitDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  if (snapshot.status !== 'in_progress') {
    throw new MatchServiceError(snapshot.status === 'completed' ? 'match_already_completed' : 'match_not_in_progress')
  }

  const forfeitingParticipant = snapshot.participants.find((item) => item.player.id === playerId)
  const winningParticipant = snapshot.participants.find((item) => item.player.id !== playerId)

  if (!forfeitingParticipant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (forfeitingParticipant.status !== 'playing' && forfeitingParticipant.status !== 'submitting') {
    throw new MatchServiceError('match_not_participant')
  }

  const now = new Date()
  const finishedAt = now.toISOString()

  return {
    ...snapshot,
    status: 'completed',
    serverNow: finishedAt,
    winnerPlayerId: winningParticipant?.player.id ?? null,
    finishedAt,
    expiresAt: new Date(now.getTime() + REALTIME_COMPLETED_ROOM_TTL_MS).toISOString(),
    participants: snapshot.participants.map((item) => {
      if (item.id === forfeitingParticipant.id) {
        return {
          ...item,
          status: 'completed',
          finishedAt,
          forfeitedAt: finishedAt,
        }
      }

      return {
        ...item,
        status: 'completed',
        finishedAt,
        forfeitedAt: null,
      }
    }),
  }
}

export function applyParticipantProgressDraft(snapshot: SerializedMatch, playerId: string, progress: ParticipantProgressPayload): SerializedMatch {
  if (snapshot.status !== 'in_progress') {
    throw new MatchServiceError(snapshot.status === 'completed' ? 'match_already_completed' : 'match_not_in_progress')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (participant.status !== 'playing' && participant.status !== 'submitting' && participant.status !== 'completed') {
    throw new MatchServiceError('match_not_participant')
  }

  return {
    ...snapshot,
    serverNow: new Date().toISOString(),
    participants: snapshot.participants.map((item) =>
      item.id === participant.id
        ? {
            ...item,
            score: progress.score,
            scorePoints: progress.scorePoints,
            correctAnswers: progress.correctAnswers,
            totalQuestions: progress.totalQuestions,
            totalResponseTimeMs: progress.totalResponseTimeMs,
            bestStreak: progress.bestStreak,
          }
        : item,
    ),
  }
}

export function participantProgressByPlayerId(snapshot: SerializedMatch) {
  return Object.fromEntries(snapshot.participants.map((participant) => [
    participant.player.id,
    {
      score: participant.score ?? 0,
      scorePoints: participant.scorePoints,
      correctAnswers: participant.correctAnswers,
      totalQuestions: participant.totalQuestions,
      totalResponseTimeMs: participant.totalResponseTimeMs,
      bestStreak: participant.bestStreak,
    },
  ]))
}

export function applyRoomClosedDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  const now = new Date().toISOString()

  if (snapshot.status === 'completed') {
    return {
      ...snapshot,
      serverNow: now,
      expiresAt: now,
      participants: snapshot.participants.map((item) => ({
        ...item,
        rematchRequestedAt: null,
        resultDismissedAt: now,
      })),
    }
  }

  if (snapshot.status !== 'pending' && snapshot.status !== 'accepted' && snapshot.status !== 'ready' && snapshot.status !== 'in_progress') {
    throw new MatchServiceError('match_not_found')
  }

  const closedParticipantStatus = snapshot.status === 'in_progress' ? 'disconnected' : 'declined'

  return {
    ...snapshot,
    status: 'cancelled',
    serverNow: now,
    finishedAt: now,
    expiresAt: now,
    participants: snapshot.participants.map((item) => ({
      ...item,
      status: item.status === 'completed' ? item.status : closedParticipantStatus,
      finishedAt: item.finishedAt ?? now,
      rematchRequestedAt: null,
    })),
  }
}

export function persistedConfigFromSnapshot(snapshot: SerializedMatch): PersistedChallengeConfig {
  return {
    game: snapshot.game,
    level: snapshot.level,
    practiceSkill: snapshot.practiceSkill,
    challengeMode: snapshot.challengeMode,
    durationSeconds: snapshot.durationSeconds,
    questionCount: snapshot.questionCount,
    perQuestionTimeLimitSeconds: snapshot.perQuestionTimeLimitSeconds,
    questionSeed: snapshot.questionSeed,
    configVersion: snapshot.configVersion,
  }
}

export function applyRematchRequestDraft(snapshot: SerializedMatch, playerId: string): SerializedMatch {
  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant) {
    throw new MatchServiceError('match_not_participant')
  }

  if (snapshot.status !== 'completed') {
    throw new MatchServiceError('match_not_completed')
  }

  if (snapshot.participants.some((item) => item.id !== participant.id && item.resultDismissedAt)) {
    throw new MatchServiceError('match_rematch_unavailable')
  }

  assertSerializedCompleteConfig(snapshot)

  const now = new Date().toISOString()

  return {
    ...snapshot,
    serverNow: now,
    participants: snapshot.participants.map((item) =>
      item.id === participant.id
        ? { ...item, rematchRequestedAt: now }
        : item,
    ),
  }
}

export function assertSerializedCompleteConfig(snapshot: SerializedMatch) {
  if (!snapshot.game || !snapshot.level || !snapshot.challengeMode) {
    throw new MatchServiceError('match_rematch_unavailable')
  }
}

export function tempoExpectedPlayerIds(snapshot: SerializedMatch) {
  return snapshot.participants
    .filter((item) => item.status !== 'declined' && item.status !== 'disconnected')
    .map((item) => item.player.id)
}

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  return totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0
}

function recomputeBestStreak(items: Array<{ isCorrect: boolean }>) {
  let current = 0
  let best = 0

  for (const item of items) {
    current = item.isCorrect ? current + 1 : 0
    best = Math.max(best, current)
  }

  return best
}

function tempoAnswerResult(snapshot: SerializedMatch, answer: TempoAnswerPayload) {
  return {
    prompt: answer.prompt,
    correctAnswer: answer.correctAnswer,
    userAnswer: answer.userAnswer,
    responseTimeMs: answer.responseTimeMs,
    isCorrect: answer.userAnswer !== null && answer.userAnswer === answer.correctAnswer,
    game: snapshot.game as GameType,
    level: snapshot.level as GameLevel,
    skill: answer.skill,
  }
}

export function tempoProgressFromAnswers(snapshot: SerializedMatch, answers: TempoAnswerPayload[]): ParticipantProgressPayload {
  const answerResults = answers.map((answer) => tempoAnswerResult(snapshot, answer))
  const totalQuestions = answerResults.length
  const correctAnswers = answerResults.filter((answer) => answer.isCorrect).length

  return {
    score: calculateAccuracy(correctAnswers, totalQuestions),
    scorePoints: calculateSessionScorePoints(snapshot.level as GameLevel, answerResults),
    correctAnswers,
    totalQuestions,
    totalResponseTimeMs: answerResults.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
    bestStreak: recomputeBestStreak(answerResults),
  }
}

export function tempoAnswersForPlayer(runtime: TempoRuntimeState, playerId: string) {
  return [...runtime.questions.values()]
    .sort((left, right) => left.questionIndex - right.questionIndex)
    .map((question) => question.answers.get(playerId))
    .filter((answer): answer is TempoAnswerPayload => Boolean(answer))
}

export function tempoResultPayload(snapshot: SerializedMatch, runtime: TempoRuntimeState, playerId: string): MatchResultPayload {
  const answers = tempoAnswersForPlayer(runtime, playerId)

  return {
    durationSeconds: Math.max(1, Math.ceil((Date.now() - new Date(snapshot.startedAt ?? snapshot.serverNow).getTime()) / 1000)),
    bestStreak: tempoProgressFromAnswers(snapshot, answers).bestStreak,
    answers: answers.map((answer) => ({
      prompt: answer.prompt,
      correctAnswer: answer.correctAnswer,
      userAnswer: answer.userAnswer,
      responseTimeMs: answer.responseTimeMs,
      skill: answer.skill,
    })),
  }
}

export function tempoTimeoutAnswer(snapshot: SerializedMatch, questionIndex: number, responseTimeMs: number): TempoAnswerPayload {
  const expected = generateMatchQuestion(snapshot.questionSeed!, questionIndex, snapshot.game as GameType, snapshot.level as GameLevel)

  return {
    questionIndex,
    prompt: expected.prompt,
    correctAnswer: expected.answer,
    userAnswer: null,
    responseTimeMs,
    skill: expected.skill,
    source: 'timeout',
  }
}

export function assertExpectedTempoAnswer(snapshot: SerializedMatch, playerId: string, answer: TempoAnswerPayload) {
  if (
    snapshot.status !== 'in_progress' ||
    snapshot.challengeMode !== 'tempo' ||
    !snapshot.questionSeed ||
    !snapshot.game ||
    !snapshot.level ||
    !snapshot.questionCount ||
    !snapshot.perQuestionTimeLimitSeconds
  ) {
    throw new MatchServiceError('match_not_in_progress')
  }

  if (new Date(snapshot.expiresAt).getTime() <= Date.now()) {
    throw new MatchServiceError('match_not_found')
  }

  const participant = snapshot.participants.find((item) => item.player.id === playerId)

  if (!participant || participant.status !== 'playing') {
    throw new MatchServiceError('match_not_participant')
  }

  if (answer.questionIndex >= snapshot.questionCount || answer.questionIndex < 0) {
    throw new MatchServiceError('match_result_invalid')
  }

  const expected = generateMatchQuestion(snapshot.questionSeed, answer.questionIndex, snapshot.game as GameType, snapshot.level as GameLevel)
  const responseLimitMs = snapshot.perQuestionTimeLimitSeconds * 1000 + 750

  if (
    answer.prompt !== expected.prompt ||
    answer.correctAnswer !== expected.answer ||
    answer.skill !== expected.skill ||
    answer.responseTimeMs > responseLimitMs
  ) {
    throw new MatchServiceError('match_result_invalid')
  }
}

export function applyTempoAnswerProgressDraft(snapshot: SerializedMatch, runtime: TempoRuntimeState, playerId: string) {
  return applyParticipantProgressDraft(snapshot, playerId, tempoProgressFromAnswers(snapshot, tempoAnswersForPlayer(runtime, playerId)))
}

export function applyTempoFinalDraft(snapshot: SerializedMatch, runtime: TempoRuntimeState): SerializedMatch {
  const now = new Date()
  const finishedAt = now.toISOString()
  const participantProgressById = new Map(runtime.expectedPlayerIds.map((playerId) => [
    playerId,
    tempoProgressFromAnswers(snapshot, tempoAnswersForPlayer(runtime, playerId)),
  ]))
  const ranking = snapshot.participants
    .filter((participant) => participantProgressById.has(participant.player.id))
    .map((participant) => {
      const progress = participantProgressById.get(participant.player.id)!

      return {
        playerId: participant.player.id,
        scorePoints: progress.scorePoints,
        correctAnswers: progress.correctAnswers,
        totalResponseTimeMs: progress.totalResponseTimeMs,
        finishedAt: now,
      }
    })
  const winnerPlayerId = determineMatchWinner(ranking)

  return {
    ...snapshot,
    status: 'completed',
    serverNow: finishedAt,
    winnerPlayerId,
    finishedAt,
    expiresAt: new Date(now.getTime() + REALTIME_COMPLETED_ROOM_TTL_MS).toISOString(),
    participants: snapshot.participants.map((participant) => {
      const progress = participantProgressById.get(participant.player.id)

      if (!progress) {
        return participant
      }

      return {
        ...participant,
        status: 'completed',
        score: progress.score,
        scorePoints: progress.scorePoints,
        xp: calculateSessionXp({
          level: snapshot.level as GameLevel,
          correctAnswers: progress.correctAnswers,
          totalQuestions: progress.totalQuestions,
          bestStreak: progress.bestStreak,
        }),
        correctAnswers: progress.correctAnswers,
        totalQuestions: progress.totalQuestions,
        totalResponseTimeMs: progress.totalResponseTimeMs,
        bestStreak: progress.bestStreak,
        finishedAt,
        forfeitedAt: null,
      }
    }),
  }
}
