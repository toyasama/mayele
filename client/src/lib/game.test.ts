import { describe, expect, it } from 'vitest'
import {
  calculateAccuracy,
  calculateElapsedSessionSeconds,
  calculateRemainingSessionSeconds,
  calculateSessionXpEstimate,
  getPlayerProgress,
  summarizeSkillPerformance,
  type AnswerResult,
} from './game'

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
