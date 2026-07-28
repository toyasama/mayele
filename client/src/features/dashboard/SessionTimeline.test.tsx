import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '../../lib/api'
import { SessionTimeline } from './SessionTimeline'

type Session = DashboardData['recentSessions'][number]

function makeSession(score: number): Session {
  return {
    id: `session-${score}`,
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    score,
    scorePoints: score,
    xp: score,
    correctAnswers: score,
    totalQuestions: 100,
    durationSeconds: 60,
    bestStreak: 2,
    playedAt: '2026-07-18T12:00:00.000Z',
    answers: [],
  }
}

describe('SessionTimeline', () => {
  afterEach(cleanup)

  it('rend les quatre seuils avec un libellé et une barre accessibles', () => {
    const { container } = render(
      <MemoryRouter>
        <SessionTimeline
          sessions={[makeSession(0), makeSession(24), makeSession(25), makeSession(49), makeSession(50), makeSession(74), makeSession(75), makeSession(100)]}
          expandedSessionId={null}
          onToggleSession={vi.fn()}
          gameLabel={() => 'Addition'}
          levelLabel={() => 'Débutant'}
          skillLabel={() => 'Calcul'}
          formatDate={() => '18 juil. 2026'}
        />
      </MemoryRouter>,
    )

    expect(container.querySelector('.score-critical')).toBeVisible()
    expect(container.querySelector('.score-caution')).toBeVisible()
    expect(container.querySelector('.score-progress')).toBeVisible()
    expect(container.querySelector('.score-strong')).toBeVisible()
    expect(screen.getAllByText('À reprendre')).toHaveLength(2)
    expect(screen.getAllByText('Fragile')).toHaveLength(2)
    expect(screen.getAllByText('En progrès')).toHaveLength(2)
    expect(screen.getAllByText('Solide')).toHaveLength(2)
    expect(screen.getByRole('progressbar', { name: 'Score de la session : 0%' })).toHaveValue(0)
    expect(screen.getByRole('progressbar', { name: 'Score de la session : 24%' })).toHaveValue(24)
    expect(screen.getByRole('progressbar', { name: 'Score de la session : 75%' })).toHaveValue(75)
    expect(screen.getByRole('progressbar', { name: 'Score de la session : 100%' })).toHaveValue(100)
  })
})
