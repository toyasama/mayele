import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react'
import type { AuthUser } from '../lib/api'
import { detectBrowserTimeZone } from '../lib/timeZone'

const E2E_AUTH_BYPASS = import.meta.env.VITE_E2E_AUTH_BYPASS === 'true'
const E2E_HOST_USER: AuthUser = {
  id: 'e2e-host',
  clerkUserId: 'e2e-host',
  name: 'Alice Host',
  firstName: 'Alice',
  lastName: 'Host',
  birthDate: '2000-01-01',
  username: 'alice-host',
  avatarUrl: null,
  timeZone: 'Europe/Paris',
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-01-01T00:00:00.000Z',
  email: 'alice.host@example.test',
  profileComplete: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const E2E_GUEST_USER: AuthUser = {
  id: 'e2e-guest',
  clerkUserId: 'e2e-guest',
  name: 'Bob Guest',
  firstName: 'Bob',
  lastName: 'Guest',
  birthDate: '2000-01-01',
  username: 'bob-guest',
  avatarUrl: null,
  timeZone: 'Europe/Paris',
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-01-01T00:00:00.000Z',
  email: 'bob.guest@example.test',
  profileComplete: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

async function getE2EToken() {
  return `e2e:${e2eUser().clerkUserId}`
}

async function e2eLogout() {}

export type AuthContextValue = {
  user: AuthUser | null
  getToken: () => Promise<string | null>
  loading: boolean
  isAuthenticated: boolean
  logout: () => Promise<void>
}

function displayNameFromEmail(email: string | null | undefined) {
  const localPart = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()

  if (!localPart) {
    return null
  }

  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function e2eUser(): AuthUser {
  const userKey = typeof window !== 'undefined' ? window.localStorage.getItem('mayele.e2e.user') : null
  return userKey === 'guest' ? E2E_GUEST_USER : E2E_HOST_USER
}

export function useAuth() {
  const clerkAuth = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  if (E2E_AUTH_BYPASS) {
    const user = e2eUser()

    return {
      user,
      getToken: getE2EToken,
      loading: false,
      isAuthenticated: true,
      logout: e2eLogout,
    }
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const fullName = user?.fullName ?? user?.username ?? displayNameFromEmail(email)

  return {
    user: user
      ? {
          id: user.id,
          clerkUserId: user.id,
          name: fullName ?? 'Joueur Mayele',
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          birthDate: null,
          username: user.username ?? null,
          avatarUrl: user.hasImage ? user.imageUrl : null,
          timeZone: detectBrowserTimeZone(),
          presenceStatus: 'online',
          presenceUpdatedAt: new Date().toISOString(),
          email,
          profileComplete: false,
          createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      : null,
    getToken: clerkAuth.getToken,
    loading: !clerkAuth.isLoaded,
    isAuthenticated: Boolean(clerkAuth.isSignedIn && user),
    logout: () => clerk.signOut(),
  }
}
