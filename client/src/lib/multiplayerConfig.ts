import type { ChallengeMode, MatchData } from './api'
import {
  DEFAULT_SPRINT_DURATION_SECONDS,
  DEFAULT_TEMPO_QUESTION_COUNT,
  DEFAULT_TEMPO_QUESTION_SECONDS,
  normalizeSprintDurationSeconds,
  normalizeTempoQuestionCount,
  normalizeTempoQuestionSeconds,
} from './challengeConfig'
import type { GameLevel, GameType } from './game'

export {
  DEFAULT_TEMPO_QUESTION_SECONDS,
  MAX_TEMPO_QUESTION_SECONDS,
  MIN_TEMPO_QUESTION_SECONDS,
  SPRINT_DURATION_SECONDS_OPTIONS,
} from './challengeConfig'

export type RoomConfig = {
  game: GameType | null
  level: GameLevel | null
  challengeMode: ChallengeMode | null
  durationSeconds: number
  questionCount: number
  perQuestionTimeLimitSeconds: number
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  game: null,
  level: null,
  challengeMode: null,
  durationSeconds: DEFAULT_SPRINT_DURATION_SECONDS,
  questionCount: DEFAULT_TEMPO_QUESTION_COUNT,
  perQuestionTimeLimitSeconds: DEFAULT_TEMPO_QUESTION_SECONDS,
}

export function normalizeRoomConfig(value: RoomConfig): RoomConfig {
  return {
    ...value,
    durationSeconds: normalizeSprintDurationSeconds(value.durationSeconds),
    questionCount: normalizeTempoQuestionCount(value.questionCount),
    perQuestionTimeLimitSeconds: normalizeTempoQuestionSeconds(value.perQuestionTimeLimitSeconds),
  }
}

export function matchToConfig(match: MatchData): RoomConfig {
  return normalizeRoomConfig({
    game: match.game as GameType | null,
    level: match.level as GameLevel | null,
    challengeMode: match.challengeMode,
    durationSeconds: match.challengeMode === 'sprint' ? match.durationSeconds : DEFAULT_ROOM_CONFIG.durationSeconds,
    questionCount: match.challengeMode === 'tempo' ? match.questionCount ?? DEFAULT_ROOM_CONFIG.questionCount : DEFAULT_ROOM_CONFIG.questionCount,
    perQuestionTimeLimitSeconds: match.challengeMode === 'tempo'
      ? match.perQuestionTimeLimitSeconds ?? DEFAULT_ROOM_CONFIG.perQuestionTimeLimitSeconds
      : DEFAULT_ROOM_CONFIG.perQuestionTimeLimitSeconds,
  })
}

export function isCompleteConfig(value: RoomConfig) {
  return Boolean(value.game && value.level && value.challengeMode)
}

export function roomConfigPayload(value: RoomConfig) {
  const normalizedConfig = normalizeRoomConfig(value)

  return {
    game: normalizedConfig.game,
    level: normalizedConfig.level,
    practiceSkill: null,
    challengeMode: normalizedConfig.challengeMode,
    durationSeconds: normalizedConfig.challengeMode === 'sprint' ? normalizedConfig.durationSeconds : undefined,
    questionCount: normalizedConfig.challengeMode === 'tempo' ? normalizedConfig.questionCount : undefined,
    perQuestionTimeLimitSeconds: normalizedConfig.challengeMode === 'tempo' ? normalizedConfig.perQuestionTimeLimitSeconds : undefined,
  }
}

export function completeConfigPayload(value: RoomConfig) {
  const normalizedConfig = normalizeRoomConfig(value)

  if (!normalizedConfig.game || !normalizedConfig.level || !normalizedConfig.challengeMode) {
    return null
  }

  return {
    game: normalizedConfig.game,
    level: normalizedConfig.level,
    practiceSkill: null,
    challengeMode: normalizedConfig.challengeMode,
    durationSeconds: normalizedConfig.challengeMode === 'sprint' ? normalizedConfig.durationSeconds : undefined,
    questionCount: normalizedConfig.challengeMode === 'tempo' ? normalizedConfig.questionCount : undefined,
    perQuestionTimeLimitSeconds: normalizedConfig.challengeMode === 'tempo' ? normalizedConfig.perQuestionTimeLimitSeconds : undefined,
  }
}
