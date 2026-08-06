import { describe, expect, it } from 'vitest'
import { isDailyMissionV2, missionLaunchConfigFromSearch, missionLaunchPath } from './missionNavigation'

describe('mission navigation', () => {
  it('builds a fully preconfigured Solo Sprint link', () => {
    const path = missionLaunchPath({
      key: 'daily-v2-easy',
      launchConfig: {
        playContext: 'solo',
        challengeMode: 'sprint',
        game: 'addition',
        level: 'debutant',
        sprintDurationSeconds: 90,
        tempoQuestionCount: null,
        tempoQuestionSeconds: null,
      },
    })

    expect(path).toContain('/jeu/solo?')
    expect(path).toContain('mission=daily-v2-easy')
    expect(path).toContain('duration=90')
  })

  it('round-trips a multiplayer Tempo configuration', () => {
    const path = missionLaunchPath({
      key: 'daily-v2-hard',
      launchConfig: {
        playContext: 'multiplayer',
        challengeMode: 'tempo',
        game: 'division',
        level: 'expert',
        sprintDurationSeconds: null,
        tempoQuestionCount: 50,
        tempoQuestionSeconds: 5,
      },
    })
    const parsed = missionLaunchConfigFromSearch(new URL(path, 'https://mayele.test').searchParams)

    expect(parsed).toMatchObject({
      playContext: 'multiplayer',
      challengeMode: 'tempo',
      game: 'division',
      level: 'expert',
      tempoQuestionCount: 50,
      tempoQuestionSeconds: 5,
    })
  })

  it('does not turn missing or invalid settings into zero-valued configuration', () => {
    const parsed = missionLaunchConfigFromSearch(new URLSearchParams(
      'mission=daily-v2&playContext=solo&mode=sprint&game=addition&level=debutant&duration=invalid',
    ))

    expect(parsed?.sprintDurationSeconds).toBeNull()
    expect(parsed?.tempoQuestionCount).toBeNull()
  })

  it('rejects a cached V1 mission before React tries to render V2 constraints', () => {
    expect(isDailyMissionV2({
      key: 'daily_first_sprint',
      title: 'Prendre son élan',
      target: 1,
      current: 0,
    })).toBe(false)
  })
})
