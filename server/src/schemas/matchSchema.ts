import { z } from 'zod'
import { VALID_GAMES, VALID_LEVELS, VALID_SKILLS } from '../domain/constants.js'
import { CHALLENGE_MODES, isSprintDurationSeconds, isTempoQuestionSeconds } from '../domain/matchRules.js'
import { badRequest } from '../errors.js'

const challengeConfigFieldsSchema = z.object({
  game: z.enum(VALID_GAMES),
  level: z.enum(VALID_LEVELS),
  practiceSkill: z.enum(VALID_SKILLS).nullable().optional(),
  challengeMode: z.enum(CHALLENGE_MODES).default('sprint'),
  durationSeconds: z.number().int().refine(isSprintDurationSeconds).optional(),
  questionCount: z.number().int().min(10).max(50).optional(),
  perQuestionTimeLimitSeconds: z.number().int().refine(isTempoQuestionSeconds).optional(),
  expectedConfigVersion: z.number().int().min(0).optional(),
})

function stripInactiveChallengeFields(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const payload = { ...(value as Record<string, unknown>) }

  if (payload.challengeMode === 'tempo') {
    delete payload.durationSeconds
  }

  if (payload.challengeMode === 'sprint') {
    delete payload.questionCount
    delete payload.perQuestionTimeLimitSeconds
  }

  if (payload.challengeMode === null) {
    delete payload.durationSeconds
    delete payload.questionCount
    delete payload.perQuestionTimeLimitSeconds
  }

  return payload
}

const challengePayloadSchema = z.preprocess(
  stripInactiveChallengeFields,
  z.object({
    opponentPlayerId: z.string().trim().min(1).max(128),
  })
    .merge(challengeConfigFieldsSchema.partial()),
)

export function parseChallengePayload(value: unknown) {
  const parsed = challengePayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Defi invalide. Verifiez les options choisies.')
  }

  return parsed.data
}

const challengeConfigPayloadSchema = z.preprocess(
  stripInactiveChallengeFields,
  challengeConfigFieldsSchema.extend({
    game: z.enum(VALID_GAMES).nullable().optional(),
    level: z.enum(VALID_LEVELS).nullable().optional(),
    challengeMode: z.enum(CHALLENGE_MODES).nullable().optional(),
  }),
)

const realtimeChallengeConfigCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  config: challengeConfigPayloadSchema,
})
const realtimeMatchCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
})
const participantProgressPayloadSchema = z.object({
  score: z.number().int().min(0).max(100),
  scorePoints: z.number().int().min(0).max(100_000),
  correctAnswers: z.number().int().min(0).max(120),
  totalQuestions: z.number().int().min(0).max(120),
  totalResponseTimeMs: z.number().int().min(0).max(3_600_000),
  bestStreak: z.number().int().min(0).max(120),
})
const realtimeMatchProgressCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  progress: participantProgressPayloadSchema,
})
const realtimeForfeitCommandSchema = realtimeMatchCommandSchema.extend({
  progress: participantProgressPayloadSchema.optional(),
})
const realtimeMatchProposeCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  config: z.preprocess(stripInactiveChallengeFields, challengeConfigFieldsSchema).optional(),
})

export function parseChallengeConfigPayload(value: unknown): ChallengeConfigPayload {
  const parsed = challengeConfigPayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Configuration de defi invalide.')
  }

  return parsed.data
}

const matchAnswerPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(80),
  correctAnswer: z.number().int(),
  userAnswer: z.number().int().nullable(),
  responseTimeMs: z.number().int().min(0).max(90_000),
  skill: z.enum(VALID_SKILLS),
})

const tempoAnswerPayloadSchema = matchAnswerPayloadSchema.extend({
  questionIndex: z.number().int().min(0).max(120),
  source: z.enum(['manual', 'timeout']).default('manual'),
})

const realtimeTempoAnswerCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  answer: tempoAnswerPayloadSchema,
})

const matchResultPayloadSchema = z.object({
  durationSeconds: z.number().int().min(1).max(3600),
  bestStreak: z.number().int().min(0).max(120),
  answers: z.array(matchAnswerPayloadSchema).max(120),
})

const realtimeMatchResultCommandSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  result: matchResultPayloadSchema,
})

export type ChallengePayload = z.infer<typeof challengePayloadSchema>
export type ChallengeConfigPayload = z.infer<typeof challengeConfigPayloadSchema>
export type RealtimeChallengeConfigCommandPayload = z.infer<typeof realtimeChallengeConfigCommandSchema>
export type RealtimeMatchCommandPayload = z.infer<typeof realtimeMatchCommandSchema>
export type ParticipantProgressPayload = z.infer<typeof participantProgressPayloadSchema>
export type RealtimeMatchProgressCommandPayload = z.infer<typeof realtimeMatchProgressCommandSchema>
export type RealtimeForfeitCommandPayload = z.infer<typeof realtimeForfeitCommandSchema>
export type RealtimeMatchProposeCommandPayload = z.infer<typeof realtimeMatchProposeCommandSchema>
export type RealtimeTempoAnswerCommandPayload = z.infer<typeof realtimeTempoAnswerCommandSchema>
export type RealtimeMatchResultCommandPayload = z.infer<typeof realtimeMatchResultCommandSchema>
export type TempoAnswerPayload = z.infer<typeof tempoAnswerPayloadSchema>
export type MatchResultPayload = z.infer<typeof matchResultPayloadSchema>

export function parseRealtimeChallengeConfigCommand(value: unknown): RealtimeChallengeConfigCommandPayload {
  const parsed = realtimeChallengeConfigCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de configuration de defi invalide.')
  }

  return parsed.data
}

export function parseRealtimeMatchCommand(value: unknown): RealtimeMatchCommandPayload {
  const parsed = realtimeMatchCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de match invalide.')
  }

  return parsed.data
}

export function parseRealtimeMatchProgressCommand(value: unknown): RealtimeMatchProgressCommandPayload {
  const parsed = realtimeMatchProgressCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de progression de defi invalide.')
  }

  if (parsed.data.progress.correctAnswers > parsed.data.progress.totalQuestions) {
    throw badRequest('Progression de defi invalide.')
  }

  if (parsed.data.progress.bestStreak > parsed.data.progress.totalQuestions) {
    throw badRequest('Progression de defi invalide.')
  }

  return parsed.data
}

export function parseRealtimeForfeitCommand(value: unknown): RealtimeForfeitCommandPayload {
  const parsed = realtimeForfeitCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande d abandon de defi invalide.')
  }

  if (parsed.data.progress && parsed.data.progress.correctAnswers > parsed.data.progress.totalQuestions) {
    throw badRequest('Progression de defi invalide.')
  }

  if (parsed.data.progress && parsed.data.progress.bestStreak > parsed.data.progress.totalQuestions) {
    throw badRequest('Progression de defi invalide.')
  }

  return parsed.data
}

export function parseRealtimeMatchProposeCommand(value: unknown): RealtimeMatchProposeCommandPayload {
  const parsed = realtimeMatchProposeCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de proposition de defi invalide.')
  }

  return parsed.data
}

export function parseRealtimeTempoAnswerCommand(value: unknown): RealtimeTempoAnswerCommandPayload {
  const parsed = realtimeTempoAnswerCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de reponse tempo invalide.')
  }

  return parsed.data
}

export function parseRealtimeMatchResultCommand(value: unknown): RealtimeMatchResultCommandPayload {
  const parsed = realtimeMatchResultCommandSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Commande de resultat de defi invalide.')
  }

  if (parsed.data.result.bestStreak > parsed.data.result.answers.length) {
    throw badRequest('Meilleure serie invalide.')
  }

  return parsed.data
}

export function parseTempoAnswerPayload(value: unknown): TempoAnswerPayload {
  const parsed = tempoAnswerPayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Reponse tempo invalide.')
  }

  return parsed.data
}

export function parseMatchResultPayload(value: unknown): MatchResultPayload {
  const parsed = matchResultPayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Resultat de defi invalide.')
  }

  if (parsed.data.bestStreak > parsed.data.answers.length) {
    throw badRequest('Meilleure serie invalide.')
  }

  return parsed.data
}
