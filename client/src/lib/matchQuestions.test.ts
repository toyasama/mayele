import { describe, expect, it } from 'vitest'
import { generateMatchQuestion, matchQuestionIdentity, solveDisplayedQuestion } from './matchQuestions'
import type { GameLevel, GameType } from './game'

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
  it.each([
    ['addition', '12 + 7', 19],
    ['soustraction', '20 - 8', 12],
    ['multiplication', '6 x 7', 42],
    ['division', '36 / 6', 6],
  ] as const)('resout localement la question %s affichee sans exposer les suivantes', (operation, prompt, answer) => {
    expect(solveDisplayedQuestion({ operation, prompt })).toBe(answer)
  })

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

  it('couvre les tables de 2 a 10 sans doublon avant de recommencer un cycle', () => {
    expect(matchQuestionIdentity({ prompt: '2 x 5', operation: 'multiplication' })).toBe(
      matchQuestionIdentity({ prompt: '5 x 2', operation: 'multiplication' }),
    )
    expectUniqueCanonicalQuestions('multiplication_unique_seed', 45, 'multiplication', 'debutant')

    const identities = new Set(
      Array.from({ length: 45 }, (_, index) => matchQuestionIdentity(
        generateMatchQuestion('multiplication_complete_deck', index, 'multiplication', 'debutant'),
      )),
    )

    expect(identities).toContain('multiplication:8:9')
    expect(identities.size).toBe(45)
  })

  it('equilibre strictement les operations du mode mixte par blocs de quatre', () => {
    const counts = new Map<string, number>()

    for (let index = 0; index < 120; index += 1) {
      const operation = generateMatchQuestion('balanced-mixed', index, 'mixte', 'debutant').operation
      counts.set(operation, (counts.get(operation) ?? 0) + 1)
    }

    expect(Object.fromEntries(counts)).toEqual({
      addition: 30,
      soustraction: 30,
      multiplication: 30,
      division: 30,
    })
  })

  it('equilibre les nombres de gauche des soustractions', () => {
    const counts = new Map<number, number>()

    for (let index = 0; index < 104; index += 1) {
      const question = generateMatchQuestion('balanced-subtractions', index, 'soustraction', 'debutant')
      const [left, right] = question.prompt.split(' - ').map(Number)

      expect(left).toBeGreaterThanOrEqual(5)
      expect(left).toBeLessThanOrEqual(30)
      expect(right).toBeGreaterThanOrEqual(2)
      expect(right).toBeLessThanOrEqual(left)
      counts.set(left, (counts.get(left) ?? 0) + 1)
    }

    expect(counts.size).toBe(26)
    expect(new Set(counts.values())).toEqual(new Set([4]))
  })
})
