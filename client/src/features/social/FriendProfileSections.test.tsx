import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FriendProfileData } from '../../lib/api'
import { FriendChallengeHistory } from './FriendChallengeHistory'
import { FriendPerformanceSummary } from './FriendPerformanceSummary'

const stats: FriendProfileData['stats'] = {
  byGame: [
    { game: 'addition', attempts: 8, averageAccuracy: 72, bestScore: 100, bestStreak: 7, averageResponseTimeMs: 2200, lastPlayedAt: '2026-07-18T10:00:00.000Z' },
  ],
  byLevel: [
    { level: 'debutant', attempts: 5, averageAccuracy: 50, bestScore: 80, bestStreak: 6, averageResponseTimeMs: 2400, lastPlayedAt: '2026-07-18T10:00:00.000Z' },
    { level: 'expert', attempts: 3, averageAccuracy: 50, bestScore: 70, bestStreak: 3, averageResponseTimeMs: 4200, lastPlayedAt: '2026-07-17T10:00:00.000Z' },
  ],
}

const headToHead: NonNullable<FriendProfileData['headToHead']> = {
  summary: { wins: 2, losses: 1, draws: 0 },
  recent: [{
    id: 'match-1',
    playedAt: '2026-07-18T10:00:00.000Z',
    challengeMode: 'sprint',
    game: 'addition',
    level: 'expert',
    myScore: 82,
    friendScore: 74,
    outcome: 'win',
  }],
}

afterEach(cleanup)

describe('sections du profil ami', () => {
  it('contextualise le même pourcentage par niveau', () => {
    render(<FriendPerformanceSummary stats={stats} />)

    expect(screen.getByText('Débutant').closest('article')).toHaveTextContent('50%')
    expect(screen.getByText('Expert').closest('article')).toHaveTextContent('50%')
    expect(screen.getByText('Débutant').closest('article')).toHaveTextContent('5')
    expect(screen.getByText('Expert').closest('article')).toHaveTextContent('3')
  })

  it('affiche uniquement les vrais défis fournis par le contrat', () => {
    render(<FriendChallengeHistory friendName="Awa" headToHead={headToHead} />)

    expect(screen.getByLabelText(/2 gagnés, 1 perdus/i)).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('74')).toBeInTheDocument()
    expect(screen.getByText('Gagné')).toBeInTheDocument()
  })

  it('reste honnête quand aucun défi n’est terminé', () => {
    render(<FriendChallengeHistory friendName="Awa" headToHead={{ summary: { wins: 0, losses: 0, draws: 0 }, recent: [] }} />)
    expect(screen.getByText('Aucun défi terminé')).toBeInTheDocument()
  })
})
