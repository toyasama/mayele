import { createContext, useContext } from 'react'
import type { AuthUser } from '../lib/api'

export type ProfileContextValue = {
  profile: AuthUser | null
  profileLoading: boolean
  profileError: string | null
  refreshProfile: () => Promise<void>
  applyProfile: (profile: AuthUser) => void
  updateProfilePresence: (presence: Pick<AuthUser, 'id' | 'presenceStatus' | 'presenceUpdatedAt'>) => void
}

export const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  profileLoading: true,
  profileError: null,
  refreshProfile: async () => {},
  applyProfile: () => {},
  updateProfilePresence: () => {},
})

export function useProfile() {
  return useContext(ProfileContext)
}
