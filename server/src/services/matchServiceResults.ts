import type { GameLevel, GameType, SkillTag } from '../domain/constants.js'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import { determineMatchWinner } from '../domain/matchRules.js'
import { prisma } from '../lib/prisma.js'
import type { MatchResultPayload, ParticipantProgressPayload, TempoAnswerPayload } from '../schemas/matchSchema.js'
import { MatchServiceError } from './matchServiceErrors.js'
import { MATCH_INCLUDE } from './matchServiceView.js'
import { challengeRunDurationSeconds } from './matchServiceTiming.js'

const COMPLETED_ROOM_TTL_MS = 2 * 60 * 1000

function expiresIn(ms: number) {
  return new Date(Date.now() + ms)
}

function assertCompleteConfig(match: {
  game: string | null
  level: string | null
  challengeMode: string | null
  questionCount?: number | null
  perQuestionTimeLimitSeconds?: number | null
}) {
  if (!match.game || !match.level || !match.challengeMode) {
    throw new MatchServiceError('match_config_incomplete')
  }

  if (match.challengeMode === 'tempo' && (!match.questionCount || !match.perQuestionTimeLimitSeconds)) {
    throw new MatchServiceError('match_config_incomplete')
  }
}

export function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
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

export function buildValidatedSessionPayload(
  match: {
    game: string | null
    level: string | null
    practiceSkill: string | null
    challengeMode: string | null
    durationSeconds: number
    questionCount: number | null
    perQuestionTimeLimitSeconds: number | null
    questionSeed: string | null
    startedAt: Date | null
  },
  payload: MatchResultPayload,
) {
  assertCompleteConfig(match)

  if (!match.questionSeed || !match.startedAt) {
    throw new MatchServiceError('match_config_incomplete')
  }

  const maxQuestions = match.challengeMode === 'tempo' ? match.questionCount ?? 0 : 120

  if (payload.answers.length > maxQuestions) {
    throw new MatchServiceError('match_result_invalid')
  }

  if (match.challengeMode === 'tempo' && payload.answers.length !== maxQuestions) {
    throw new MatchServiceError('match_result_invalid')
  }

  const answers = payload.answers.map((answer, index) => {
    const game = match.game as GameType
    const level = match.level as GameLevel
    const expected = generateMatchQuestion(match.questionSeed!, index, game, level)
    const perQuestionLimitMs = match.challengeMode === 'tempo' ? match.perQuestionTimeLimitSeconds! * 1000 + 750 : null

    if (answer.prompt !== expected.prompt || answer.correctAnswer !== expected.answer || answer.skill !== expected.skill) {
      throw new MatchServiceError('match_result_invalid')
    }

    if (perQuestionLimitMs !== null && answer.responseTimeMs > perQuestionLimitMs) {
      throw new MatchServiceError('match_result_invalid')
    }

    return {
      prompt: expected.prompt,
      correctAnswer: expected.answer,
      userAnswer: answer.userAnswer,
      responseTimeMs: answer.responseTimeMs,
      isCorrect: answer.userAnswer === expected.answer,
      game,
      level,
      skill: expected.skill,
    }
  })
  const elapsedSeconds = Math.max(1, Math.ceil((Date.now() - match.startedAt.getTime()) / 1000))
  const maxDurationSeconds = challengeRunDurationSeconds(match) + 30
  const durationSeconds = Math.min(Math.max(1, payload.durationSeconds, elapsedSeconds), maxDurationSeconds)

  return {
    sessionPayload: {
      game: match.game as GameType,
      level: match.level as GameLevel,
      practiceSkill: match.practiceSkill as SkillTag | null,
      totalQuestions: answers.length,
      durationSeconds,
      bestStreak: recomputeBestStreak(answers),
      answers,
    },
    correctAnswers: answers.filter((answer) => answer.isCorrect).length,
    totalQuestions: answers.length,
    totalResponseTimeMs: answers.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
  }
}

export function expectedTempoQuestion(
  match: {
    game: string | null
    level: string | null
    challengeMode: string | null
    questionCount: number | null
    perQuestionTimeLimitSeconds: number | null
    questionSeed: string | null
    startedAt: Date | null
  },
  payload: TempoAnswerPayload,
) {
  assertCompleteConfig(match)

  if (match.challengeMode !== 'tempo' || !match.questionSeed || !match.startedAt || !match.questionCount || !match.perQuestionTimeLimitSeconds) {
    throw new MatchServiceError('match_config_incomplete')
  }

  if (payload.questionIndex >= match.questionCount) {
    throw new MatchServiceError('match_tempo_answer_invalid')
  }

  const expected = generateMatchQuestion(match.questionSeed, payload.questionIndex, match.game as GameType, match.level as GameLevel)
  const responseLimitMs = match.perQuestionTimeLimitSeconds * 1000 + 750

  if (
    payload.prompt !== expected.prompt ||
    payload.correctAnswer !== expected.answer ||
    payload.skill !== expected.skill ||
    payload.responseTimeMs > responseLimitMs
  ) {
    throw new MatchServiceError('match_tempo_answer_invalid')
  }

  return expected
}

export function tempoQuestionAnswerUpsert(playerId: string, matchId: string, payload: TempoAnswerPayload) {
  return prisma.matchQuestionAnswer.upsert({
    where: {
      matchId_playerId_questionIndex: {
        matchId,
        playerId,
        questionIndex: payload.questionIndex,
      },
    },
    update: {},
    create: {
      matchId,
      playerId,
      questionIndex: payload.questionIndex,
      prompt: payload.prompt,
      correctAnswer: payload.correctAnswer,
      userAnswer: payload.userAnswer,
      responseTimeMs: payload.responseTimeMs,
      skill: payload.skill,
    },
  })
}

export async function persistTempoQuestionAnswer(playerId: string, matchId: string, payload: TempoAnswerPayload) {
  await tempoQuestionAnswerUpsert(playerId, matchId, payload)
}

export async function finalizeMatchIfDone(matchId: string) {
  const participants = await prisma.matchParticipant.findMany({
    where: { matchId },
    select: {
      playerId: true,
      status: true,
      scorePoints: true,
      correctAnswers: true,
      totalResponseTimeMs: true,
      finishedAt: true,
    },
  })
  const allDone = participants.every((item) => item.status === 'completed' || item.status === 'disconnected' || item.status === 'declined')

  if (!allDone) {
    return null
  }

  const winnerPlayerId = determineMatchWinner(participants)
  const now = new Date()

  await prisma.match.updateMany({
    where: { id: matchId, status: 'in_progress' },
    data: {
      status: 'completed',
      winnerPlayerId,
      finishedAt: now,
      expiresAt: expiresIn(COMPLETED_ROOM_TTL_MS),
    },
  })

  return prisma.match.findUnique({
    where: { id: matchId },
    include: MATCH_INCLUDE,
  })
}

export function progressForParticipant(
  participant: {
    score: number | null
    scorePoints: number
    correctAnswers: number
    totalQuestions: number
    totalResponseTimeMs: number
    bestStreak: number
  },
  progress?: ParticipantProgressPayload,
) {
  return {
    score: progress?.score ?? participant.score ?? 0,
    scorePoints: progress?.scorePoints ?? participant.scorePoints,
    correctAnswers: progress?.correctAnswers ?? participant.correctAnswers,
    totalQuestions: progress?.totalQuestions ?? participant.totalQuestions,
    totalResponseTimeMs: progress?.totalResponseTimeMs ?? participant.totalResponseTimeMs,
    bestStreak: progress?.bestStreak ?? participant.bestStreak,
  }
}
