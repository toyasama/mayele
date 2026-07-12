export type ChallengeMode = 'sprint' | 'tempo'

export const SPRINT_DURATION_SECONDS_OPTIONS = [60, 90, 120] as const
export const DEFAULT_SPRINT_DURATION_SECONDS = SPRINT_DURATION_SECONDS_OPTIONS[0]

export const DEFAULT_TEMPO_QUESTION_COUNT = 30
export const MIN_TEMPO_QUESTION_COUNT = 10
export const MAX_TEMPO_QUESTION_COUNT = 50

export const DEFAULT_TEMPO_QUESTION_SECONDS = 10
export const MIN_TEMPO_QUESTION_SECONDS = 5
export const MAX_TEMPO_QUESTION_SECONDS = 30

export type SprintDurationSeconds = (typeof SPRINT_DURATION_SECONDS_OPTIONS)[number]

export function boundedInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

export function isSprintDurationSeconds(value: number): value is SprintDurationSeconds {
  return (SPRINT_DURATION_SECONDS_OPTIONS as readonly number[]).includes(value)
}

export function normalizeSprintDurationSeconds(value: number) {
  return isSprintDurationSeconds(value) ? value : DEFAULT_SPRINT_DURATION_SECONDS
}

export function normalizeTempoQuestionCount(value: number) {
  return boundedInteger(value, DEFAULT_TEMPO_QUESTION_COUNT, MIN_TEMPO_QUESTION_COUNT, MAX_TEMPO_QUESTION_COUNT)
}

export function normalizeTempoQuestionSeconds(value: number) {
  return boundedInteger(value, DEFAULT_TEMPO_QUESTION_SECONDS, MIN_TEMPO_QUESTION_SECONDS, MAX_TEMPO_QUESTION_SECONDS)
}
