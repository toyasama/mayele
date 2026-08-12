import { z } from 'zod'
import { VALID_GAMES, VALID_LEVELS, VALID_SKILLS } from '../domain/constants.js'

export const startSoloRunSchema = z.object({
  clientRunId: z.uuid(),
  mode: z.enum(['sprint', 'tempo']),
  game: z.enum(VALID_GAMES),
  level: z.enum(VALID_LEVELS),
  practiceSkill: z.enum(VALID_SKILLS).nullable(),
  sprintDurationSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]),
  tempoQuestionCount: z.number().int().min(10).max(50),
  tempoQuestionSeconds: z.number().int().min(5).max(30),
})

export const submitSoloAnswerSchema = z.object({
  questionIndex: z.number().int().min(0).max(119),
  userAnswer: z.number().int().nullable(),
})

export type StartSoloRunInput = z.infer<typeof startSoloRunSchema>
export type SubmitSoloAnswerInput = z.infer<typeof submitSoloAnswerSchema>
