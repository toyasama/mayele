import { describe, expect, it } from 'vitest'
import { criticalRemainingSeconds, isCriticalRemainingTime, TEMPO_RESPONSE_SECONDS } from './challengeTiming'

describe('challengeTiming', () => {
  it('calcule le seuil critique a 30 pourcent du temps total', () => {
    expect(criticalRemainingSeconds(5)).toBe(2)
    expect(criticalRemainingSeconds(TEMPO_RESPONSE_SECONDS)).toBe(3)
    expect(criticalRemainingSeconds(30)).toBe(9)
    expect(criticalRemainingSeconds(60)).toBe(18)
    expect(criticalRemainingSeconds(90)).toBe(27)
    expect(criticalRemainingSeconds(120)).toBe(36)
  })

  it('rend critique quand le temps restant atteint 30 pourcent du total', () => {
    expect(isCriticalRemainingTime(10, 4)).toBe(false)
    expect(isCriticalRemainingTime(10, 3)).toBe(true)
    expect(isCriticalRemainingTime(60, 19)).toBe(false)
    expect(isCriticalRemainingTime(60, 18)).toBe(true)
  })
})
