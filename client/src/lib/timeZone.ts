export const DEFAULT_TIME_ZONE = 'Europe/Paris'

export const TIME_ZONE_OPTIONS = [
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Denver', label: 'America/Denver' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Africa/Kinshasa', label: 'Africa/Kinshasa' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos' },
  { value: 'UTC', label: 'UTC' },
]

export function detectBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function timeZoneOptionsFor(...timeZones: Array<string | null | undefined>) {
  const options = [...TIME_ZONE_OPTIONS]

  timeZones.forEach((timeZone) => {
    if (timeZone && isValidTimeZone(timeZone) && !options.some((option) => option.value === timeZone)) {
      options.push({ value: timeZone, label: timeZone })
    }
  })

  return options.sort((a, b) => a.label.localeCompare(b.label))
}
