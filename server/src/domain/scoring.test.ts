import { describe, expect, it } from 'vitest'
import { calculateAnswerScorePoints, calculateSessionScorePoints } from './scoring.js'

describe('scoring', () => {
  it('calcule des points compacts selon le niveau et la vitesse', () => {
    expect(calculateAnswerScorePoints('debutant', 0, true)).toBe(8)
    expect(calculateAnswerScorePoints('debutant', 3_000, true)).toBe(7)
    expect(calculateAnswerScorePoints('debutant', 30_000, true)).toBe(6)
    expect(calculateAnswerScorePoints('expert', 0, true)).toBe(16)
  })

  it('ne donne aucun point pour une mauvaise reponse', () => {
    expect(calculateAnswerScorePoints('expert', 200, false)).toBe(0)
  })

  it('additionne les points sans plafond', () => {
    expect(calculateSessionScorePoints('debutant', [
      { responseTimeMs: 0, isCorrect: true },
      { responseTimeMs: 3_000, isCorrect: true },
      { responseTimeMs: 200, isCorrect: false },
    ])).toBe(15)
  })
})
