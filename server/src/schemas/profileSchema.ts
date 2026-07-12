import { z } from 'zod'
import { normalizeTimeZone } from '../domain/daily.js'
import { badRequest } from '../errors.js'

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/
const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const PRESENCE_STATUSES = ['online', 'away', 'busy', 'offline'] as const
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]

function parseBirthDate(value: string) {
  if (!BIRTH_DATE_PATTERN.test(value)) {
    return null
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }

  return date
}

function ageFromBirthDate(birthDate: Date, today = new Date()) {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - birthDate.getUTCMonth()
  const dayDiff = today.getUTCDate() - birthDate.getUTCDate()

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1
  }

  return age
}

export const profilePayloadSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  birthDate: z
    .string()
    .trim()
    .refine((value) => {
      const birthDate = parseBirthDate(value)

      if (!birthDate) {
        return false
      }

      const age = ageFromBirthDate(birthDate)
      return age >= 6 && age <= 120
    }, 'birth_date_invalid'),
  username: z.string().trim().min(3).max(24).regex(USERNAME_PATTERN).optional(),
  timeZone: z
    .string()
    .trim()
    .max(80)
    .refine((value) => normalizeTimeZone(value) === value, 'time_zone_invalid')
    .optional(),
  avatarUrl: z
    .string()
    .trim()
    .max(1024)
    .refine((value) => !value || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/'), {
      message: 'avatar_url_invalid',
    })
    .nullable()
    .optional(),
})

export function parseProfilePayload(value: unknown) {
  const parsed = profilePayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Profil invalide. Vérifiez les champs saisis.')
  }

  return {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    birthDate: parseBirthDate(parsed.data.birthDate) as Date,
    username: parsed.data.username,
    timeZone: parsed.data.timeZone ? normalizeTimeZone(parsed.data.timeZone) : undefined,
    avatarUrl: parsed.data.avatarUrl === undefined ? undefined : parsed.data.avatarUrl?.trim() || null,
  }
}

const timeZonePayloadSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .max(80)
    .refine((value) => normalizeTimeZone(value) === value, 'time_zone_invalid'),
})

export function parseTimeZonePayload(value: unknown) {
  const parsed = timeZonePayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Fuseau horaire invalide.')
  }

  return { timeZone: normalizeTimeZone(parsed.data.timeZone) }
}

const presencePayloadSchema = z.object({
  presenceStatus: z.enum(PRESENCE_STATUSES),
})

export function parsePresencePayload(value: unknown) {
  const parsed = presencePayloadSchema.safeParse(value)

  if (!parsed.success) {
    throw badRequest('Statut invalide.')
  }

  return parsed.data
}
