import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { readCache, userCacheKey, writeCache } from '../lib/appCache'
import { api, type AuthUser } from '../lib/api'
import { useAuth } from './auth'
import { ProfileContext } from './profile-context'

const PROFILE_CACHE_PREFIX = 'mayele.profile.v3.'

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, getToken, user } = useAuth()
  const cacheKey = user?.clerkUserId ? userCacheKey(PROFILE_CACHE_PREFIX, user.clerkUserId) : null
  const [profile, setProfile] = useState<AuthUser | null>(() => (cacheKey ? readCache<AuthUser>(cacheKey) : null))
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const fetchedForRef = useRef<string | null>(null)

  const fetchProfile = useCallback(async () => {
    setProfileError(null)

    if (!isAuthenticated) {
      setProfile(null)
      setProfileLoading(false)
      return
    }

    const cachedProfile = cacheKey ? readCache<AuthUser>(cacheKey) : null

    if (cachedProfile) {
      setProfile(cachedProfile)
    }

    setProfileLoading(true)

    try {
      const payload = await api.getMe(getToken)
      setProfile(payload.user)
      if (cacheKey) {
        writeCache(cacheKey, payload.user)
      }
    } catch (caughtError) {
      if (!cachedProfile) {
        setProfile((current) => current)
      }
      setProfileError(caughtError instanceof Error ? caughtError.message : 'Impossible de charger votre profil.')
    } finally {
      setProfileLoading(false)
    }
  }, [cacheKey, isAuthenticated, getToken])

  useEffect(() => {
    const key = isAuthenticated ? user?.clerkUserId ?? 'authenticated' : 'unauthenticated'

    if (fetchedForRef.current === key) {
      return
    }

    fetchedForRef.current = key
    const cachedProfile = cacheKey ? readCache<AuthUser>(cacheKey) : null

    if (cachedProfile) {
      setProfile(cachedProfile)
    } else if (!isAuthenticated) {
      setProfile(null)
    } else {
      setProfile(null)
    }

    void fetchProfile()
  }, [cacheKey, isAuthenticated, fetchProfile, user?.clerkUserId])

  return (
    <ProfileContext.Provider value={{ profile, profileLoading, profileError, refreshProfile: fetchProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}
