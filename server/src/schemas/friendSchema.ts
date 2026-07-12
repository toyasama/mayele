import { z } from 'zod'
import { badRequest } from '../errors.js'

const usernameSearchSchema = z.object({
  username: z.string().trim().min(2).max(24),
})

const friendRequestPayloadSchema = z.object({
  receiverPlayerId: z.string().trim().min(1).max(128),
})

export function parsePlayerSearchQuery(value: unknown) {
  const parsed = usernameSearchSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Recherche invalide.')
  }

  return { username: parsed.data.username.toLowerCase() }
}

export function parseFriendRequestPayload(value: unknown) {
  const parsed = friendRequestPayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest("Demande d'ami invalide.")
  }

  return parsed.data
}
