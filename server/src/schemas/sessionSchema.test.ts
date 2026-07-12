import { describe, expect, it } from 'vitest'
import { parseSessionPayload } from './sessionSchema.js'

const answer = {
  prompt: '2 + 2',
  correctAnswer: 4,
  userAnswer: 4,
  responseTimeMs: 900,
  game: 'addition',
  level: 'debutant',
  skill: 'addition',
}

describe('parseSessionPayload', () => {
  it('accepts a coherent session payload', () => {
    const payload = parseSessionPayload({
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      totalQuestions: 1,
      durationSeconds: 60,
      bestStreak: 1,
      answers: [answer],
    })

    expect(payload.totalQuestions).toBe(1)
  })

  it('rejects a mismatch between totalQuestions and answers length', () => {
    expect(() =>
      parseSessionPayload({
        game: 'addition',
        level: 'debutant',
        practiceSkill: null,
        totalQuestions: 2,
        durationSeconds: 60,
        bestStreak: 1,
        answers: [answer],
      }),
    ).toThrow('Détail des réponses incohérent.')
  })
})
