import { describe, expect, it } from 'vitest'
import {
  MIN_VALID_ANSWERS_PER_MISSION_SESSION,
  completedMatchForDailyMissions,
  completedSoloRunForDailyMissions,
  countValidMissionAnswers,
  qualifiesForDailyMissions,
} from './dailyMissionEligibility.js'

describe('daily mission eligibility', () => {
  it('counts only answers actually submitted by the player', () => {
    expect(countValidMissionAnswers([
      { userAnswer: 12 },
      { userAnswer: null },
      { userAnswer: 0 },
    ])).toBe(2)
  })

  it('requires at least one valid answer in a completed game', () => {
    expect(MIN_VALID_ANSWERS_PER_MISSION_SESSION).toBe(1)
    expect(qualifiesForDailyMissions(true, 1)).toBe(true)
    expect(qualifiesForDailyMissions(true, 0)).toBe(false)
    expect(qualifiesForDailyMissions(false, 30)).toBe(false)
  })

  it('accepts a Solo Sprint only once its configured duration has elapsed', () => {
    const run = {
      mode: 'sprint',
      currentQuestionIndex: 8,
      questionCount: 120,
      endsAt: new Date('2026-08-06T10:01:00.000Z'),
    }

    expect(completedSoloRunForDailyMissions(run, new Date('2026-08-06T10:00:59.999Z'))).toBe(false)
    expect(completedSoloRunForDailyMissions(run, run.endsAt)).toBe(true)
  })

  it('accepts a Solo Tempo only after every configured question was processed', () => {
    const run = {
      mode: 'tempo',
      currentQuestionIndex: 9,
      questionCount: 10,
      endsAt: new Date('2026-08-06T10:02:00.000Z'),
    }

    expect(completedSoloRunForDailyMissions(run, new Date('2026-08-06T10:01:00.000Z'))).toBe(false)
    expect(completedSoloRunForDailyMissions({ ...run, currentQuestionIndex: 10 }, new Date('2026-08-06T10:01:00.000Z'))).toBe(true)
  })

  it('applies the corresponding completion rule to multiplayer Sprint and Tempo games', () => {
    const startedAt = new Date('2026-08-06T10:00:00.000Z')

    expect(completedMatchForDailyMissions({
      challengeMode: 'sprint',
      startedAt,
      durationSeconds: 60,
      questionCount: null,
    }, 12, new Date('2026-08-06T10:00:59.999Z'))).toBe(false)
    expect(completedMatchForDailyMissions({
      challengeMode: 'sprint',
      startedAt,
      durationSeconds: 60,
      questionCount: null,
    }, 12, new Date('2026-08-06T10:01:00.000Z'))).toBe(true)
    expect(completedMatchForDailyMissions({
      challengeMode: 'tempo',
      startedAt,
      durationSeconds: 100,
      questionCount: 10,
    }, 9, new Date('2026-08-06T10:02:00.000Z'))).toBe(false)
    expect(completedMatchForDailyMissions({
      challengeMode: 'tempo',
      startedAt,
      durationSeconds: 100,
      questionCount: 10,
    }, 10, new Date('2026-08-06T10:01:00.000Z'))).toBe(true)
  })

  it('never accepts a forfeited multiplayer participant', () => {
    expect(completedMatchForDailyMissions({
      challengeMode: 'sprint',
      startedAt: new Date('2026-08-06T10:00:00.000Z'),
      durationSeconds: 60,
      questionCount: null,
    }, 20, new Date('2026-08-06T10:01:00.000Z'), new Date('2026-08-06T10:00:30.000Z'))).toBe(false)
  })
})
