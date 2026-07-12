export const DAILY_TIME_ZONE = 'Europe/Paris'

function dailyKeyFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function isValidTimeZone(timeZone: string) {
  try {
    dailyKeyFormatter(timeZone).format(new Date())
    return true
  } catch {
    return false
  }
}

export function normalizeTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim()
  return candidate && isValidTimeZone(candidate) ? candidate : DAILY_TIME_ZONE
}

export function getDailyScopeKey(date = new Date(), timeZone?: string | null) {
  return dailyKeyFormatter(normalizeTimeZone(timeZone)).format(date)
}
