import type { User as ClerkUser } from '@clerk/express'

const CLERK_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

type CacheEntry = {
  user: ClerkUser
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()

export function getClerkUserFromCache(clerkUserId: string): ClerkUser | null {
  const entry = cache.get(clerkUserId)

  if (!entry) {
    return null
  }

  if (Date.now() - entry.cachedAt > CLERK_CACHE_TTL_MS) {
    cache.delete(clerkUserId)
    return null
  }

  return entry.user
}

export function setClerkUserInCache(clerkUserId: string, user: ClerkUser) {
  cache.set(clerkUserId, { user, cachedAt: Date.now() })
}

export function invalidateClerkUserCache(clerkUserId: string) {
  cache.delete(clerkUserId)
}
