import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../lib/api'
import { ProtectedRoute } from './ProtectedRoute'

const mocks = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    loading: false,
  },
  profile: {
    profile: null as AuthUser | null,
    profileLoading: false,
    profileError: null as string | null,
    refreshProfile: vi.fn(),
  },
}))

vi.mock('../context/auth', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../context/profile-context', () => ({
  useProfile: () => mocks.profile,
}))

function completeProfile(): AuthUser {
  return {
    id: 'player_1',
    clerkUserId: 'clerk_1',
    name: 'Alice',
    firstName: 'Alice',
    lastName: null,
    birthDate: '2000-01-01',
    username: 'alice',
    avatarUrl: null,
    timeZone: 'Europe/Paris',
    presenceStatus: 'online',
    presenceUpdatedAt: '2026-01-01T00:00:00.000Z',
    email: 'alice@example.test',
    profileComplete: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderProtectedRoute() {
  render(
    <MemoryRouter>
      <ProtectedRoute>
        <div>Salon multijoueur</div>
      </ProtectedRoute>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mocks.auth.isAuthenticated = true
    mocks.auth.loading = false
    mocks.profile.profile = null
    mocks.profile.profileLoading = false
    mocks.profile.profileError = null
    mocks.profile.refreshProfile.mockReset()
  })

  afterEach(cleanup)

  it("ne monte pas la page protegee tant que le profil joueur n'est pas disponible", () => {
    renderProtectedRoute()

    expect(screen.getByText('Chargement de votre profil...')).toBeVisible()
    expect(screen.queryByText('Salon multijoueur')).not.toBeInTheDocument()
  })

  it('affiche l erreur profil au lieu de monter la page', () => {
    mocks.profile.profileError = 'Impossible de charger votre profil.'

    renderProtectedRoute()

    expect(screen.getByText('Impossible de charger votre profil.')).toBeVisible()
    expect(screen.queryByText('Salon multijoueur')).not.toBeInTheDocument()
  })

  it('monte la page lorsque le profil joueur complet est pret', () => {
    mocks.profile.profile = completeProfile()

    renderProtectedRoute()

    expect(screen.getByText('Salon multijoueur')).toBeVisible()
  })
})
