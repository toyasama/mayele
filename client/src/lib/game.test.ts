import { describe, expect, it, vi } from 'vitest'
import {
  calculateAccuracy,
  calculateElapsedSessionSeconds,
  calculateRemainingSessionSeconds,
  calculateSessionXpEstimate,
  generateQuestion,
  generateUniqueQuestion,
  getPlayerProgress,
  questionIdentity,
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

  it('donne la meme identite aux calculs commutatifs inverses', () => {
    expect(questionIdentity({ operation: 'addition', prompt: '1 + 2' })).toBe(
      questionIdentity({ operation: 'addition', prompt: '2 + 1' }),
    )
    expect(questionIdentity({ operation: 'multiplication', prompt: '3 × 4' })).toBe(
      questionIdentity({ operation: 'multiplication', prompt: '4 × 3' }),
    )
    expect(questionIdentity({ operation: 'soustraction', prompt: '4 - 3' })).not.toBe(
      questionIdentity({ operation: 'soustraction', prompt: '3 - 4' }),
    )
  })

  it('saute les calculs commutatifs deja vus dans une session solo', () => {
    const randomValues = [0, 0.05, 0.05, 0, 0.1, 0.15]
    let randomIndex = 0
    vi.spyOn(Math, 'random').mockImplementation(() => randomValues[randomIndex++] ?? 0.2)

    try {
      const usedQuestionKeys = new Set([questionIdentity({ operation: 'addition', prompt: '1 + 2' })])
      const question = generateUniqueQuestion('addition', 'debutant', null, usedQuestionKeys)

      expect(question.prompt).toBe('3 + 4')
      expect(questionIdentity(question)).not.toBe(questionIdentity({ operation: 'addition', prompt: '2 + 1' }))
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('scoring and diagnostics', () => {
  it('calculates accuracy, session XP and player progression', () => {
    expect(calculateAccuracy(7, 10)).toBe(70)
    expect(calculateAccuracy(0, 0)).toBe(0)
    expect(calculateSessionXpEstimate('avance', 8, 10, 5)).toBe(107)
    expect(getPlayerProgress(120)).toMatchObject({ level: 2, nextLevel: 3, totalXp: 120 })
  })

  it('calculates remaining sprint time from the wall clock', () => {
    expect(calculateRemainingSessionSeconds(70_000, 21_500)).toBe(49)
    expect(calculateRemainingSessionSeconds(70_000, 70_000)).toBe(0)
    expect(calculateRemainingSessionSeconds(70_000, 80_000)).toBe(0)
  })

  it('calculates elapsed sprint time from the authoritative start time', () => {
    expect(calculateElapsedSessionSeconds(10_000, 10_000)).toBe(1)
    expect(calculateElapsedSessionSeconds(10_000, 15_400)).toBe(5)
    expect(calculateElapsedSessionSeconds(10_000, 15_600)).toBe(6)
    expect(calculateElapsedSessionSeconds(20_000, 10_000)).toBe(1)
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
