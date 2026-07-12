export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type DisplayNameSource = {
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  username?: string | null
}

function cleanNamePart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

export function formatDisplayName(source: DisplayNameSource | null | undefined, fallback = 'Joueur Mayele') {
  const firstName = cleanNamePart(source?.firstName)
  const lastName = cleanNamePart(source?.lastName)
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || cleanNamePart(source?.name) || cleanNamePart(source?.username) || fallback
}

function addUtcYears(date: Date, years: number) {
  const next = new Date(date)
  next.setUTCFullYear(next.getUTCFullYear() + years)
  return next
}

export function parseBirthDate(value: string) {
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

export function ageFromBirthDate(value: string, today = new Date()) {
  const birthDate = parseBirthDate(value)

  if (!birthDate) {
    return null
  }

  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - birthDate.getUTCMonth()
  const dayDiff = today.getUTCDate() - birthDate.getUTCDate()

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1
  }

  return age
}

export function isValidBirthDate(value: string) {
  const age = ageFromBirthDate(value)
  return age !== null && age >= 6 && age <= 120
}

export function dateInputLimit(kind: 'min' | 'max') {
  const today = new Date()
  const years = kind === 'min' ? -120 : -6
  return addUtcYears(today, years).toISOString().slice(0, 10)
}
