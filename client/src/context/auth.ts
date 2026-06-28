import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react'
import type { AuthUser } from '../lib/api'

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

export function useAuth() {
  const clerkAuth = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const fullName = user?.fullName ?? user?.username ?? displayNameFromEmail(email)

  return {
    user: user
      ? {
          id: user.id,
          clerkUserId: user.id,
          name: fullName ?? 'Joueur Mayele',
          email,
          createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      : null,
    getToken: clerkAuth.getToken,
    loading: !clerkAuth.isLoaded,
    isAuthenticated: Boolean(clerkAuth.isSignedIn && user),
    logout: () => clerk.signOut(),
  }
}
