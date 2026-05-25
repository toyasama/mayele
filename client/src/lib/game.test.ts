import { describe, expect, it } from 'vitest'
import {
  calculateAccuracy,
  calculateQuestionPoints,
  generateQuestion,
  summarizeSkillPerformance,
  type AnswerResult,
  type GameLevel,
} from './game'

describe('generateQuestion', () => {
  it('generates integer division questions for every level', () => {
    const levels: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']

    levels.forEach((level) => {
      for (let index = 0; index < 25; index += 1) {
        const question = generateQuestion('division', level)
        const [dividend, divisor] = question.prompt.split(' ÷ ').map(Number)

        expect(question.operation).toBe('division')
        expect(question.skill).toBe('division')
        expect(Number.isInteger(question.answer)).toBe(true)
        expect(dividend / divisor).toBe(question.answer)
      }
    })
  })

  it('uses all operation families in mixte mode', () => {
    const operations = new Set<string>()

    for (let index = 0; index < 100; index += 1) {
      operations.add(generateQuestion('mixte', 'intermediaire').operation)
    }

    expect(operations.has('addition')).toBe(true)
    expect(operations.has('soustraction')).toBe(true)
    expect(operations.has('multiplication')).toBe(true)
    expect(operations.has('division')).toBe(true)
  })

  it('can target a weak skill', () => {
    const question = generateQuestion('mixte', 'debutant', 'tables')

    expect(question.operation).toBe('multiplication')
    expect(question.skill).toBe('tables')
  })
})

describe('scoring and diagnostics', () => {
  it('calculates accuracy and streak-based points', () => {
    expect(calculateAccuracy(7, 10)).toBe(70)
    expect(calculateAccuracy(0, 0)).toBe(0)
    expect(calculateQuestionPoints('avance', 4)).toBe(26)
  })

  it('sorts skill performance from weakest to strongest', () => {
    const answers: AnswerResult[] = [
      {
        prompt: '6 × 7',
        correctAnswer: 42,
        userAnswer: 41,
        responseTimeMs: 1200,
        isCorrect: false,
        game: 'multiplication',
        level: 'intermediaire',
        skill: 'tables',
      },
      {
        prompt: '8 × 8',
        correctAnswer: 64,
        userAnswer: 64,
        responseTimeMs: 900,
        isCorrect: true,
        game: 'multiplication',
        level: 'intermediaire',
        skill: 'tables',
      },
      {
        prompt: '18 ÷ 3',
        correctAnswer: 6,
        userAnswer: 6,
        responseTimeMs: 800,
        isCorrect: true,
        game: 'division',
        level: 'debutant',
        skill: 'division',
      },
    ]

    const performance = summarizeSkillPerformance(answers)

    expect(performance[0]).toMatchObject({ skill: 'tables', attempts: 2, correctAnswers: 1, accuracy: 50 })
    expect(performance[1]).toMatchObject({ skill: 'division', attempts: 1, correctAnswers: 1, accuracy: 100 })
  })
})
