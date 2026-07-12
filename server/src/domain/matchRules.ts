import { randomUUID } from 'node:crypto'

export const MATCH_TYPES = ['challenge'] as const
export const CHALLENGE_MODES = ['sprint', 'tempo'] as const
export const SPRINT_DURATION_SECONDS_OPTIONS = [60, 90, 120] as const
export const DEFAULT_TEMPO_QUESTION_SECONDS = 10
export const MIN_TEMPO_QUESTION_SECONDS = 5
export const MAX_TEMPO_QUESTION_SECONDS = 30
export const MATCH_STATUSES = ['pending', 'accepted', 'ready', 'in_progress', 'completed', 'cancelled', 'expired'] as const
export const MATCH_PARTICIPANT_STATUSES = ['invited', 'accepted', 'declined', 'ready', 'playing', 'submitting', 'completed', 'disconnected'] as const

export type ChallengeMode = (typeof CHALLENGE_MODES)[number]
export type SprintDurationSeconds = (typeof SPRINT_DURATION_SECONDS_OPTIONS)[number]

export type ChallengeConfigInput = {
  challengeMode: ChallengeMode
  durationSeconds?: number
  questionCount?: number
  perQuestionTimeLimitSeconds?: number
}

export function isSprintDurationSeconds(value: unknown): value is SprintDurationSeconds {
  return typeof value === 'number' && Number.isInteger(value) && (SPRINT_DURATION_SECONDS_OPTIONS as readonly number[]).includes(value)
}

function sprintDurationSecondsOrThrow(value: number | undefined) {
  const durationSeconds = value ?? 60

  if (!isSprintDurationSeconds(durationSeconds)) {
    throw new Error(`invalid_sprint_duration:${durationSeconds}`)
  }

  return durationSeconds
}

export function isTempoQuestionSeconds(value: unknown) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TEMPO_QUESTION_SECONDS &&
    value <= MAX_TEMPO_QUESTION_SECONDS
  )
}

function tempoQuestionSecondsOrThrow(value: number | undefined) {
  const perQuestionTimeLimitSeconds = value ?? DEFAULT_TEMPO_QUESTION_SECONDS

  if (!isTempoQuestionSeconds(perQuestionTimeLimitSeconds)) {
    throw new Error(`invalid_tempo_question_seconds:${perQuestionTimeLimitSeconds}`)
  }

  return perQuestionTimeLimitSeconds
}

export function buildChallengeConfig(input: ChallengeConfigInput) {
  if (input.challengeMode === 'tempo') {
    const questionCount = Math.min(Math.max(input.questionCount ?? 30, 10), 50)
    const perQuestionTimeLimitSeconds = tempoQuestionSecondsOrThrow(input.perQuestionTimeLimitSeconds)

    return {
      challengeMode: input.challengeMode,
      durationSeconds: questionCount * perQuestionTimeLimitSeconds,
      questionCount,
      perQuestionTimeLimitSeconds,
      questionSeed: randomUUID(),
    }
  }

  return {
    challengeMode: input.challengeMode,
    durationSeconds: sprintDurationSecondsOrThrow(input.durationSeconds),
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: randomUUID(),
  }
}

export function canonicalPairIds(playerId: string, otherPlayerId: string) {
  return playerId < otherPlayerId
    ? { playerAId: playerId, playerBId: otherPlayerId }
    : { playerAId: otherPlayerId, playerBId: playerId }
}

export type MatchResultRankInput = {
  playerId: string
  scorePoints: number
  correctAnswers: number
  totalResponseTimeMs: number
  finishedAt: Date | null
}

export function determineMatchWinner(participants: MatchResultRankInput[]) {
  const completedParticipants = participants.filter((participant) => participant.finishedAt)

  if (completedParticipants.length < 2) {
    return null
  }

  const [leader, challenger] = [...completedParticipants].sort((left, right) => {
    return right.scorePoints - left.scorePoints
  })

  if (leader.scorePoints === challenger.scorePoints) {
    return null
  }

  return leader.playerId
}
