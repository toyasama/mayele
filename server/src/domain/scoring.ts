import type { GameLevel } from './constants.js'

const SCORE_BASE_BY_LEVEL: Record<GameLevel, number> = {
  debutant: 8,
  intermediaire: 10,
  avance: 13,
  expert: 16,
}

const SPEED_REFERENCE_MS_BY_LEVEL: Record<GameLevel, number> = {
  debutant: 6_000,
  intermediaire: 8_000,
  avance: 10_000,
  expert: 12_000,
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function calculateAnswerScorePoints(level: GameLevel, responseTimeMs: number, isCorrect: boolean) {
  if (!isCorrect) {
    return 0
  }

  const base = SCORE_BASE_BY_LEVEL[level]
  const referenceMs = SPEED_REFERENCE_MS_BY_LEVEL[level]
  const speedRatio = clampRatio(1 - Math.max(0, responseTimeMs) / referenceMs)
  const speedMultiplier = 0.7 + speedRatio * 0.3

  return Math.max(1, Math.round(base * speedMultiplier))
}

export function calculateSessionScorePoints(
  level: GameLevel,
  answers: Array<{ responseTimeMs: number; isCorrect: boolean }>,
) {
  return answers.reduce((sum, answer) => sum + calculateAnswerScorePoints(level, answer.responseTimeMs, answer.isCorrect), 0)
}
