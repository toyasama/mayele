import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoloRunData } from '../lib/api'
import { GamePage } from './GamePage'

const apiMocks = vi.hoisted(() => ({
  finishSoloRun: vi.fn(),
  getActiveSoloRun: vi.fn(),
  getDailyObjectives: vi.fn(),
  getSoloRun: vi.fn(),
  startSoloRun: vi.fn(),
  submitSoloAnswer: vi.fn(),
}))

vi.mock('../context/auth', () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => 'token'),
    isAuthenticated: true,
    user: { clerkUserId: 'player-1', timeZone: 'Europe/Paris' },
  }),
}))

vi.mock('../context/profile-context', () => ({
  useProfile: () => ({ profile: null }),
}))

vi.mock('../hooks/useDailyScopeKey', () => ({
  useDailyScopeKey: () => '2026-08-05',
}))

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: () => ({
    isRealtimeReady: false,
    submitSoloAnswer: vi.fn(),
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()

  return {
    ...actual,
    api: {
      ...actual.api,
      ...apiMocks,
    },
  }
})

function activeRun(): SoloRunData {
  const now = new Date()
  const endsAt = new Date(now.getTime() + 60_000)

  return {
    id: 'run-1',
    clientRunId: 'command-1',
    status: 'active',
    mode: 'sprint',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: 30,
    perQuestionTimeLimitSeconds: null,
    currentQuestionIndex: 0,
    startedAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    expiresAt: new Date(endsAt.getTime() + 60_000).toISOString(),
    finishedAt: null,
    serverNow: now.toISOString(),
    question: {
      index: 0,
      prompt: '1 + 1',
      operation: 'addition',
      skill: 'addition',
      issuedAt: now.toISOString(),
      deadlineAt: endsAt.toISOString(),
    },
    nextQuestion: {
      index: 1,
      prompt: '2 + 2',
      operation: 'addition',
      skill: 'addition',
    },
    progress: {
      correctAnswers: 0,
      totalQuestions: 0,
      scorePoints: 0,
      xp: 0,
      currentStreak: 0,
      bestStreak: 0,
    },
    answers: [],
    result: null,
  }
}

function completedRun(run: SoloRunData): SoloRunData {
  return {
    ...run,
    status: 'completed',
    finishedAt: new Date().toISOString(),
    serverNow: new Date().toISOString(),
    question: null,
    nextQuestion: null,
  }
}

function renderGamePage(initialEntry = '/jeu/solo') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GamePage />
    </MemoryRouter>,
  )
}

async function startGame(run: SoloRunData) {
  apiMocks.startSoloRun.mockResolvedValueOnce({ run })
  renderGamePage()
  fireEvent.click(await screen.findByRole('button', { name: /Commencer le sprint/i }))
  await screen.findByText('1 + 1')
}

describe('GamePage solo completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getActiveSoloRun.mockResolvedValue({ run: null })
    apiMocks.getDailyObjectives.mockResolvedValue({ objectives: [] })
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  afterEach(cleanup)

  it('préremplit exactement la configuration Solo indiquée par une mission', async () => {
    renderGamePage('/jeu/solo?mission=daily-v2&playContext=solo&mode=sprint&game=multiplication&level=avance&duration=90')

    expect(await screen.findByText('Sprint - 90s')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Multiplication' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Avancé' })).toHaveClass('active')
  })

  it('conserve le snapshot termine si la derniere reponse arrive apres la finalisation', async () => {
    const run = activeRun()
    const completed = completedRun(run)
    apiMocks.submitSoloAnswer.mockRejectedValueOnce(new Error('Cette partie est déjà terminée.'))
    apiMocks.getSoloRun.mockResolvedValueOnce({ run: completed })

    await startGame(run)
    fireEvent.change(screen.getByRole('textbox', { name: /Votre reponse/i }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByRole('heading', { name: /Partie terminée/i })).toBeVisible()
    expect(screen.queryByText('Cette partie est déjà terminée.')).not.toBeInTheDocument()
  })

  it('verrouille la saisie pendant la finalisation', async () => {
    const run = activeRun()
    let resolveFinish!: (value: { run: SoloRunData }) => void
    apiMocks.finishSoloRun.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFinish = resolve
    }))

    await startGame(run)
    fireEvent.click(screen.getByRole('button', { name: /Quitter/i }))

    const input = screen.getByRole('textbox', { name: /Votre reponse/i })
    expect(screen.getByRole('button', { name: /En attente/i })).toBeDisabled()
    expect(input).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(apiMocks.submitSoloAnswer).not.toHaveBeenCalled()

    resolveFinish({ run: completedRun(run) })
    await waitFor(() => expect(screen.getByRole('heading', { name: /Partie terminée/i })).toBeVisible())
  })
})
