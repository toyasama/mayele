import { describe, expect, it } from 'vitest'
import type { MatchData } from './api'
import {
  completeConfigPayload,
  DEFAULT_ROOM_CONFIG,
  MAX_TEMPO_QUESTION_SECONDS,
  matchToConfig,
  MIN_TEMPO_QUESTION_SECONDS,
  normalizeRoomConfig,
  roomConfigPayload,
  type RoomConfig,
} from './multiplayerConfig'

describe('multiplayerConfig', () => {
  it('ne reutilise pas la duree totale Tempo comme duree Sprint locale', () => {
    const config = matchToConfig({
      challengeMode: 'tempo',
      game: 'addition',
      level: 'debutant',
      durationSeconds: 100,
      questionCount: 10,
    } as MatchData)

    expect(config).toMatchObject({
      challengeMode: 'tempo',
      durationSeconds: DEFAULT_ROOM_CONFIG.durationSeconds,
      questionCount: 10,
      perQuestionTimeLimitSeconds: DEFAULT_ROOM_CONFIG.perQuestionTimeLimitSeconds,
    })
  })

  it('normalise une duree Sprint qui ne fait pas partie des options du salon', () => {
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      challengeMode: 'sprint',
      game: 'addition',
      level: 'debutant',
      durationSeconds: 100,
    }

    expect(normalizeRoomConfig(config).durationSeconds).toBe(60)
    expect(completeConfigPayload(config)).toMatchObject({
      challengeMode: 'sprint',
      durationSeconds: 60,
    })
  })

  it('accepte tous les temps Tempo entre 5 et 30 secondes par question', () => {
    for (let seconds = MIN_TEMPO_QUESTION_SECONDS; seconds <= MAX_TEMPO_QUESTION_SECONDS; seconds += 1) {
      const config = normalizeRoomConfig({
        ...DEFAULT_ROOM_CONFIG,
        challengeMode: 'tempo',
        game: 'addition',
        level: 'debutant',
        perQuestionTimeLimitSeconds: seconds,
      })

      expect(config.perQuestionTimeLimitSeconds).toBe(seconds)
      expect(completeConfigPayload(config)).toMatchObject({
        challengeMode: 'tempo',
        questionCount: DEFAULT_ROOM_CONFIG.questionCount,
        perQuestionTimeLimitSeconds: seconds,
      })
    }
  })

  it('borne les temps Tempo hors intervalle avant emission client', () => {
    expect(normalizeRoomConfig({
      ...DEFAULT_ROOM_CONFIG,
      perQuestionTimeLimitSeconds: MIN_TEMPO_QUESTION_SECONDS - 1,
    }).perQuestionTimeLimitSeconds).toBe(MIN_TEMPO_QUESTION_SECONDS)

    expect(normalizeRoomConfig({
      ...DEFAULT_ROOM_CONFIG,
      perQuestionTimeLimitSeconds: MAX_TEMPO_QUESTION_SECONDS + 1,
    }).perQuestionTimeLimitSeconds).toBe(MAX_TEMPO_QUESTION_SECONDS)
  })

  it('ne transporte pas les champs inactifs entre Sprint et Tempo', () => {
    expect(roomConfigPayload({
      ...DEFAULT_ROOM_CONFIG,
      challengeMode: 'tempo',
      game: 'addition',
      level: 'debutant',
      durationSeconds: 90,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 5,
    })).toMatchObject({
      challengeMode: 'tempo',
      durationSeconds: undefined,
      questionCount: 10,
      perQuestionTimeLimitSeconds: 5,
    })

    expect(roomConfigPayload({
      ...DEFAULT_ROOM_CONFIG,
      challengeMode: 'sprint',
      game: 'addition',
      level: 'debutant',
      durationSeconds: 90,
      questionCount: 50,
      perQuestionTimeLimitSeconds: 30,
    })).toMatchObject({
      challengeMode: 'sprint',
      durationSeconds: 90,
      questionCount: undefined,
      perQuestionTimeLimitSeconds: undefined,
    })
  })
})
