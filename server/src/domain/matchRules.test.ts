import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPO_QUESTION_SECONDS,
  MIN_TEMPO_QUESTION_SECONDS,
  buildChallengeConfig,
  determineMatchWinner,
} from './matchRules.js'

describe('buildChallengeConfig', () => {
  it('conserve uniquement les durees Sprint supportees par le salon', () => {
    expect(buildChallengeConfig({ challengeMode: 'sprint', durationSeconds: 60 })).toMatchObject({
      challengeMode: 'sprint',
      durationSeconds: 60,
      questionCount: null,
      perQuestionTimeLimitSeconds: null,
    })
    expect(buildChallengeConfig({ challengeMode: 'sprint', durationSeconds: 90 })).toMatchObject({
      challengeMode: 'sprint',
      durationSeconds: 90,
    })
    expect(buildChallengeConfig({ challengeMode: 'sprint', durationSeconds: 120 })).toMatchObject({
      challengeMode: 'sprint',
      durationSeconds: 120,
    })
  })

  it('rejette une duree totale Tempo si elle est envoyee comme duree Sprint', () => {
    expect(() => buildChallengeConfig({ challengeMode: 'sprint', durationSeconds: 100 })).toThrow('invalid_sprint_duration:100')
  })

  it('garde la duree totale Tempo separee de la duree Sprint', () => {
    expect(buildChallengeConfig({ challengeMode: 'tempo', questionCount: 10 })).toMatchObject({
      challengeMode: 'tempo',
      durationSeconds: 100,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 10,
    })
  })

  it('accepte tous les temps Tempo entre 5 et 30 secondes par question', () => {
    for (let seconds = MIN_TEMPO_QUESTION_SECONDS; seconds <= MAX_TEMPO_QUESTION_SECONDS; seconds += 1) {
      expect(buildChallengeConfig({
        challengeMode: 'tempo',
        questionCount: 10,
        perQuestionTimeLimitSeconds: seconds,
      })).toMatchObject({
        durationSeconds: 10 * seconds,
        questionCount: 10,
        perQuestionTimeLimitSeconds: seconds,
      })
    }
  })

  it('rejette les temps Tempo hors intervalle', () => {
    expect(() => buildChallengeConfig({
      challengeMode: 'tempo',
      questionCount: 10,
      perQuestionTimeLimitSeconds: MIN_TEMPO_QUESTION_SECONDS - 1,
    })).toThrow('invalid_tempo_question_seconds:4')
    expect(() => buildChallengeConfig({
      challengeMode: 'tempo',
      questionCount: 10,
      perQuestionTimeLimitSeconds: MAX_TEMPO_QUESTION_SECONDS + 1,
    })).toThrow('invalid_tempo_question_seconds:31')
  })
})

describe('determineMatchWinner', () => {
  it('ne designe pas de gagnant sur une egalite parfaite meme si un joueur termine avant', () => {
    const winner = determineMatchWinner([
      {
        playerId: 'player_a',
        scorePoints: 0,
        correctAnswers: 0,
        totalResponseTimeMs: 0,
        finishedAt: new Date('2026-07-09T10:00:00.000Z'),
      },
      {
        playerId: 'player_b',
        scorePoints: 0,
        correctAnswers: 0,
        totalResponseTimeMs: 0,
        finishedAt: new Date('2026-07-09T10:00:03.000Z'),
      },
    ])

    expect(winner).toBeNull()
  })

  it('ne departage pas une egalite de points avec les bonnes reponses ou le temps', () => {
    const winner = determineMatchWinner([
      {
        playerId: 'player_a',
        scorePoints: 8,
        correctAnswers: 1,
        totalResponseTimeMs: 800,
        finishedAt: new Date('2026-07-09T10:00:00.000Z'),
      },
      {
        playerId: 'player_b',
        scorePoints: 8,
        correctAnswers: 2,
        totalResponseTimeMs: 500,
        finishedAt: new Date('2026-07-09T10:00:03.000Z'),
      },
    ])

    expect(winner).toBeNull()
  })

  it('designe uniquement le joueur avec le plus de points', () => {
    const winner = determineMatchWinner([
      {
        playerId: 'player_a',
        scorePoints: 9,
        correctAnswers: 1,
        totalResponseTimeMs: 1200,
        finishedAt: new Date('2026-07-09T10:00:00.000Z'),
      },
      {
        playerId: 'player_b',
        scorePoints: 8,
        correctAnswers: 10,
        totalResponseTimeMs: 500,
        finishedAt: new Date('2026-07-09T10:00:03.000Z'),
      },
    ])

    expect(winner).toBe('player_a')
  })
})
