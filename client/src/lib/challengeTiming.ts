import { DEFAULT_SPRINT_DURATION_SECONDS, DEFAULT_TEMPO_QUESTION_SECONDS } from './challengeConfig'

export const SPRINT_SESSION_SECONDS = DEFAULT_SPRINT_DURATION_SECONDS
export const TEMPO_RESPONSE_SECONDS = DEFAULT_TEMPO_QUESTION_SECONDS
export const CRITICAL_REMAINING_RATIO = 0.3

export function criticalRemainingSeconds(totalSeconds: number) {
  return Math.ceil(Math.max(1, totalSeconds) * CRITICAL_REMAINING_RATIO)
}

export function isCriticalRemainingTime(totalSeconds: number, remainingSeconds: number) {
  return remainingSeconds <= criticalRemainingSeconds(totalSeconds)
}
