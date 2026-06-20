import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react'
import type { AuthUser } from '../lib/api'

export type AuthContextValue = {
  user: AuthUser | null
  getToken: () => Promise<string | null>
  loading: boolean
  isAuthenticated: boolean
  logout: () => Promise<void>
}

export function useAuth() {
  const clerkAuth = useClerkAuth()
  const { user } = useUser()
  const clerk = useClerk()

  const fullName = user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? null

  return {
    user: user
      ? {
          id: user.id,
          clerkUserId: user.id,
          name: fullName ?? 'Joueur Mayele',
          email: user.primaryEmailAddress?.emailAddress ?? null,
          createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      : null,
    getToken: clerkAuth.getToken,
    loading: !clerkAuth.isLoaded,
    isAuthenticated: Boolean(clerkAuth.isSignedIn && user),
    logout: () => clerk.signOut(),
  }
}
