import { z } from 'zod'

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).default(''),
})

export const adminPlayerParamsSchema = z.object({
  playerId: z.string().cuid(),
})

export const adminDestructiveActionSchema = z.object({
  confirmation: z.string().trim().min(1).max(100),
}).strict()
