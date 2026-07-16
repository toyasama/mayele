import { z } from 'zod'

const presenceVisibilityCommandSchema = z.object({
  visible: z.boolean(),
  clientCommandId: z.string().trim().min(1).max(128).optional(),
}).strict()

export type PresenceVisibilityCommand = z.infer<typeof presenceVisibilityCommandSchema>

export function parsePresenceVisibilityCommand(value: unknown): PresenceVisibilityCommand | null {
  const parsed = presenceVisibilityCommandSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
