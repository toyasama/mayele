import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dailyScopeKey, millisecondsUntilNextDailyScope, useDailyScopeKey } from './useDailyScopeKey'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('dailyScopeKey', () => {
  it('suit le jour civil du fuseau du profil', () => {
    const instant = new Date('2026-08-04T22:30:00.000Z')

    expect(dailyScopeKey(instant, 'Europe/Paris')).toBe('2026-08-05')
    expect(dailyScopeKey(instant, 'America/New_York')).toBe('2026-08-04')
  })

  it('calcule le prochain minuit sans supposer une journee de 24 heures', () => {
    const beforeSummerMidnight = new Date('2026-08-04T21:59:59.900Z')
    const beforeWinterRollover = new Date('2026-10-24T22:30:00.000Z')

    expect(millisecondsUntilNextDailyScope(beforeSummerMidnight, 'Europe/Paris')).toBe(350)
    expect(millisecondsUntilNextDailyScope(beforeWinterRollover, 'Europe/Paris')).toBe(24.5 * 60 * 60 * 1000 + 250)
  })
})

describe('useDailyScopeKey', () => {
  it('change automatiquement de jour apres le minuit local', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T21:59:59.900Z'))
    const { result } = renderHook(() => useDailyScopeKey('Europe/Paris'))

    expect(result.current).toBe('2026-08-04')

    act(() => {
      vi.advanceTimersByTime(350)
    })

    expect(result.current).toBe('2026-08-05')
  })

  it('rattrape le changement de jour au retour d un onglet Safari suspendu', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    const { result } = renderHook(() => useDailyScopeKey('Europe/Paris'))

    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))
    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(result.current).toBe('2026-08-06')
  })
})
