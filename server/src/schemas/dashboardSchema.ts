import { z } from 'zod'
import { VALID_GAMES, VALID_LEVELS } from '../domain/constants.js'

export const operationHistoryQuerySchema = z.object({
  game: z.enum(VALID_GAMES),
  level: z.enum(VALID_LEVELS),
  limit: z.coerce.number().int().min(1).max(20).default(20),
})
