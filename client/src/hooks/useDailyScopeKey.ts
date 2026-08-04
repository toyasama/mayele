import { useEffect, useState } from 'react'
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '../lib/timeZone'

const MAX_DAILY_ROLLOVER_DELAY_MS = 36 * 60 * 60 * 1000
const ROLLOVER_MARGIN_MS = 250

function resolvedTimeZone(timeZone: string | null | undefined) {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE
}

export function dailyScopeKey(date: Date, timeZone?: string | null) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))

  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

export function millisecondsUntilNextDailyScope(date: Date, timeZone?: string | null) {
  const initialScope = dailyScopeKey(date, timeZone)
  const now = date.getTime()
  let lowerBound = now + 1
  let upperBound = now + MAX_DAILY_ROLLOVER_DELAY_MS

  // The next local midnight is at most 25 hours away, including DST days.
  // A binary search avoids hand-written UTC-offset arithmetic and also works
  // for half-hour and quarter-hour time zones.
  while (lowerBound < upperBound) {
    const middle = lowerBound + Math.floor((upperBound - lowerBound) / 2)

    if (dailyScopeKey(new Date(middle), timeZone) === initialScope) {
      lowerBound = middle + 1
    } else {
      upperBound = middle
    }
  }

  return Math.max(1, lowerBound - now + ROLLOVER_MARGIN_MS)
}

export function useDailyScopeKey(timeZone?: string | null) {
  const safeTimeZone = resolvedTimeZone(timeZone)
  const [scopeKey, setScopeKey] = useState(() => dailyScopeKey(new Date(), safeTimeZone))

  useEffect(() => {
    let timer: number | null = null

    const scheduleNextRollover = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }

      timer = window.setTimeout(checkCurrentScope, millisecondsUntilNextDailyScope(new Date(), safeTimeZone))
    }
    const checkCurrentScope = () => {
      setScopeKey(dailyScopeKey(new Date(), safeTimeZone))
      scheduleNextRollover()
    }
    const checkVisibleScope = () => {
      if (document.visibilityState === 'visible') {
        checkCurrentScope()
      }
    }

    checkCurrentScope()
    document.addEventListener('visibilitychange', checkVisibleScope)
    window.addEventListener('focus', checkCurrentScope)
    window.addEventListener('pageshow', checkCurrentScope)

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', checkVisibleScope)
      window.removeEventListener('focus', checkCurrentScope)
      window.removeEventListener('pageshow', checkCurrentScope)
    }
  }, [safeTimeZone])

  return scopeKey
}
