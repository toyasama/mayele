import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MatchData, PublicPlayer } from '../../lib/api'
import { MultiplayerLobby } from './MultiplayerLobby'

const friend: PublicPlayer = {
  id: 'friend-1',
  name: 'Awa Diallo',
  username: 'awa',
  avatarUrl: null,
  totalXp: 120,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-07-18T10:00:00.000Z',
}

const invitation = {
  id: 'match-1',
  game: 'addition',
  level: 'debutant',
  challengeMode: 'sprint',
  createdBy: friend,
} as MatchData

afterEach(cleanup)

describe('MultiplayerLobby', () => {
  it('met en avant les adversaires disponibles et les invitations', () => {
    const onInvite = vi.fn()
    const onOpenInvitation = vi.fn()

    render(
      <MultiplayerLobby
        action=""
        friends={[friend]}
        invitations={[invitation]}
        onDeclineInvitation={vi.fn()}
        onInvite={onInvite}
        onNewChallenge={vi.fn()}
        onOpenInvitation={onOpenInvitation}
      />,
    )

    expect(screen.getByRole('heading', { name: /À qui le tour/i })).toBeInTheDocument()
    expect(screen.getByText('1 en ligne')).toBeInTheDocument()
    expect(screen.getByText('À vous de jouer')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /Awa Diallo/i })[0])
    expect(onInvite).toHaveBeenCalledWith(friend)

    fireEvent.click(screen.getByRole('button', { name: /Awa DialloSprint/i }))
    expect(onOpenInvitation).toHaveBeenCalledWith(invitation)
  })
})
