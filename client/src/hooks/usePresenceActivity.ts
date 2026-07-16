import { useEffect, useRef } from 'react'

const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000
const PRESENCE_ACTIVITY_THROTTLE_MS = 10_000

type UsePresenceActivityOptions = {
  enabled: boolean
  isRealtimeReady: boolean
  setPresenceActivity: (active: boolean) => void
}

function documentIsVisible() {
  return document.visibilityState === 'visible'
}

export function usePresenceActivity({ enabled, isRealtimeReady, setPresenceActivity }: UsePresenceActivityOptions) {
  const latestActivityRef = useRef(setPresenceActivity)
  const lastReportedActivityRef = useRef<{ active: boolean; atMs: number } | null>(null)

  useEffect(() => {
    latestActivityRef.current = setPresenceActivity
  }, [setPresenceActivity])

  useEffect(() => {
    if (!enabled || !isRealtimeReady) {
      return
    }

    const reportActivity = (active: boolean, force = false) => {
      const now = Date.now()
      const previous = lastReportedActivityRef.current

      if (!force && previous?.active === active && now - previous.atMs < PRESENCE_ACTIVITY_THROTTLE_MS) {
        return
      }

      lastReportedActivityRef.current = { active, atMs: now }
      latestActivityRef.current(active)
    }
    const reportCurrentActivity = () => {
      reportActivity(documentIsVisible())
    }
    const reportInactive = () => {
      reportActivity(false, true)
    }

    reportCurrentActivity()
    document.addEventListener('visibilitychange', reportCurrentActivity)
    window.addEventListener('pageshow', reportCurrentActivity)
    window.addEventListener('pagehide', reportInactive)
    window.addEventListener('pointerdown', reportCurrentActivity, { passive: true })
    window.addEventListener('keydown', reportCurrentActivity)
    window.addEventListener('touchstart', reportCurrentActivity, { passive: true })
    const heartbeat = window.setInterval(reportCurrentActivity, PRESENCE_HEARTBEAT_INTERVAL_MS)

    return () => {
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', reportCurrentActivity)
      window.removeEventListener('pageshow', reportCurrentActivity)
      window.removeEventListener('pagehide', reportInactive)
      window.removeEventListener('pointerdown', reportCurrentActivity)
      window.removeEventListener('keydown', reportCurrentActivity)
      window.removeEventListener('touchstart', reportCurrentActivity)
      reportInactive()
    }
  }, [enabled, isRealtimeReady])
}
