// V6 invalidates dashboard payloads that still contain the pre-V2 mission shape.
export const DASHBOARD_CACHE_PREFIX = 'mayele.dashboard.v6.'
export const SOCIAL_CACHE_PREFIX = 'mayele.social.v1.'

export function userCacheKey(prefix: string, clerkUserId: string) {
  return `${prefix}${clerkUserId}`
}

export function readCache<T>(key: string) {
  try {
    const cached = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
    return cached ? (JSON.parse(cached) as T) : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, payload: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(payload))
    } catch {
      // Cache persistence is best-effort.
    }
  }
}

export function clearCachePrefix(prefix: string) {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
        (key): key is string => Boolean(key && key.startsWith(prefix)),
      )

      keys.forEach((key) => storage.removeItem(key))
    } catch {
      // Cache invalidation is best-effort.
    }
  }
}
