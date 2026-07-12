import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPO_QUESTION_SECONDS,
  MIN_TEMPO_QUESTION_SECONDS,
  SPRINT_DURATION_SECONDS_OPTIONS,
} from './challengeConfig'
import type { Question } from './game'
import {
  DEFAULT_SOLO_CHALLENGE_CONFIG,
  activeTimerSecondsForSoloConfig,
  createSoloSessionState,
  isSoloTempoComplete,
  normalizeSoloChallengeConfig,
  recordSoloAnswer,
  totalSecondsForSoloConfig,
} from './soloChallenge'

const question: Question = {
  prompt: '2 + 3',
  answer: 5,
  operation: 'addition',
  skill: 'addition',
}

describe('soloChallenge', () => {
  it('accepte toutes les durees Sprint partagees avec le multijoueur', () => {
    for (const duration of SPRINT_DURATION_SECONDS_OPTIONS) {
      const config = normalizeSoloChallengeConfig({
        ...DEFAULT_SOLO_CHALLENGE_CONFIG,
        mode: 'sprint',
        sprintDurationSeconds: duration,
      })

      expect(activeTimerSecondsForSoloConfig(config)).toBe(duration)
      expect(totalSecondsForSoloConfig(config)).toBe(duration)
    }
  })

  it('borne le temps Tempo par question entre 5 et 30 secondes', () => {
    expect(normalizeSoloChallengeConfig({
      ...DEFAULT_SOLO_CHALLENGE_CONFIG,
      mode: 'tempo',
      tempoQuestionSeconds: MIN_TEMPO_QUESTION_SECONDS - 1,
    }).tempoQuestionSeconds).toBe(MIN_TEMPO_QUESTION_SECONDS)

    expect(normalizeSoloChallengeConfig({
      ...DEFAULT_SOLO_CHALLENGE_CONFIG,
      mode: 'tempo',
      tempoQuestionSeconds: MAX_TEMPO_QUESTION_SECONDS + 1,
    }).tempoQuestionSeconds).toBe(MAX_TEMPO_QUESTION_SECONDS)
  })

  it('accepte chaque temps Tempo entier de 5 a 30 secondes', () => {
    for (let seconds = MIN_TEMPO_QUESTION_SECONDS; seconds <= MAX_TEMPO_QUESTION_SECONDS; seconds += 1) {
      const config = normalizeSoloChallengeConfig({
        ...DEFAULT_SOLO_CHALLENGE_CONFIG,
        mode: 'tempo',
        tempoQuestionSeconds: seconds,
      })

      expect(config.tempoQuestionSeconds).toBe(seconds)
      expect(activeTimerSecondsForSoloConfig(config)).toBe(seconds)
    }
  })

  it('utilise le temps par question comme timer actif Tempo et le produit comme duree totale', () => {
    const config = normalizeSoloChallengeConfig({
      ...DEFAULT_SOLO_CHALLENGE_CONFIG,
      mode: 'tempo',
      tempoQuestionCount: 12,
      tempoQuestionSeconds: 7,
    })

    expect(activeTimerSecondsForSoloConfig(config)).toBe(7)
    expect(totalSecondsForSoloConfig(config)).toBe(84)
  })

  it('enregistre une reponse Tempo immediate sans attendre la fin de la session', () => {
    const config = normalizeSoloChallengeConfig({
      ...DEFAULT_SOLO_CHALLENGE_CONFIG,
      mode: 'tempo',
      tempoQuestionCount: 2,
      tempoQuestionSeconds: 5,
      game: 'addition',
      level: 'debutant',
    })
    const state = recordSoloAnswer(createSoloSessionState(config), {
      question,
      userAnswer: 5,
      responseTimeMs: 120,
    })

    expect(state.activeQuestionIndex).toBe(1)
    expect(state.stats.totalQuestions).toBe(1)
    expect(state.stats.correctAnswers).toBe(1)
    expect(state.stats.currentStreak).toBe(1)
    expect(state.stats.scorePoints).toBeGreaterThan(0)
    expect(isSoloTempoComplete(state)).toBe(false)
  })

  it('represente un timeout vide par userAnswer null et termine Tempo a la derniere question', () => {
    const config = normalizeSoloChallengeConfig({
      ...DEFAULT_SOLO_CHALLENGE_CONFIG,
      mode: 'tempo',
      tempoQuestionCount: 10,
      tempoQuestionSeconds: 5,
      game: 'addition',
      level: 'debutant',
    })
    const lastQuestionState = {
      ...createSoloSessionState(config),
      activeQuestionIndex: config.tempoQuestionCount - 1,
    }
    const state = recordSoloAnswer(lastQuestionState, {
      question,
      userAnswer: null,
      responseTimeMs: 5_000,
    })

    expect(state.answers).toHaveLength(1)
    expect(state.answers[0]).toMatchObject({
      questionIndex: 9,
      userAnswer: null,
      isCorrect: false,
    })
    expect(state.stats.totalQuestions).toBe(1)
    expect(state.stats.correctAnswers).toBe(0)
    expect(isSoloTempoComplete(state)).toBe(true)
  })
})
