import { z } from 'zod'
import { VALID_GAMES, VALID_LEVELS, VALID_SKILLS } from '../domain/constants.js'
import { badRequest } from '../errors.js'

const answerSchema = z.object({
  prompt: z.string().trim().min(1).max(80),
  correctAnswer: z.number().int(),
  userAnswer: z.number().int(),
  responseTimeMs: z.number().int().min(0).max(600000),
  game: z.enum(VALID_GAMES).optional(),
  level: z.enum(VALID_LEVELS).optional(),
  skill: z.enum(VALID_SKILLS),
})

const sessionSchema = z.object({
  game: z.enum(VALID_GAMES),
  level: z.enum(VALID_LEVELS),
  practiceSkill: z.enum(VALID_SKILLS).nullable(),
  points: z.number().int().min(0).max(100000),
  totalQuestions: z.number().int().min(1).max(500),
  durationSeconds: z.number().int().min(1).max(3600),
  bestStreak: z.number().int().min(0).max(500),
  answers: z.array(answerSchema).min(1).max(500),
})

export type SessionPayload = z.infer<typeof sessionSchema>

export function parseSessionPayload(body: unknown): SessionPayload {
  const payload = sessionSchema.parse(body)

  if (payload.answers.length !== payload.totalQuestions) {
    throw badRequest('Détail des réponses incohérent.')
  }

  if (payload.bestStreak > payload.totalQuestions) {
    throw badRequest('Meilleure série invalide.')
  }

  return payload
}
