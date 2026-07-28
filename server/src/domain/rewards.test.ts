import { describe, expect, it } from 'vitest'
import { VALID_GAMES, type GameLevel } from './constants.js'
import {
  MISSION_CATALOG,
  MASTERY_ACCURACY_TARGETS,
  MASTERY_CADENCE_TARGETS,
  buildBadgeStates,
  buildMissionStates,
  selectDailyMissions,
  type BadgeProgressItem,
  type MasterySprintItem,
} from './rewards.js'

function badgeProgress(level: GameLevel = 'debutant'): BadgeProgressItem[] {
  return VALID_GAMES.map((game) => ({
    game,
    level,
    attempts: 1,
    bestStreak: 0,
    fastCorrectAnswers2500: 0,
    fastCorrectAnswers1800: 0,
    fastCorrectAnswers1200: 0,
  }))
}

function masterySprints(options: {
  level: GameLevel
  correctAnswers: number
  totalQuestions?: number
  durationSeconds: number
}): MasterySprintItem[] {
  return VALID_GAMES.map((game) => ({
    game,
    level: options.level,
    correctAnswers: options.correctAnswers,
    totalQuestions: options.totalQuestions ?? options.correctAnswers,
    durationSeconds: options.durationSeconds,
  }))
}

describe('buildMissionStates', () => {
  const stats = {
    todaySessions: 2,
    todayCorrectAnswers: 12,
    todayQuestionsAnswered: 18,
  }

  it('selects three daily missions from a larger catalog', () => {
    const missions = buildMissionStates(
      stats,
      [],
      '2026-07-01',
      'player_1',
    )

    expect(MISSION_CATALOG.length).toBeGreaterThan(3)
    expect(missions).toHaveLength(3)
    expect(new Set(missions.map((mission) => mission.key)).size).toBe(3)
    expect(missions.every((mission) => mission.scope === 'daily')).toBe(true)
    expect(missions.every((mission) => mission.scopeKey === '2026-07-01')).toBe(true)
  })

  it('is deterministic and idempotent for the same player and local day', () => {
    const firstSelection = selectDailyMissions('player_1', '2026-07-01').map((mission) => mission.key)
    const repeatedSelection = selectDailyMissions('player_1', '2026-07-01').map((mission) => mission.key)
    const firstState = buildMissionStates(stats, [], '2026-07-01', 'player_1')
    const repeatedState = buildMissionStates(stats, [], '2026-07-01', 'player_1')

    expect(repeatedSelection).toEqual(firstSelection)
    expect(repeatedState).toEqual(firstState)
  })

  it('rotates the selection and resets its scope on the next local day', () => {
    const firstDay = buildMissionStates(stats, [], '2026-07-01', 'player_1')
    const nextDay = buildMissionStates(
      { todaySessions: 0, todayCorrectAnswers: 0, todayQuestionsAnswered: 0 },
      [],
      '2026-07-02',
      'player_1',
    )

    expect(nextDay.map((mission) => mission.key)).not.toEqual(firstDay.map((mission) => mission.key))
    expect(nextDay.every((mission) => mission.scopeKey === '2026-07-02')).toBe(true)
    expect(nextDay.every((mission) => mission.current === 0 && !mission.completed && !mission.claimed)).toBe(true)
  })

  it('does not reclaim an existing completion when rebuilding the same day', () => {
    const selected = selectDailyMissions('player_1', '2026-07-01')
    const completedAt = new Date('2026-07-01T12:00:00.000Z')
    const missions = buildMissionStates(
      stats,
      [{ missionKey: selected[0].key, scopeKey: '2026-07-01', completedAt }],
      '2026-07-01',
      'player_1',
    )

    expect(missions[0]).toMatchObject({
      key: selected[0].key,
      completed: true,
      claimed: true,
      completedAt: completedAt.toISOString(),
    })
  })
})

describe('buildBadgeStates', () => {
  for (const level of ['debutant', 'intermediaire', 'avance', 'expert'] as const) {
    for (const durationSeconds of [60, 90, 120]) {
      it(`normalise la cadence par la durée pour ${level} en ${durationSeconds}s`, () => {
        const confirmedCorrectAnswers = Math.ceil(MASTERY_CADENCE_TARGETS.confirmed[level] * durationSeconds / 60)
        const masterCorrectAnswers = Math.ceil(MASTERY_CADENCE_TARGETS.master[level] * durationSeconds / 60)
        const confirmedBadges = buildBadgeStates(
          badgeProgress(level),
          masterySprints({ level, correctAnswers: confirmedCorrectAnswers, durationSeconds }),
        )
        const masterBadges = buildBadgeStates(
          badgeProgress(level),
          masterySprints({ level, correctAnswers: masterCorrectAnswers, durationSeconds }),
        )

        expect(confirmedBadges.find((badge) => badge.key === `confirmed_${level}`)?.completed).toBe(true)
        expect(masterBadges.find((badge) => badge.key === `master_${level}`)?.completed).toBe(true)
      })
    }
  }

  it('refuse une cadence juste sous le seuil même avec 100% de précision', () => {
    const cadenceTarget = MASTERY_CADENCE_TARGETS.confirmed.debutant
    const badges = buildBadgeStates(
      badgeProgress(),
      masterySprints({ level: 'debutant', correctAnswers: cadenceTarget - 1, durationSeconds: 60 }),
    )

    expect(badges.find((badge) => badge.key === 'confirmed_debutant')?.completed).toBe(false)
    expect(badges.find((badge) => badge.key === 'confirmed_debutant')?.objectives[0].detail).toContain(`11/${cadenceTarget} rép./min`)
  })

  it('vérifie la précision sans arrondir artificiellement 18/19 à 95%', () => {
    const correctAnswers = MASTERY_CADENCE_TARGETS.master.debutant
    const badges = buildBadgeStates(
      badgeProgress(),
      masterySprints({ level: 'debutant', correctAnswers, totalQuestions: 19, durationSeconds: 60 }),
    )

    expect(Math.round(correctAnswers * 100 / 19)).toBe(MASTERY_ACCURACY_TARGETS.master)
    const masterBadge = badges.find((badge) => badge.key === 'master_debutant')
    expect(masterBadge?.completed).toBe(false)
    expect(masterBadge?.objectives[0].detail).toContain('94,7%')
  })

  it('exige que la précision et la cadence soient atteintes dans le même Sprint', () => {
    const sessions = [
      ...masterySprints({ level: 'debutant', correctAnswers: 11, durationSeconds: 60 }),
      ...masterySprints({ level: 'debutant', correctAnswers: 12, totalQuestions: 16, durationSeconds: 60 }),
    ]
    const badges = buildBadgeStates(badgeProgress(), sessions)

    expect(badges.find((badge) => badge.key === 'confirmed_debutant')?.completed).toBe(false)
  })
})
