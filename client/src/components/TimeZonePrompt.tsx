import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/auth'
import { useProfile } from '../context/profile-context'
import { clearCachePrefix, DASHBOARD_CACHE_PREFIX } from '../lib/appCache'
import { api } from '../lib/api'
import { detectBrowserTimeZone, isValidTimeZone } from '../lib/timeZone'

function dismissalKey(userId: string, profileTimeZone: string, browserTimeZone: string) {
  return `mayele:timezone-dismissed:${userId}:${profileTimeZone}:${browserTimeZone}`
}

function wasDismissed(key: string) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function dismiss(key: string) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    // Session storage can be unavailable in restricted browser modes.
  }
}

export function TimeZonePrompt() {
  const { getToken } = useAuth()
  const { profile, profileLoading, profileError, refreshProfile } = useProfile()
  const browserTimeZone = useMemo(() => detectBrowserTimeZone(), [])
  const key = profile ? dismissalKey(profile.clerkUserId, profile.timeZone, browserTimeZone) : null
  const [hidden, setHidden] = useState(() => (key ? wasDismissed(key) : false))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setHidden(key ? wasDismissed(key) : false)
    setError('')
  }, [key])

  if (
    profileLoading ||
    profileError ||
    !profile?.profileComplete ||
    hidden ||
    !isValidTimeZone(browserTimeZone) ||
    profile.timeZone === browserTimeZone
  ) {
    return null
  }

  async function handleAccept() {
    setSaving(true)
    setError('')

    try {
      await api.updateTimeZone(getToken, browserTimeZone)
      clearCachePrefix(DASHBOARD_CACHE_PREFIX)
      await refreshProfile()
      setHidden(true)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de mettre a jour le fuseau horaire.')
    } finally {
      setSaving(false)
    }
  }

  function handleDismiss() {
    if (key) {
      dismiss(key)
    }

    setHidden(true)
  }

  return (
    <section className="timezone-prompt" aria-label="Fuseau horaire">
      <div>
        <strong>Fuseau detecte: {browserTimeZone}</strong>
        <span>Vos missions sont actuellement calees sur {profile.timeZone}.</span>
        {error ? <span className="timezone-prompt-error">{error}</span> : null}
      </div>
      <div className="timezone-prompt-actions">
        <button className="secondary-button" type="button" onClick={handleDismiss}>
          Plus tard
        </button>
        <button className="primary-button" type="button" onClick={() => void handleAccept()} disabled={saving}>
          {saving ? 'Mise a jour...' : 'Utiliser ce fuseau'}
        </button>
      </div>
    </section>
  )
}
