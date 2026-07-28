import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/layout/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RouteContentReady } from './components/RouteContentReady'
import { TimeZonePrompt } from './components/TimeZonePrompt'
import { useAuth } from './context/auth'
import { useProfile } from './context/profile-context'
import { NotificationCenter } from './features/notifications/NotificationCenter'
import { usePresenceActivity } from './hooks/usePresenceActivity'
import { useRealtimeEvents } from './hooks/useRealtimeEvents'
import { api, ApiRequestError, type NotificationData, type PresenceStatus } from './lib/api'
import { formatDisplayName } from './lib/profile'
import { DEFAULT_AUTHENTICATED_ROUTE } from './lib/routes'
import { HomePage } from './pages/HomePage'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const FriendProfilePage = lazy(() => import('./pages/FriendProfilePage').then((module) => ({ default: module.FriendProfilePage })))
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((module) => ({ default: module.FriendsPage })))
const GamePage = lazy(() => import('./pages/GamePage').then((module) => ({ default: module.GamePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const MultiplayerGamePage = lazy(() => import('./pages/MultiplayerGamePage').then((module) => ({ default: module.MultiplayerGamePage })))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage').then((module) => ({ default: module.ProfileSettingsPage })))
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((module) => ({ default: module.RegisterPage })))

type FloatingToast = {
  id: string
  notificationId?: string
  title: string
  body?: string | null
  href?: string | null
  variant?: 'error' | 'info' | 'success'
}

type ToastEventDetail = {
  title: string
  body?: string | null
  href?: string | null
  variant?: 'error' | 'info' | 'success'
}

function reportBackgroundError(context: string, error: unknown) {
  if (error instanceof ApiRequestError && (error.status === 401 || error.code === 'profile_incomplete')) {
    return
  }

  if (import.meta.env.DEV) {
    console.warn(`[Mayele] ${context}`, error)
  }
}

function App() {
  const { user, isAuthenticated, logout, getToken } = useAuth()
  const { profile, updateProfilePresence } = useProfile()
  const location = useLocation()
  const [readyRouteKey, setReadyRouteKey] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationData[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [floatingToasts, setFloatingToasts] = useState<FloatingToast[]>([])
  const [presenceHidden, setPresenceHidden] = useState(false)
  const [presenceVisibilityUpdating, setPresenceVisibilityUpdating] = useState(false)
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const notificationsLoadedRef = useRef(false)
  const displayUser = profile ?? user
  const displayName = formatDisplayName(displayUser)
  const presenceStatus = displayUser?.presenceStatus ?? 'offline'
  const routeContentReady = readyRouteKey === location.key

  const handleRouteContentReady = useCallback((routeKey: string) => {
    setReadyRouteKey(routeKey)
  }, [])

  const addFloatingToast = useCallback((toast: FloatingToast) => {
    setFloatingToasts((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== toast.id)
      return [toast, ...withoutDuplicate].slice(0, 4)
    })
  }, [])

  const dismissFloatingToast = useCallback((toastId: string) => {
    setFloatingToasts((current) => current.filter((toast) => toast.id !== toastId))
  }, [])

  const refreshNotifications = useCallback(
    async (options: { showToasts?: boolean } = {}) => {
      if (!isAuthenticated || !profile?.profileComplete) {
        setNotifications([])
        setUnreadNotifications(0)
        return
      }

      const payload = await api.getNotifications(getToken)
      const activeNotificationIds = new Set(payload.notifications.map((notification) => notification.id))

      setNotifications(payload.notifications)
      setUnreadNotifications(payload.unreadCount)
      setFloatingToasts((current) => current.filter((toast) => !toast.notificationId || activeNotificationIds.has(toast.notificationId)))

      if (options.showToasts && notificationsLoadedRef.current) {
        for (const notification of payload.notifications) {
          if (!notification.readAt && !knownNotificationIdsRef.current.has(notification.id)) {
            addFloatingToast({
              id: `notification:${notification.id}`,
              notificationId: notification.id,
              title: notification.title,
              body: notification.body,
              href: notification.href,
              variant: 'info',
            })
          }
        }
      }

      knownNotificationIdsRef.current = activeNotificationIds
      notificationsLoadedRef.current = true
    },
    [addFloatingToast, getToken, isAuthenticated, profile?.profileComplete],
  )

  const applyRealtimeNotification = useCallback((notification: NotificationData) => {
    const wasKnown = knownNotificationIdsRef.current.has(notification.id)
    const nextKnownNotificationIds = new Set(knownNotificationIdsRef.current)
    nextKnownNotificationIds.add(notification.id)
    knownNotificationIdsRef.current = nextKnownNotificationIds
    notificationsLoadedRef.current = true

    setNotifications((current) => [
      notification,
      ...current.filter((item) => item.id !== notification.id),
    ].slice(0, 20))

    if (!notification.readAt && !wasKnown) {
      setUnreadNotifications((current) => current + 1)
      addFloatingToast({
        id: `notification:${notification.id}`,
        notificationId: notification.id,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        variant: 'info',
      })
    }
  }, [addFloatingToast])

  const realtime = useRealtimeEvents({
    isAuthenticated: Boolean(isAuthenticated && profile?.profileComplete && routeContentReady),
    getToken,
    connectionPriority: 'background',
    onPresenceChanged: (payload) => updateProfilePresence(payload.player),
    onPresenceVisibilityChanged: (payload) => setPresenceHidden(payload.hidden),
    onNotificationsChanged: (payload) => {
      if (payload.notification) {
        applyRealtimeNotification(payload.notification)
        return
      }

      if (payload.reason === 'notification_created') {
        reportBackgroundError('Notification temps reel incomplete.', new Error('notification_created_missing_payload'))
        return
      }

      void refreshNotifications({ showToasts: true }).catch((error) => {
        reportBackgroundError('Synchronisation des notifications impossible.', error)
      })
    },
    onConnectionError: (error) => reportBackgroundError('Connexion temps reel impossible.', error),
  })

  usePresenceActivity({
    enabled: Boolean(isAuthenticated && profile?.profileComplete),
    isRealtimeReady: realtime.isRealtimeReady,
    setPresenceActivity: realtime.setPresenceActivity,
  })

  useEffect(() => {
    if (!isAuthenticated || !profile?.profileComplete) {
      knownNotificationIdsRef.current = new Set()
      notificationsLoadedRef.current = false
      setNotifications([])
      setUnreadNotifications(0)
      setFloatingToasts([])
      setPresenceHidden(false)
      setPresenceVisibilityUpdating(false)
      return
    }

    void refreshNotifications().catch((error) => {
      reportBackgroundError('Chargement des notifications impossible.', error)
    })
  }, [isAuthenticated, profile?.profileComplete, refreshNotifications])

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastEventDetail>).detail

      if (!detail?.title) {
        return
      }

      addFloatingToast({
        id: `toast:${Date.now()}:${Math.random()}`,
        title: detail.title,
        body: detail.body ?? null,
        href: detail.href ?? null,
        variant: detail.variant ?? 'success',
      })
    }

    window.addEventListener('mayele:toast', handleToast)
    return () => window.removeEventListener('mayele:toast', handleToast)
  }, [addFloatingToast])

  useEffect(() => {
    if (!floatingToasts.length) {
      return
    }

    const timers = floatingToasts.map((toast) => window.setTimeout(() => dismissFloatingToast(toast.id), 6500))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [dismissFloatingToast, floatingToasts])

  function handleLogout() {
    void logout()
  }

  async function handleMarkNotificationRead(notification: NotificationData) {
    if (notification.readAt) {
      setNotificationPanelOpen(false)
      return
    }

    try {
      const payload = await api.markNotificationRead(getToken, notification.id)
      setNotifications(payload.notifications)
      setUnreadNotifications(payload.unreadCount)
      knownNotificationIdsRef.current = new Set(payload.notifications.map((item) => item.id))
    } catch (error) {
      reportBackgroundError('Marquage notification impossible.', error)
      void refreshNotifications().catch((refreshError) => {
        reportBackgroundError('Resynchronisation des notifications impossible.', refreshError)
      })
    } finally {
      setNotificationPanelOpen(false)
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      const payload = await api.markAllNotificationsRead(getToken)
      setNotifications(payload.notifications)
      setUnreadNotifications(payload.unreadCount)
      knownNotificationIdsRef.current = new Set(payload.notifications.map((item) => item.id))
    } catch (error) {
      reportBackgroundError('Marquage des notifications impossible.', error)
      void refreshNotifications().catch((refreshError) => {
        reportBackgroundError('Resynchronisation des notifications impossible.', refreshError)
      })
    }
  }

  async function handleDeleteNotification(notificationId: string) {
    try {
      const payload = await api.deleteNotification(getToken, notificationId)
      setNotifications(payload.notifications)
      setUnreadNotifications(payload.unreadCount)
      knownNotificationIdsRef.current = new Set(payload.notifications.map((item) => item.id))
    } catch (error) {
      reportBackgroundError('Suppression notification impossible.', error)
      void refreshNotifications().catch((refreshError) => {
        reportBackgroundError('Resynchronisation des notifications impossible.', refreshError)
      })
    }
  }

  function presenceLabel(status: PresenceStatus) {
    if (status === 'online') {
      return 'En ligne'
    }

    if (status === 'away') {
      return 'Absent'
    }

    return 'Hors ligne'
  }

  async function togglePresenceVisibility() {
    if (!realtime.isRealtimeReady || presenceVisibilityUpdating) {
      return
    }

    const nextVisible = presenceHidden
    setPresenceVisibilityUpdating(true)

    try {
      const payload = await realtime.setPresenceVisibility(nextVisible)
      setPresenceHidden(payload.hidden)
    } catch (error) {
      addFloatingToast({
        id: 'presence-visibility-error',
        title: 'Statut non modifie',
        body: error instanceof Error ? error.message : 'Impossible de mettre a jour votre statut.',
        variant: 'error',
      })
    } finally {
      setPresenceVisibilityUpdating(false)
    }
  }

  function renderPresenceIndicator(className = '') {
    const effectivePresenceStatus = presenceHidden ? 'offline' : presenceStatus
    const currentLabel = presenceLabel(effectivePresenceStatus)
    const actionLabel = presenceHidden ? 'Apparaitre en ligne' : 'Apparaitre hors ligne'

    return (
      <button
        className={`presence-control presence-control-button presence-${effectivePresenceStatus} ${className}`}
        type="button"
        aria-label={actionLabel}
        aria-pressed={presenceHidden}
        disabled={!realtime.isRealtimeReady || presenceVisibilityUpdating}
        title={actionLabel}
        onClick={() => void togglePresenceVisibility()}
      >
        <span className="presence-dot" aria-hidden="true" />
        <span className="presence-label">{currentLabel}</span>
      </button>
    )
  }

  const routes = (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate replace to={DEFAULT_AUTHENTICATED_ROUTE} /> : <HomePage />} />
      <Route path="/connexion/*" element={<LoginPage />} />
      <Route path="/inscription/*" element={<RegisterPage />} />
      <Route
        path="/profil/configuration"
        element={
          <ProtectedRoute requireCompleteProfile={false}>
            <ProfileSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="/jeu" element={<Navigate replace to="/jeu/solo" />} />
      <Route
        path="/jeu/solo"
        element={
          <ProtectedRoute>
            <GamePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jeu/multijoueur"
        element={
          <ProtectedRoute>
            <MultiplayerGamePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/amis"
        element={
          <ProtectedRoute>
            <FriendsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/amis/:friendId"
        element={
          <ProtectedRoute>
            <FriendProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate replace to={isAuthenticated ? '/dashboard' : '/'} />} />
    </Routes>
  )

  return (
    <>
      <AppShell
        authenticated={isAuthenticated}
        displayName={displayName}
        displayUser={displayUser}
        notificationsSlot={isAuthenticated ? (
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadNotifications}
            open={notificationPanelOpen}
            onToggle={() => setNotificationPanelOpen((current) => !current)}
            onMarkRead={(notification) => void handleMarkNotificationRead(notification)}
            onMarkAllRead={() => void handleMarkAllNotificationsRead()}
            onDelete={(notificationId) => void handleDeleteNotification(notificationId)}
          />
        ) : null}
        presenceSlot={isAuthenticated ? renderPresenceIndicator : undefined}
        onLogout={handleLogout}
      >
        {isAuthenticated ? <TimeZonePrompt /> : null}
        <ErrorBoundary>
          <Suspense fallback={<div className="page-loading" role="status">Chargement...</div>}>
            {routes}
            <RouteContentReady routeKey={location.key} onReady={handleRouteContentReady} />
          </Suspense>
        </ErrorBoundary>
      </AppShell>

      {floatingToasts.length ? (
        <div className="floating-toast-stack" aria-live="polite" aria-label="Messages">
          {floatingToasts.map((toast) => {
            const content = (
              <>
                <strong>{toast.title}</strong>
                {toast.body ? <span>{toast.body}</span> : null}
              </>
            )

            return (
              <div key={toast.id} className={`floating-toast toast-${toast.variant ?? 'info'}`}>
                {toast.href ? (
                  <Link to={toast.href} onClick={() => dismissFloatingToast(toast.id)}>
                    {content}
                  </Link>
                ) : (
                  <div>{content}</div>
                )}
                <button type="button" aria-label="Fermer" onClick={() => dismissFloatingToast(toast.id)}>
                  x
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

export default App
