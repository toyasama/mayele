import { describe, expect, it } from 'vitest'
import type { GameLevel, GameType } from './constants.js'
import { generateMatchQuestion, matchQuestionIdentity } from './matchQuestions.js'

function expectUniqueCanonicalQuestions(seed: string, count: number, game: GameType, level: GameLevel) {
  const identities = new Set<string>()

  for (let index = 0; index < count; index += 1) {
    const question = generateMatchQuestion(seed, index, game, level)
    const identity = matchQuestionIdentity(question)

    expect(identities.has(identity), `${question.prompt} duplique un calcul deja vu`).toBe(false)
    identities.add(identity)
  }
}

describe('generateMatchQuestion', () => {
  it('genere une question stable pour une seed et un index donnes', () => {
    expect(generateMatchQuestion('seed_1', 0, 'addition', 'debutant')).toEqual({
      prompt: '17 + 12',
      answer: 29,
      operation: 'addition',
      skill: 'addition',
    })
  })

  it("change de question quand l'index change", () => {
    expect(generateMatchQuestion('seed_1', 0, 'mixte', 'intermediaire')).not.toEqual(
      generateMatchQuestion('seed_1', 1, 'mixte', 'intermediaire'),
    )
  })

  it('ne genere pas deux additions equivalentes par inversion des operandes', () => {
    expect(matchQuestionIdentity({ prompt: '1 + 2', operation: 'addition' })).toBe(
      matchQuestionIdentity({ prompt: '2 + 1', operation: 'addition' }),
    )
    expectUniqueCanonicalQuestions('addition_unique_seed', 50, 'addition', 'debutant')
  })

  it('ne genere pas deux multiplications equivalentes tant que le domaine debutant le permet', () => {
    expect(matchQuestionIdentity({ prompt: '2 x 5', operation: 'multiplication' })).toBe(
      matchQuestionIdentity({ prompt: '5 x 2', operation: 'multiplication' }),
    )
    expectUniqueCanonicalQuestions('multiplication_unique_seed', 10, 'multiplication', 'debutant')
  })
})
