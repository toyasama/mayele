import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, type AuthUser, type MatchData, type PublicPlayer } from '../lib/api'
import { MultiplayerGamePage } from './MultiplayerGamePage'

const realtimeMocks = vi.hoisted(() => {
  const resolvedCommand = vi.fn(async () => ({}))

  return {
    options: null as Record<string, ((...args: unknown[]) => unknown) | undefined> | null,
    commands: {
      acceptMatchInvitation: resolvedCommand,
      acceptMatchProposal: resolvedCommand,
      createMatchInvitation: resolvedCommand,
      declineMatchInvitation: resolvedCommand,
      declineMatchProposal: resolvedCommand,
      forfeitMatch: resolvedCommand,
      isRealtimeReady: true,
      joinRoom: vi.fn(async () => ({ joined: true })),
      leaveMatch: resolvedCommand,
      proposeMatch: resolvedCommand,
      requestMatchRematch: resolvedCommand,
      submitMatchResult: vi.fn(),
      submitSprintAnswer: vi.fn(),
      submitTempoAnswer: vi.fn(),
      updateMatchConfig: resolvedCommand,
      updateMatchProgress: resolvedCommand,
    },
  }
})

const apiMocks = vi.hoisted(() => ({
  getMatch: vi.fn(),
  getMatchRoomOverview: vi.fn(),
  heartbeatMatch: vi.fn(),
}))

const profile = vi.hoisted(() => ({
  id: 'host',
  clerkUserId: 'user_host',
  name: 'Alice Host',
  firstName: 'Alice',
  lastName: 'Host',
  birthDate: '2000-01-01',
  username: 'alice-host',
  avatarUrl: null,
  timeZone: 'Europe/Paris',
  presenceStatus: 'online' as const,
  presenceUpdatedAt: '2026-08-05T10:00:00.000Z',
  email: 'alice@example.test',
  profileComplete: true,
  createdAt: '2026-08-05T10:00:00.000Z',
})) satisfies AuthUser

const host: PublicPlayer = {
  id: profile.id,
  name: profile.name,
  username: profile.username,
  avatarUrl: profile.avatarUrl,
  totalXp: 0,
  presenceStatus: profile.presenceStatus,
  presenceUpdatedAt: profile.presenceUpdatedAt,
}

const guest: PublicPlayer = {
  id: 'guest',
  name: 'Bob Guest',
  username: 'bob-guest',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-08-05T10:00:00.000Z',
}

const getToken = vi.hoisted(() => vi.fn(async () => 'token'))

vi.mock('../context/auth', () => ({
  useAuth: () => ({ getToken, isAuthenticated: true }),
}))

vi.mock('../context/profile-context', () => ({
  useProfile: () => ({ profile }),
}))

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (options: Record<string, ((...args: unknown[]) => unknown) | undefined>) => {
    realtimeMocks.options = options
    return realtimeMocks.commands
  },
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

function participant(player: PublicPlayer, status: string) {
  return {
    id: `participant-${player.id}`,
    status,
    preferredChallengeMode: null,
    preferredGame: null,
    preferredLevel: null,
    score: status === 'completed' ? 90 : null,
    scorePoints: status === 'completed' ? 175 : 0,
    xp: status === 'completed' ? 150 : null,
    correctAnswers: status === 'completed' ? 25 : 0,
    totalQuestions: status === 'completed' ? 27 : 0,
    totalResponseTimeMs: 0,
    bestStreak: status === 'completed' ? 16 : 0,
    joinedAt: '2026-08-05T10:00:00.000Z',
    finishedAt: status === 'completed' ? '2026-08-05T10:01:00.000Z' : null,
    forfeitedAt: null,
    rematchRequestedAt: null,
    resultDismissedAt: null,
    challengeStats: {
      room: { wins: 0, losses: 0, draws: 0 },
      friendship: { wins: 0, losses: 0, draws: 0 },
    },
    player,
  }
}

function activeMatch(): MatchData {
  const now = new Date()

  return {
    id: 'match-1',
    roomId: 'room-1',
    type: 'challenge',
    challengeMode: 'sprint',
    status: 'in_progress',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: 'seed-1',
    tempoQuestionIndex: null,
    tempoQuestionStartedAt: null,
    configVersion: 1,
    winnerPlayerId: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 120_000).toISOString(),
    endsAt: new Date(now.getTime() + 60_000).toISOString(),
    serverNow: now.toISOString(),
    hostActiveAt: now.toISOString(),
    startedAt: now.toISOString(),
    finishedAt: null,
    createdBy: host,
    participants: [participant(host, 'playing'), participant(guest, 'playing')],
  } as MatchData
}

function completedMatch(match: MatchData): MatchData {
  return {
    ...match,
    status: 'completed',
    winnerPlayerId: host.id,
    serverNow: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    participants: [participant(host, 'completed'), participant(guest, 'completed')],
  } as MatchData
}

function activeTempoMatch(): MatchData {
  const match = activeMatch()

  return {
    ...match,
    challengeMode: 'tempo',
    durationSeconds: 0,
    questionCount: 5,
    perQuestionTimeLimitSeconds: 60,
    tempoQuestionIndex: 0,
    tempoQuestionStartedAt: match.startedAt,
  } as MatchData
}

describe('MultiplayerGamePage finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtimeMocks.options = null
    realtimeMocks.commands.submitMatchResult.mockReset()
    realtimeMocks.commands.submitSprintAnswer.mockReset()
    realtimeMocks.commands.submitTempoAnswer.mockReset()
    apiMocks.getMatch.mockReset()
    realtimeMocks.commands.joinRoom.mockResolvedValue({ joined: true })
    apiMocks.heartbeatMatch.mockResolvedValue({ match: activeMatch() })
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  afterEach(cleanup)

  it('ouvre le configurateur multijoueur avec le preset Tempo de la mission', async () => {
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [] })

    render(
      <MemoryRouter initialEntries={['/jeu/multijoueur?mission=daily-v2&playContext=multiplayer&mode=tempo&game=division&level=expert&questions=50&questionSeconds=5']}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('spinbutton', { name: 'Questions' })).toHaveValue(50)
    expect(screen.getByRole('spinbutton', { name: 'Secondes par question' })).toHaveValue(5)
    expect(screen.getByRole('button', { name: /Division/ })).toHaveClass('active')
    expect(screen.getByRole('button', { name: /Expert/ })).toHaveClass('active')
  })

  it("n'affiche pas l'expiration tardive d'une reponse apres la fin confirmee du defi", async () => {
    const match = activeMatch()
    let rejectAnswer!: (reason: unknown) => void
    realtimeMocks.commands.submitSprintAnswer.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectAnswer = reject
    }))
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    await waitFor(() => expect(realtimeMocks.commands.submitSprintAnswer).toHaveBeenCalledOnce())

    act(() => {
      realtimeMocks.options?.onMatchChanged?.({ match: completedMatch(match) })
    })
    expect(await screen.findByText('Victoire')).toBeVisible()

    await act(async () => {
      rejectAnswer(new ApiRequestError('Commande temps reel expiree.', 0, 'realtime_timeout'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText(/Commande temps reel expiree/i)).not.toBeInTheDocument()
    })
  })

  it("attend la derniere reponse sprint avant d'envoyer le resultat", async () => {
    const match = activeMatch()
    let resolveAnswer!: (value: { match: MatchData }) => void
    realtimeMocks.commands.submitSprintAnswer.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAnswer = resolve
    }))
    realtimeMocks.commands.submitMatchResult.mockResolvedValueOnce({ match: completedMatch(match) })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    await waitFor(() => expect(realtimeMocks.commands.submitSprintAnswer).toHaveBeenCalledOnce())

    const endingMatch = {
      ...match,
      serverNow: new Date().toISOString(),
      endsAt: new Date(Date.now() + 100).toISOString(),
    }
    act(() => {
      realtimeMocks.options?.onMatchChanged?.({ match: endingMatch })
    })

    await new Promise((resolve) => window.setTimeout(resolve, 400))
    expect(realtimeMocks.commands.submitMatchResult).not.toHaveBeenCalled()

    await act(async () => {
      resolveAnswer({ match: endingMatch })
      await Promise.resolve()
    })

    await waitFor(() => expect(realtimeMocks.commands.submitMatchResult).toHaveBeenCalledOnce())
  })

  it.each([
    ['une expiration', 'realtime_timeout'],
    ['une indisponibilite', 'realtime_unavailable'],
    ['une reponse invalide', 'realtime_invalid_response'],
  ])('garde la reponse Tempo verrouillee apres %s Socket et recharge le salon', async (_label, code) => {
    const match = activeTempoMatch()
    realtimeMocks.commands.submitTempoAnswer.mockRejectedValueOnce(
      new ApiRequestError('Issue temps reel.', 0, code),
    )
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Enregistrement…')
    await waitFor(() => expect(apiMocks.getMatchRoomOverview).toHaveBeenCalledTimes(2))
    expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledOnce()
    expect(input).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /En attente/i })).toBeDisabled()
    expect(screen.queryByText('Issue temps reel.')).not.toBeInTheDocument()

    fireEvent.submit(input.closest('form')!)
    expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledOnce()
  })

  it("affiche qu'une reponse Tempo est enregistree quand l'evenement canonique arrive", async () => {
    const match = activeTempoMatch()
    let resolveAnswer!: (value: {
      match: MatchData
      progress: { questionIndex: number; answeredCount: number; expectedAnswerCount: number; complete: boolean; nextQuestionIndex: number }
    }) => void
    realtimeMocks.commands.submitTempoAnswer.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAnswer = resolve
    }))
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Enregistrement…')

    act(() => {
      realtimeMocks.options?.onMatchTempoAnswerRecorded?.({
        matchId: match.id,
        questionIndex: 0,
        playerId: profile.id,
        match,
      })
    })

    expect(await screen.findByRole('status')).toHaveTextContent("Réponse enregistrée — attente de l’adversaire.")

    await act(async () => {
      resolveAnswer({
        match,
        progress: { questionIndex: 0, answeredCount: 1, expectedAnswerCount: 2, complete: false, nextQuestionIndex: 1 },
      })
      await Promise.resolve()
    })
  })

  it('applique la progression canonique apres une issue Socket inconnue', async () => {
    const match = activeTempoMatch()
    const advancedMatch = {
      ...match,
      tempoQuestionIndex: 1,
      tempoQuestionStartedAt: new Date().toISOString(),
      serverNow: new Date().toISOString(),
    } as MatchData
    realtimeMocks.commands.submitTempoAnswer.mockRejectedValueOnce(
      new ApiRequestError('Commande temps reel expiree.', 0, 'realtime_timeout'),
    )
    apiMocks.getMatchRoomOverview
      .mockResolvedValueOnce({ friends: [guest], matches: [match] })
      .mockResolvedValueOnce({ friends: [guest], matches: [advancedMatch] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByText('Question 2/5')).toBeVisible()
    expect(screen.getByRole('button', { name: /Valider/i })).toBeEnabled()
    expect(screen.queryByText('Commande temps reel expiree.')).not.toBeInTheDocument()
  })

  it("libere la saisie quand l ACK complet contient deja la question suivante", async () => {
    const match = activeTempoMatch()
    const advancedMatch = {
      ...match,
      tempoQuestionIndex: 1,
      tempoQuestionStartedAt: new Date().toISOString(),
      tempoQuestionDeadlineAt: new Date(Date.now() + 10_000).toISOString(),
      serverNow: new Date().toISOString(),
    } as MatchData
    realtimeMocks.commands.submitTempoAnswer.mockResolvedValueOnce({
      match: advancedMatch,
      progress: { questionIndex: 0, answeredCount: 2, expectedAnswerCount: 2, complete: true, nextQuestionIndex: 1 },
    })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByText('Question 2/5')).toBeVisible()
    expect(screen.getByRole('button', { name: /Valider/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /En attente/i })).not.toBeInTheDocument()
  })

  it('rollbacke une reponse Tempo uniquement apres un rejet metier confirme', async () => {
    const match = activeTempoMatch()
    realtimeMocks.commands.submitTempoAnswer
      .mockRejectedValueOnce(new ApiRequestError('Reponse Tempo refusee.', 409, 'match_result_invalid'))
      .mockResolvedValueOnce({
        match,
        progress: { questionIndex: 0, answeredCount: 1, expectedAnswerCount: 2, complete: false, nextQuestionIndex: 1 },
      })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByText('Reponse Tempo refusee.')).toBeVisible()
    expect(input).toHaveValue('7')
    expect(input).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: /Valider/i })).toBeEnabled()
    expect(apiMocks.getMatchRoomOverview).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    await waitFor(() => expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledTimes(2))
  })

  it('relit le snapshot canonique quand la completion Tempo Socket est perdue', async () => {
    const match = {
      ...activeTempoMatch(),
      questionCount: 1,
      perQuestionTimeLimitSeconds: 5,
    } as MatchData
    const completed = completedMatch(match)

    realtimeMocks.commands.submitTempoAnswer.mockResolvedValueOnce({
      match,
      progress: { questionIndex: 0, answeredCount: 1, expectedAnswerCount: 2, complete: false, nextQuestionIndex: 1 },
    })
    apiMocks.getMatch
      .mockResolvedValueOnce({ match })
      .mockResolvedValueOnce({ match: completed })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })
    apiMocks.heartbeatMatch.mockResolvedValue({ match })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    expect(await screen.findByTestId('multiplayer-waiting-for-opponent')).toBeVisible()
    await waitFor(() => expect(screen.getByText('Victoire')).toBeVisible(), { timeout: 2500 })
    expect(apiMocks.getMatch).toHaveBeenCalledTimes(2)
    expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledOnce()
  })

  it('ne renvoie pas la derniere reponse Tempo lorsque le timer local expire', async () => {
    const now = new Date()
    const match = {
      ...activeTempoMatch(),
      questionCount: 1,
      perQuestionTimeLimitSeconds: 1,
      startedAt: now.toISOString(),
      tempoQuestionStartedAt: now.toISOString(),
      serverNow: now.toISOString(),
    } as MatchData

    realtimeMocks.commands.submitTempoAnswer.mockResolvedValue({
      match,
      progress: { questionIndex: 0, answeredCount: 2, expectedAnswerCount: 2, complete: true, nextQuestionIndex: 1 },
    })
    apiMocks.getMatch.mockResolvedValue({ match })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })
    apiMocks.heartbeatMatch.mockResolvedValue({ match })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))

    await waitFor(() => expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledOnce())
    await new Promise((resolve) => window.setTimeout(resolve, 1400))
    expect(realtimeMocks.commands.submitTempoAnswer).toHaveBeenCalledOnce()
  })
})
