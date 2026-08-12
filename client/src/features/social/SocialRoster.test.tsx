import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicPlayer } from '../../lib/api'
import { SocialRoster } from './SocialRoster'

afterEach(cleanup)

const friend: PublicPlayer = {
  id: 'player-1',
  name: 'Jellal END',
  username: 'jellal',
  avatarUrl: null,
  totalXp: 10_561,
  presenceStatus: 'offline',
  presenceUpdatedAt: '2026-08-11T18:30:00.000Z',
}

describe('SocialRoster', () => {
  it('presents a compact friend detail without the redundant level progress copy', () => {
    render(
      <SocialRoster
        entries={[{ key: 'friend-player-1', status: 'friend', player: friend }]}
        renderActions={() => (
          <>
            <button type="button">Profil</button>
            <button type="button">Défier</button>
            <button className="danger-button" type="button">Retirer</button>
          </>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('option', { name: /Jellal END/i }))

    const handle = document.querySelector('.social-profile-handle-row')
    const progression = screen.getByLabelText('Progression du joueur')

    expect(handle).not.toBeNull()
    expect(within(handle as HTMLElement).getByText('@jellal')).toBeVisible()
    expect(within(handle as HTMLElement).getByText('Ami')).toBeVisible()
    expect(within(progression).getByText('Niveau')).toBeVisible()
    expect(within(progression).getByText('12')).toBeVisible()
    expect(within(progression).getByText('10 561')).toBeVisible()
    expect(screen.getByText('Dernière activité')).toBeVisible()
    expect(screen.queryByText(/XP avant le niveau/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profil' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeVisible()
  })
})
