import type { GameLevel } from './constants.js'

export const PLAYER_MAX_LEVEL = 100

const LEVEL_XP_BASE: Record<GameLevel, number> = {
  debutant: 4,
  intermediaire: 7,
  avance: 11,
  expert: 16,
}

const LEVEL_XP_CAP: Record<GameLevel, number> = {
  debutant: 180,
  intermediaire: 280,
  avance: 420,
  expert: 600,
}

function clampLevel(level: number) {
  return Math.max(1, Math.min(PLAYER_MAX_LEVEL, Math.floor(level)))
}

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions <= 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

function accuracyMultiplier(accuracy: number, totalQuestions: number) {
  if (totalQuestions < 5) {
    return 1
  }

  if (accuracy === 100) {
    return 1.35
  }

  if (accuracy >= 90) {
    return 1.2
  }

  if (accuracy >= 80) {
    return 1.1
  }

  return 1
}

function streakBonus(bestStreak: number) {
  if (bestStreak >= 20) {
    return 80
  }

  if (bestStreak >= 10) {
    return 30
  }

  if (bestStreak >= 5) {
    return 10
  }

  return 0
}

export function calculateSessionXp(options: {
  level: GameLevel
  correctAnswers: number
  totalQuestions: number
  bestStreak: number
}) {
  if (options.correctAnswers <= 0 || options.totalQuestions <= 0) {
    return 0
  }

  const accuracy = calculateAccuracy(options.correctAnswers, options.totalQuestions)
  const baseXp = options.correctAnswers * LEVEL_XP_BASE[options.level]
  const xp = Math.round(baseXp * accuracyMultiplier(accuracy, options.totalQuestions) + streakBonus(options.bestStreak))

  return Math.min(LEVEL_XP_CAP[options.level], xp)
}

export function xpRequiredForLevel(level: number) {
  const safeLevel = clampLevel(level)

  if (safeLevel <= 1) {
    return 0
  }

  return Math.round(120 * Math.pow(safeLevel - 1, 1.85))
}

export function getPlayerProgress(totalXp: number) {
  const safeTotalXp = Math.max(0, Math.floor(totalXp))
  let level = 1

  for (let candidate = 2; candidate <= PLAYER_MAX_LEVEL; candidate += 1) {
    if (safeTotalXp < xpRequiredForLevel(candidate)) {
      break
    }

    level = candidate
  }

  const currentLevelXp = xpRequiredForLevel(level)
  const nextLevel = level < PLAYER_MAX_LEVEL ? level + 1 : null
  const nextLevelXp = nextLevel ? xpRequiredForLevel(nextLevel) : currentLevelXp
  const xpIntoLevel = Math.max(0, safeTotalXp - currentLevelXp)
  const xpForNextLevel = nextLevel ? Math.max(1, nextLevelXp - currentLevelXp) : 0
  const xpRemaining = nextLevel ? Math.max(0, nextLevelXp - safeTotalXp) : 0
  const progress = nextLevel ? Math.round((xpIntoLevel / xpForNextLevel) * 100) : 100

  return {
    level,
    maxLevel: PLAYER_MAX_LEVEL,
    totalXp: safeTotalXp,
    currentLevelXp,
    nextLevel,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    xpRemaining,
    progress,
    isMaxLevel: level >= PLAYER_MAX_LEVEL,
  }
}
