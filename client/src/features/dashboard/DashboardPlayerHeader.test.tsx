import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DailyMission, PlayerProgress } from '../../lib/api'
import { DashboardPlayerHeader } from './DashboardPlayerHeader'

const progress: PlayerProgress = {
  level: 4,
  maxLevel: 20,
  totalXp: 760,
  currentLevelXp: 600,
  nextLevel: 5,
  nextLevelXp: 900,
  xpIntoLevel: 160,
  xpForNextLevel: 300,
  xpRemaining: 140,
  progress: 53,
  isMaxLevel: false,
}

const mission: DailyMission = {
  version: 2,
  key: 'daily-v2_accuracy',
  family: 'accuracy',
  familyLabel: 'Justesse',
  tier: 'easy',
  tierLabel: 'Facile',
  title: 'Réussir un sprint précis',
  description: 'Atteins ton objectif de précision.',
  rewardXp: 40,
  scope: 'daily',
  scopeKey: '2026-08-12',
  target: 20,
  minimumValidAnswers: 10,
  requirements: {
    playContext: 'solo',
    challengeMode: 'sprint',
    game: 'addition',
    level: 'debutant',
    minSprintDurationSeconds: 60,
    minTempoQuestionCount: null,
    maxTempoQuestionSeconds: null,
    diversityKind: null,
    recognizedConfigurationKeys: [],
  },
  launchConfig: {
    playContext: 'solo',
    challengeMode: 'sprint',
    game: 'addition',
    level: 'debutant',
    sprintDurationSeconds: 60,
    tempoQuestionCount: null,
    tempoQuestionSeconds: null,
  },
  current: 8,
  progress: 40,
  completed: false,
  claimed: false,
  completedAt: null,
}

describe('DashboardPlayerHeader', () => {
  afterEach(cleanup)

  it('ne conserve que les trois missions du jour dans le bandeau', () => {
    const missions = [
      mission,
      { ...mission, key: 'daily-v2_speed', title: 'Garder le rythme', current: 12, target: 30, progress: 40 },
      { ...mission, key: 'daily-v2_streak', title: 'Enchaîner sans faute', current: 4, target: 20, progress: 20 },
    ]

    render(
      <DashboardPlayerHeader
        avatar={<span>MJ</span>}
        name="Joueur Test"
        handle="@joueur"
        progress={progress}
        missions={missions}
      />,
    )

    const missionList = screen.getByRole('list', { name: 'Missions du jour' })
    expect(within(missionList).getAllByRole('listitem')).toHaveLength(3)
    expect(within(missionList).getByText('Réussir un sprint précis')).toBeVisible()
    expect(within(missionList).getByText('8/20')).toBeVisible()
    expect(within(missionList).getAllByRole('progressbar')).toHaveLength(3)
    expect(screen.queryByText('Aujourd’hui')).not.toBeInTheDocument()
    expect(screen.queryByText('Meilleure série')).not.toBeInTheDocument()
    expect(screen.queryByText('Dernière partie')).not.toBeInTheDocument()
    expect(screen.queryByText('Missions du jour')).not.toBeInTheDocument()
  })
})
