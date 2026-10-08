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
  const requestVersionRef = useRef(0)

  const fetchProfile = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
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
      if (requestVersion !== requestVersionRef.current) return
      setProfile(payload.user)
      if (cacheKey) {
        writeCache(cacheKey, payload.user)
      }
    } catch (caughtError) {
      if (requestVersion !== requestVersionRef.current) return
      if (!cachedProfile) {
        setProfile((current) => current)
      }
      setProfileError(caughtError instanceof Error ? caughtError.message : 'Impossible de charger votre profil.')
    } finally {
      if (requestVersion === requestVersionRef.current) setProfileLoading(false)
    }
  }, [cacheKey, isAuthenticated, getToken])

  const applyProfile = useCallback((updatedProfile: AuthUser) => {
    // A GET started during sign-up may still contain the incomplete player.
    ++requestVersionRef.current
    setProfile(updatedProfile)
    setProfileLoading(false)
    setProfileError(null)
    writeCache(userCacheKey(PROFILE_CACHE_PREFIX, updatedProfile.clerkUserId), updatedProfile)
  }, [])

  const updateProfilePresence = useCallback((presence: Pick<AuthUser, 'id' | 'presenceStatus' | 'presenceUpdatedAt'>) => {
    setProfile((current) => {
      if (!current || current.id !== presence.id) {
        return current
      }

      return {
        ...current,
        presenceStatus: presence.presenceStatus,
        presenceUpdatedAt: presence.presenceUpdatedAt,
      }
    })
  }, [])

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
    <ProfileContext.Provider value={{ profile, profileLoading, profileError, refreshProfile: fetchProfile, applyProfile, updateProfilePresence }}>
      {children}
    </ProfileContext.Provider>
  )
}
