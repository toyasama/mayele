import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData, OperationHistorySession } from '../../lib/api'
import type { GameLevel, GameType } from '../../lib/game'
import { PerformanceCockpit } from './PerformanceCockpit'

const stats: DashboardData['stats'] = {
  averageResponseTimeMs: 2700,
  byGame: [],
  byLevel: [
    {
      level: 'debutant',
      attempts: 20,
      averageAccuracy: 50,
      bestScore: 90,
      bestStreak: 8,
      averageResponseTimeMs: 2100,
      lastPlayedAt: '2026-07-15T10:00:00.000Z',
    },
    {
      level: 'intermediaire',
      attempts: 0,
      averageAccuracy: 0,
      bestScore: 0,
      bestStreak: 0,
      averageResponseTimeMs: 0,
      lastPlayedAt: null,
    },
    {
      level: 'avance',
      attempts: 0,
      averageAccuracy: 0,
      bestScore: 0,
      bestStreak: 0,
      averageResponseTimeMs: 0,
      lastPlayedAt: null,
    },
    {
      level: 'expert',
      attempts: 2,
      averageAccuracy: 50,
      bestScore: 70,
      bestStreak: 4,
      averageResponseTimeMs: 4300,
      lastPlayedAt: '2026-07-16T10:00:00.000Z',
    },
  ],
  bestCombination: {
    game: 'addition',
    level: 'debutant',
    attempts: 12,
    averageAccuracy: 82,
    bestScore: 90,
    bestStreak: 8,
  },
  recentTrend: {
    sessions: 5,
    averageAccuracy: 68,
    averageXp: 46,
    bestStreak: 7,
    accuracyDelta: 4,
    xpDelta: -2,
  },
  records: {
    bestScore: 90,
    bestStreak: 8,
    bestXp: 72,
    fastestAverageResponseTimeMs: 1800,
  },
}

const progressByMode: DashboardData['progressByMode'] = [
  {
    game: 'addition',
    level: 'debutant',
    attempts: 12,
    bestScore: 90,
    averageScore: 70,
    averageAccuracy: 60,
    bestStreak: 8,
    lastPlayedAt: '2026-07-15T10:00:00.000Z',
  },
  {
    game: 'soustraction',
    level: 'debutant',
    attempts: 8,
    bestScore: 75,
    averageScore: 48,
    averageAccuracy: 40,
    bestStreak: 5,
    lastPlayedAt: '2026-07-14T10:00:00.000Z',
  },
  {
    game: 'addition',
    level: 'expert',
    attempts: 2,
    bestScore: 70,
    averageScore: 50,
    averageAccuracy: 50,
    bestStreak: 4,
    lastPlayedAt: '2026-07-16T10:00:00.000Z',
  },
]

const recentSessions: DashboardData['recentSessions'] = Array.from({ length: 6 }, (_, index) => ({
  id: `session-${index}`,
  game: 'addition',
  level: 'debutant',
  practiceSkill: null,
  score: 55 + index * 7,
  scorePoints: 80 + index,
  xp: 40 + index,
  correctAnswers: 11 + index,
  totalQuestions: 20,
  durationSeconds: 60,
  bestStreak: 4 + index,
  playedAt: `2026-07-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
  answers: [{
    id: `answer-${index}`,
    prompt: '2 + 2',
    correctAnswer: 4,
    userAnswer: 4,
    responseTimeMs: 3200 - index * 200,
    isCorrect: true,
    skill: 'addition',
  }],
})).reverse()

const operationHistory: OperationHistorySession[] = recentSessions.map((session) => ({
  id: session.id,
  score: session.score,
  correctAnswers: session.correctAnswers,
  totalQuestions: session.totalQuestions,
  bestStreak: session.bestStreak,
  playedAt: session.playedAt,
  averageResponseTimeMs: session.answers[0]?.responseTimeMs ?? 0,
}))

function renderPerformance(loadOperationHistory = async () => operationHistory) {
  return render(
    <MemoryRouter>
      <PerformanceCockpit
        stats={stats}
        progressByMode={progressByMode}
        recentSessions={recentSessions}
        loadOperationHistory={loadOperationHistory}
        gameLabel={(game) => ({ addition: 'Addition', soustraction: 'Soustraction', multiplication: 'Multiplication', division: 'Division', mixte: 'Mixte' }[game] ?? game)}
        levelLabel={(level) => ({ debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé', expert: 'Expert' }[level ?? ''] ?? String(level))}
        formatResponseTime={(value) => value ? `${(value / 1000).toFixed(1)}s` : '—'}
        playHref={(level: GameLevel, game?: GameType) => `/jeu?level=${level}&game=${game ?? 'mixte'}`}
      />
    </MemoryRouter>,
  )
}

describe('PerformanceCockpit', () => {
  afterEach(cleanup)

  it('contextualise un même pourcentage par difficulté et par volume de jeu', () => {
    renderPerformance()

    const beginner = screen.getByRole('button', { name: /Débutant/i })
    const expert = screen.getByRole('button', { name: /Expert/i })

    expect(within(beginner).getByLabelText('50% de précision au niveau Débutant')).toBeVisible()
    expect(within(beginner).getByText('20 sprints')).toBeVisible()
    expect(within(beginner).getByText('Résultat confirmé')).toBeVisible()

    expect(within(expert).getByLabelText('50% de précision au niveau Expert')).toBeVisible()
    expect(within(expert).getByText('2 sprints')).toBeVisible()
    expect(within(expert).getByText('Premier repère')).toBeVisible()
  })

  it('affiche le détail des opérations du niveau choisi', () => {
    renderPerformance()

    fireEvent.click(screen.getByRole('button', { name: /Débutant/i }))

    const panel = document.querySelector('.performance-level-detail')
    expect(panel).not.toBeNull()
    if (!panel) return
    expect(within(panel).getByRole('heading', { name: 'Débutant', level: 3 })).toBeVisible()
    expect(within(panel).getByText('60%')).toBeVisible()
    expect(within(panel).getByText('12 sprints')).toBeVisible()
    expect(within(panel).getByRole('link', { name: 'Jouer en Débutant' })).toHaveAttribute('href', '/jeu?level=debutant&game=multiplication')
  })

  it('ouvre une analyse détaillée et permet de changer le graphe', () => {
    renderPerformance()

    fireEvent.click(screen.getByRole('button', { name: /Débutant/i }))
    const operationList = screen.getByRole('list', { name: /Résultats par opération/i })
    fireEvent.click(within(operationList).getByRole('button', { name: /Addition/i }))

    const detail = screen.getByRole('region', { name: /Détail Addition · Débutant/i })
    expect(within(detail).getByRole('img', { name: /Évolution de la précision sur 5 parties/i })).toBeVisible()
    expect(within(detail).getByText('2.6s')).toBeVisible()
    expect(within(detail).getByRole('link', { name: /Jouer en Addition/i })).toHaveAttribute('href', '/jeu?level=debutant&game=addition')

    fireEvent.click(within(detail).getByRole('button', { name: '10' }))
    expect(within(detail).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(detail).getByRole('button', { name: 'Temps' }))
    expect(within(detail).getByRole('img', { name: /Évolution de la vitesse sur 6 parties/i })).toBeVisible()

    const latestPoint = within(detail).getByRole('button', { name: /15 juil.*2.2 secondes par réponse/i })
    fireEvent.mouseEnter(latestPoint)
    expect(within(detail).getByText('2.2s par réponse')).toBeVisible()

    fireEvent.click(within(detail).getByRole('button', { name: /Fermer le détail de l’opération/i }))
    expect(screen.queryByRole('region', { name: /Détail Addition/i })).not.toBeInTheDocument()
  })

  it('récupère au moins un point même si le sprint est absent de l’historique global', async () => {
    const loadOperationHistory = vi.fn(async (): Promise<OperationHistorySession[]> => [{
      id: 'older-subtraction',
      score: 40,
      correctAnswers: 8,
      totalQuestions: 20,
      bestStreak: 5,
      playedAt: '2026-06-01T10:00:00.000Z',
      averageResponseTimeMs: 2800,
    }])
    renderPerformance(loadOperationHistory)

    fireEvent.click(screen.getByRole('button', { name: /Débutant/i }))
    const operationList = screen.getByRole('list', { name: /Résultats par opération/i })
    fireEvent.click(within(operationList).getByRole('button', { name: /Soustraction/i }))

    const detail = screen.getByRole('region', { name: /Détail Soustraction · Débutant/i })
    expect(await within(detail).findByRole('img', { name: /Évolution de la précision sur 1 partie/i })).toBeVisible()
    expect(within(detail).getByText('40% de précision')).toBeVisible()
    expect(within(detail).getByText('1 juin · 8/20 justes')).toBeVisible()
    expect(loadOperationHistory).toHaveBeenCalledWith('soustraction', 'debutant')
  })
})
