import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../lib/api'
import { ProfileProvider } from './profile'
import { useProfile } from './profile-context'

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getToken: vi.fn(async () => 'test-token'),
}))

vi.mock('./auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getToken: mocks.getToken,
    user: { clerkUserId: 'clerk_123' },
  }),
}))

vi.mock('../lib/api', () => ({ api: { getMe: mocks.getMe } }))

const completeProfile = {
  id: 'player_1',
  clerkUserId: 'clerk_123',
  profileComplete: true,
} as AuthUser

const incompleteProfile = { ...completeProfile, profileComplete: false }

function ProfileView() {
  const { profile, applyProfile } = useProfile()
  return (
    <>
      <div data-testid="profile-state">{profile?.profileComplete ? 'complete' : 'incomplete'}</div>
      <button onClick={() => applyProfile(completeProfile)}>Save profile</button>
    </>
  )
}

describe('ProfileProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('keeps the saved profile when an earlier profile read finishes late', async () => {
    let resolveGetMe: ((value: { user: AuthUser }) => void) | undefined
    mocks.getMe.mockReturnValue(new Promise((resolve) => { resolveGetMe = resolve }))

    render(<ProfileProvider><ProfileView /></ProfileProvider>)
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(screen.getByTestId('profile-state')).toHaveTextContent('complete')

    await act(async () => { resolveGetMe?.({ user: incompleteProfile }) })
    expect(screen.getByTestId('profile-state')).toHaveTextContent('complete')
    expect(window.localStorage.getItem('mayele.profile.v3.clerk_123')).toContain('"profileComplete":true')
  })
})
