import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const progressByMode: FriendProfileData['progressByMode'] = [
  { game: 'addition', level: 'debutant', attempts: 5, averageScore: 50, averageAccuracy: 50, bestScore: 80, bestStreak: 6, lastPlayedAt: '2026-07-18T10:00:00.000Z' },
  { game: 'addition', level: 'expert', attempts: 3, averageScore: 50, averageAccuracy: 50, bestScore: 70, bestStreak: 3, lastPlayedAt: '2026-07-17T10:00:00.000Z' },
]

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
    decidedBy: 'score',
  }],
}

const operationHistory = [
  { id: 'session-1', score: 60, correctAnswers: 6, totalQuestions: 10, bestStreak: 3, playedAt: '2026-07-17T10:00:00.000Z', averageResponseTimeMs: 2600 },
  { id: 'session-2', score: 80, correctAnswers: 8, totalQuestions: 10, bestStreak: 5, playedAt: '2026-07-18T10:00:00.000Z', averageResponseTimeMs: 2100 },
]

afterEach(cleanup)

describe('sections du profil ami', () => {
  it('contextualise le même pourcentage par niveau', () => {
    render(<FriendPerformanceSummary stats={stats} progressByMode={progressByMode} loadOperationHistory={async () => []} />)

    expect(screen.getByRole('button', { name: /Débutant/i })).toHaveTextContent('50%')
    expect(screen.getByRole('button', { name: /Expert/i })).toHaveTextContent('50%')
    expect(screen.getByRole('button', { name: /Débutant/i })).toHaveTextContent('5 sprints')
    expect(screen.getByRole('button', { name: /Expert/i })).toHaveTextContent('3 sprints')
    expect(screen.queryByRole('link', { name: /Jouer/i })).not.toBeInTheDocument()
  })

  it("ouvre le graphique de l'historique public sans proposer de jouer à la place de l'ami", async () => {
    const loadOperationHistory = vi.fn(async () => operationHistory)
    render(<FriendPerformanceSummary stats={stats} progressByMode={progressByMode} loadOperationHistory={loadOperationHistory} />)

    fireEvent.click(screen.getByRole('button', { name: /Addition/i }))

    expect(await screen.findByRole('img', { name: /Évolution de la précision sur 2 parties/i })).toBeInTheDocument()
    expect(loadOperationHistory).toHaveBeenCalledWith('addition', 'expert')
    expect(screen.queryByRole('link', { name: /Jouer/i })).not.toBeInTheDocument()
  })

  it('affiche uniquement les vrais défis fournis par le contrat', () => {
    render(<FriendChallengeHistory friendName="Awa" headToHead={headToHead} onChallenge={() => undefined} />)

    expect(screen.getByLabelText(/2 gagnés, 1 perdus/i)).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('74')).toBeInTheDocument()
    expect(screen.getByText('Gagné')).toBeInTheDocument()
  })

  it('explique un score nul décidé par forfait', () => {
    const forfeitHeadToHead: NonNullable<FriendProfileData['headToHead']> = {
      summary: { wins: 1, losses: 0, draws: 0 },
      recent: [{
        ...headToHead.recent[0],
        myScore: 0,
        friendScore: 0,
        decidedBy: 'forfeit',
      }],
    }

    render(<FriendChallengeHistory friendName="Awa" headToHead={forfeitHeadToHead} onChallenge={() => undefined} />)

    expect(screen.getByText('Gagné par forfait')).toBeInTheDocument()
  })

  it('reste honnête quand aucun défi n’est terminé', () => {
    render(<FriendChallengeHistory friendName="Awa" headToHead={{ summary: { wins: 0, losses: 0, draws: 0 }, recent: [] }} onChallenge={() => undefined} />)
    expect(screen.getByText('Aucun défi terminé')).toBeInTheDocument()
  })
})
