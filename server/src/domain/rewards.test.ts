import { describe, expect, it } from 'vitest'
import { VALID_GAMES, type GameLevel } from './constants.js'
import {
  MISSION_CATALOG,
  MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS,
  MASTERY_MASTER_MIN_CORRECT_ANSWERS,
  buildBadgeStates,
  buildMissionStates,
  type BadgeProgressItem,
} from './rewards.js'

function masteryProgress(options: {
  level?: GameLevel
  bestScore: number
  bestCorrectAnswers: number
  hasQualifiedScore80: boolean
  hasQualifiedScore100: boolean
}): BadgeProgressItem[] {
  const level = options.level ?? 'debutant'

  return VALID_GAMES.map((game) => ({
    game,
    level,
    attempts: 1,
    bestScore: options.bestScore,
    bestCorrectAnswers: options.bestCorrectAnswers,
    bestStreak: options.bestCorrectAnswers,
    hasQualifiedScore80: options.hasQualifiedScore80,
    hasQualifiedScore100: options.hasQualifiedScore100,
    fastCorrectAnswers2500: 0,
    fastCorrectAnswers1800: 0,
    fastCorrectAnswers1200: 0,
  }))
}

describe('buildMissionStates', () => {
  it('exposes exactly three daily missions for the current day', () => {
    const missions = buildMissionStates(
      {
        todaySessions: 2,
        todayCorrectAnswers: 12,
      },
      [],
      '2026-07-01',
    )

    expect(MISSION_CATALOG).toHaveLength(3)
    expect(missions).toHaveLength(3)
    expect(missions.every((mission) => mission.scope === 'daily')).toBe(true)
    expect(missions.every((mission) => mission.scopeKey === '2026-07-01')).toBe(true)
  })
})

describe('buildBadgeStates', () => {
  it('does not unlock mastery badges from a perfect session with too few answers', () => {
    const badges = buildBadgeStates(
      masteryProgress({
        bestScore: 100,
        bestCorrectAnswers: MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS - 1,
        hasQualifiedScore80: false,
        hasQualifiedScore100: false,
      }),
    )

    const confirmedBadge = badges.find((badge) => badge.key === 'confirmed_debutant')
    const masterBadge = badges.find((badge) => badge.key === 'master_debutant')

    expect(confirmedBadge?.completed).toBe(false)
    expect(masterBadge?.completed).toBe(false)
    expect(confirmedBadge?.objectives[0].detail).toContain(
      `${MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS - 1}/${MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS}`,
    )
  })

  it('keeps the master badge locked until the higher perfect-session answer count is reached', () => {
    const badges = buildBadgeStates(
      masteryProgress({
        bestScore: 100,
        bestCorrectAnswers: MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS,
        hasQualifiedScore80: true,
        hasQualifiedScore100: false,
      }),
    )

    expect(badges.find((badge) => badge.key === 'confirmed_debutant')?.completed).toBe(true)
    expect(badges.find((badge) => badge.key === 'master_debutant')?.completed).toBe(false)
    expect(badges.find((badge) => badge.key === 'master_debutant')?.objectives[0].detail).toContain(
      `${MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS}/${MASTERY_MASTER_MIN_CORRECT_ANSWERS}`,
    )
  })

  it('unlocks mastery badges when the higher perfect-session requirement is reached', () => {
    const badges = buildBadgeStates(
      masteryProgress({
        bestScore: 100,
        bestCorrectAnswers: MASTERY_MASTER_MIN_CORRECT_ANSWERS,
        hasQualifiedScore80: true,
        hasQualifiedScore100: true,
      }),
    )

    expect(badges.find((badge) => badge.key === 'master_debutant')?.completed).toBe(true)
  })
})
