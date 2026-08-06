import { describe, expect, it } from 'vitest'
import {
  MISSION_CATALOG,
  MISSION_FAMILIES,
  MISSION_TIERS,
  buildMissionStates,
  missionCurrentValue,
  selectDailyMissions,
  type MissionDefinition,
  type MissionSessionFact,
} from './dailyMissions.js'

function matchingFact(definition: MissionDefinition, overrides: Partial<MissionSessionFact> = {}): MissionSessionFact {
  return {
    id: overrides.id ?? 'session-1',
    playContext: definition.requirements.playContext,
    challengeMode: definition.requirements.challengeMode,
    game: definition.requirements.game ?? definition.launchConfig.game,
    level: definition.requirements.level,
    configuredDurationSeconds: definition.requirements.challengeMode === 'sprint'
      ? definition.launchConfig.sprintDurationSeconds
      : null,
    configuredQuestionCount: definition.requirements.challengeMode === 'tempo'
      ? definition.launchConfig.tempoQuestionCount
      : null,
    configuredQuestionSeconds: definition.requirements.challengeMode === 'tempo'
      ? definition.launchConfig.tempoQuestionSeconds
      : null,
    validAnswers: 30,
    correctAnswers: 27,
    totalQuestions: 30,
    bestStreak: 12,
    ...overrides,
  }
}

describe('daily mission catalog V2', () => {
  it('contains exactly 180 semantic and unique mission keys', () => {
    expect(MISSION_CATALOG).toHaveLength(180)
    expect(new Set(MISSION_CATALOG.map((mission) => mission.key)).size).toBe(180)
    expect(MISSION_CATALOG.every((mission) => mission.key.startsWith('daily-v2_'))).toBe(true)
  })

  it('contains 60 missions per tier with increasing XP', () => {
    expect(MISSION_TIERS.map((tier) => MISSION_CATALOG.filter((mission) => mission.tier === tier).length)).toEqual([60, 60, 60])
    expect(MISSION_TIERS.map((tier) => new Set(MISSION_CATALOG.filter((mission) => mission.tier === tier).map((mission) => mission.rewardXp)))).toEqual([
      new Set([40]),
      new Set([80]),
      new Set([140]),
    ])
  })

  it('applies the exact tier level bands, presets and Solo/multiplayer targets', () => {
    const expectedLevels = {
      easy: new Set(['debutant', 'intermediaire']),
      medium: new Set(['intermediaire', 'avance']),
      hard: new Set(['avance', 'expert']),
    }
    const sprintPresets = {
      easy: new Set([60, 90]),
      medium: new Set([60, 90, 120]),
      hard: new Set([90, 120]),
    }
    const tempoPresets = {
      easy: new Set(['10:20', '20:20', '30:15']),
      medium: new Set(['20:15', '30:12', '40:10']),
      hard: new Set(['30:10', '40:8', '50:5']),
    }
    const targets = {
      easy: {
        solo: { sessions: 1, valid_answers: 10, correct_answers: 8, accuracy: 80, streak: 5, diversity: 2, accuracyMinimum: 10 },
        multiplayer: { sessions: 1, valid_answers: 10, correct_answers: 8, accuracy: 75, streak: 4, diversity: 2, accuracyMinimum: 8 },
      },
      medium: {
        solo: { sessions: 2, valid_answers: 30, correct_answers: 24, accuracy: 90, streak: 10, diversity: 3, accuracyMinimum: 15 },
        multiplayer: { sessions: 1, valid_answers: 20, correct_answers: 16, accuracy: 85, streak: 8, diversity: 2, accuracyMinimum: 12 },
      },
      hard: {
        solo: { sessions: 3, valid_answers: 60, correct_answers: 50, accuracy: 95, streak: 20, diversity: 4, accuracyMinimum: 20 },
        multiplayer: { sessions: 2, valid_answers: 35, correct_answers: 30, accuracy: 95, streak: 12, diversity: 3, accuracyMinimum: 15 },
      },
    } as const

    for (const mission of MISSION_CATALOG) {
      expect(expectedLevels[mission.tier].has(mission.requirements.level)).toBe(true)
      if (mission.requirements.challengeMode === 'sprint') {
        expect(sprintPresets[mission.tier].has(mission.launchConfig.sprintDurationSeconds!)).toBe(true)
      } else {
        expect(tempoPresets[mission.tier].has(
          `${mission.launchConfig.tempoQuestionCount}:${mission.launchConfig.tempoQuestionSeconds}`,
        )).toBe(true)
      }

      const expected = targets[mission.tier][mission.requirements.playContext]
      expect(mission.target).toBe(expected[mission.family])
      expect(mission.minimumValidAnswers).toBe(mission.family === 'accuracy' ? expected.accuracyMinimum : 1)
      if (mission.requirements.diversityKind === 'configurations') {
        expect(mission.requirements.recognizedConfigurationKeys.length).toBeGreaterThanOrEqual(mission.target)
      }
    }
  })

  it('balances Solo, multiplayer, Sprint, Tempo and every objective family', () => {
    expect(MISSION_CATALOG.filter((mission) => mission.requirements.playContext === 'solo')).toHaveLength(120)
    expect(MISSION_CATALOG.filter((mission) => mission.requirements.playContext === 'multiplayer')).toHaveLength(60)
    expect(MISSION_CATALOG.filter((mission) => mission.requirements.challengeMode === 'sprint')).toHaveLength(90)
    expect(MISSION_CATALOG.filter((mission) => mission.requirements.challengeMode === 'tempo')).toHaveLength(90)
    expect(['addition', 'soustraction', 'multiplication', 'division', 'mixte'].map((game) =>
      MISSION_CATALOG.filter((mission) => mission.launchConfig.game === game).length,
    )).toEqual([36, 36, 36, 36, 36])

    const expectedPerTier: Record<(typeof MISSION_FAMILIES)[number], number> = {
      sessions: 16,
      valid_answers: 12,
      correct_answers: 12,
      accuracy: 8,
      streak: 6,
      diversity: 6,
    }

    for (const tier of MISSION_TIERS) {
      for (const family of MISSION_FAMILIES) {
        expect(MISSION_CATALOG.filter((mission) => mission.tier === tier && mission.family === family)).toHaveLength(expectedPerTier[family])
      }
    }
  })

  it('selects one mission per tier deterministically with distinct families and at most one multiplayer mission', () => {
    let foundSingleModeDay = false

    for (let dayIndex = 1; dayIndex <= 90; dayIndex += 1) {
      const day = `2026-09-${String(((dayIndex - 1) % 30) + 1).padStart(2, '0')}:${Math.floor(dayIndex / 30)}`
      const selected = selectDailyMissions('player-1', day)
      const repeated = selectDailyMissions('player-1', day)

      expect(selected.map((mission) => mission.key)).toEqual(repeated.map((mission) => mission.key))
      expect(selected.map((mission) => mission.tier)).toEqual(MISSION_TIERS)
      expect(new Set(selected.map((mission) => mission.family)).size).toBe(3)
      expect(selected.filter((mission) => mission.requirements.playContext === 'multiplayer').length).toBeLessThanOrEqual(1)
      foundSingleModeDay ||= new Set(selected.map((mission) => mission.requirements.challengeMode)).size === 1
      const primaryMissions = selected.filter((mission) => mission.family !== 'diversity')
      for (let leftIndex = 0; leftIndex < primaryMissions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < primaryMissions.length; rightIndex += 1) {
          const left = primaryMissions[leftIndex]
          const right = primaryMissions[rightIndex]
          expect([
            left.requirements.playContext,
            left.requirements.challengeMode,
            left.requirements.level,
            left.requirements.game,
          ]).not.toEqual([
            right.requirements.playContext,
            right.requirements.challengeMode,
            right.requirements.level,
            right.requirements.game,
          ])
        }
      }
    }

    expect(foundSingleModeDay).toBe(true)
  })

  it('accepts higher Sprint duration and higher Tempo volume with a shorter question timer', () => {
    const sprint = MISSION_CATALOG.find((mission) => mission.family === 'sessions' && mission.requirements.challengeMode === 'sprint')!
    const tempo = MISSION_CATALOG.find((mission) => mission.family === 'sessions' && mission.requirements.challengeMode === 'tempo')!

    expect(missionCurrentValue(sprint, [matchingFact(sprint, {
      configuredDurationSeconds: (sprint.requirements.minSprintDurationSeconds ?? 0) + 30,
    })])).toBe(1)
    expect(missionCurrentValue(sprint, [matchingFact(sprint, {
      configuredDurationSeconds: (sprint.requirements.minSprintDurationSeconds ?? 0) - 1,
    })])).toBe(0)
    expect(missionCurrentValue(tempo, [matchingFact(tempo, {
      configuredQuestionCount: (tempo.requirements.minTempoQuestionCount ?? 0) + 10,
      configuredQuestionSeconds: Math.max(5, (tempo.requirements.maxTempoQuestionSeconds ?? 30) - 1),
    })])).toBe(1)
    expect(missionCurrentValue(tempo, [matchingFact(tempo, {
      configuredQuestionSeconds: (tempo.requirements.maxTempoQuestionSeconds ?? 0) + 1,
    })])).toBe(0)
    expect(missionCurrentValue(tempo, [matchingFact(tempo, {
      configuredQuestionCount: (tempo.requirements.minTempoQuestionCount ?? 0) - 1,
    })])).toBe(0)
  })

  it('evaluates volume, accuracy, streak and claimed completion from eligible facts', () => {
    const validAnswers = MISSION_CATALOG.find((mission) => mission.family === 'valid_answers')!
    const correctAnswers = MISSION_CATALOG.find((mission) => mission.family === 'correct_answers')!
    const accuracy = MISSION_CATALOG.find((mission) => mission.family === 'accuracy')!
    const streak = MISSION_CATALOG.find((mission) => mission.family === 'streak')!
    const day = '2026-08-06'

    expect(missionCurrentValue(validAnswers, [matchingFact(validAnswers, { validAnswers: 7 }), matchingFact(validAnswers, { id: 'session-2', validAnswers: 9 })])).toBe(16)
    expect(missionCurrentValue(correctAnswers, [matchingFact(correctAnswers, { correctAnswers: 6 }), matchingFact(correctAnswers, { id: 'session-2', correctAnswers: 7 })])).toBe(13)
    expect(missionCurrentValue(accuracy, [matchingFact(accuracy, {
      validAnswers: accuracy.minimumValidAnswers,
      correctAnswers: 19,
      totalQuestions: 20,
    })])).toBe(95)
    expect(missionCurrentValue(streak, [matchingFact(streak, { bestStreak: 3 }), matchingFact(streak, { id: 'session-2', bestStreak: 11 })])).toBe(11)

    expect(missionCurrentValue(accuracy, [matchingFact(accuracy, {
      validAnswers: accuracy.minimumValidAnswers - 1,
      correctAnswers: 30,
      totalQuestions: 30,
    })])).toBe(0)

    const accuracy95 = MISSION_CATALOG.find((mission) => mission.family === 'accuracy' && mission.target === 95)!
    const nearAccuracyFact = matchingFact(accuracy95, { validAnswers: 99, correctAnswers: 94, totalQuestions: 99 })
    expect(missionCurrentValue(accuracy95, [nearAccuracyFact])).toBe(94.9)
    expect(buildMissionStates([accuracy95], [nearAccuracyFact], [], day)[0].completed).toBe(false)

    const completedAt = new Date('2026-08-06T12:00:00.000Z')
    const [state] = buildMissionStates(
      [validAnswers],
      [],
      [{ missionKey: validAnswers.key, scopeKey: day, completedAt }],
      day,
    )
    expect(state).toMatchObject({ completed: true, claimed: true, current: validAnswers.target, completedAt: completedAt.toISOString() })
  })

  it('counts only recognized presets for configuration-diversity missions', () => {
    const diversity = MISSION_CATALOG.find((mission) =>
      mission.family === 'diversity' && mission.requirements.diversityKind === 'configurations' && mission.requirements.challengeMode === 'sprint',
    )!

    expect(missionCurrentValue(diversity, [
      matchingFact(diversity, { id: 's60', configuredDurationSeconds: 60 }),
      matchingFact(diversity, { id: 's61', configuredDurationSeconds: 61 }),
      matchingFact(diversity, { id: 's90', configuredDurationSeconds: 90 }),
    ])).toBe(2)
  })

  it('counts distinct calculation types, not repeated games, for game-diversity missions', () => {
    const diversity = MISSION_CATALOG.find((mission) =>
      mission.family === 'diversity' && mission.requirements.diversityKind === 'games',
    )!

    expect(missionCurrentValue(diversity, [
      matchingFact(diversity, { id: 'addition-1', game: 'addition' }),
      matchingFact(diversity, { id: 'addition-2', game: 'addition' }),
      matchingFact(diversity, { id: 'division-1', game: 'division' }),
    ])).toBe(2)
  })
})
