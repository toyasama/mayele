import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { DailyMission } from '../../lib/api'
import { QuestPath } from './QuestPath'

const mission: DailyMission = {
  version: 2,
  key: 'daily-v2_hard_accuracy_multiplayer_tempo_expert_division_tempo-50q-5s_target-95',
  family: 'accuracy',
  familyLabel: 'Justesse',
  tier: 'hard',
  tierLabel: 'Difficile',
  title: 'Soigner sa précision',
  description: 'Atteins 95 % de réussite dans une même partie.',
  rewardXp: 140,
  scope: 'daily',
  scopeKey: '2026-08-06',
  target: 95,
  minimumValidAnswers: 15,
  requirements: {
    playContext: 'multiplayer',
    challengeMode: 'tempo',
    game: 'division',
    level: 'expert',
    minSprintDurationSeconds: null,
    minTempoQuestionCount: 50,
    maxTempoQuestionSeconds: 5,
    diversityKind: null,
    recognizedConfigurationKeys: [],
  },
  launchConfig: {
    playContext: 'multiplayer',
    challengeMode: 'tempo',
    game: 'division',
    level: 'expert',
    sprintDurationSeconds: null,
    tempoQuestionCount: 50,
    tempoQuestionSeconds: 5,
  },
  current: 80,
  progress: 84,
  completed: false,
  claimed: false,
  completedAt: null,
}

describe('QuestPath daily missions', () => {
  afterEach(cleanup)

  it('exposes every mission dimension and a standalone preconfigured link', () => {
    render(
      <MemoryRouter>
        <QuestPath missions={[mission]} />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText(/Mission Difficile, Multijoueur, Tempo, niveau Expert, configuration 50 q · 5 s\/q/)).toBeVisible()
    const prepareLink = screen.getByRole('link', { name: 'Préparer' })
    expect(prepareLink).toHaveAttribute('href', expect.stringContaining('/jeu/multijoueur?'))
    expect(prepareLink).toHaveAttribute('href', expect.stringContaining('questions=50'))
    expect(prepareLink.closest('button')).toBeNull()
  })

  it('ignores a legacy cached mission instead of crashing the dashboard', () => {
    render(
      <MemoryRouter>
        <QuestPath missions={[{ key: 'daily_first_sprint', title: 'Ancienne mission' } as never]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Aucune quête active')).toBeVisible()
  })
})
