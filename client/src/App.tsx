import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/layout/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { TimeZonePrompt } from './components/TimeZonePrompt'
import { useAuth } from './context/auth'
import { useProfile } from './context/profile-context'
import { useRealtimeEvents } from './hooks/useRealtimeEvents'
import { DASHBOARD_CACHE_PREFIX, readCache, SOCIAL_CACHE_PREFIX, userCacheKey, writeCache } from './lib/appCache'
import { api, ApiRequestError, type DashboardData, type FriendRequestData, type NotificationData, type PresenceStatus, type PublicPlayer } from './lib/api'
import { formatDisplayName } from './lib/profile'
import { HomePage } from './pages/HomePage'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const FriendProfilePage = lazy(() => import('./pages/FriendProfilePage').then((module) => ({ default: module.FriendProfilePage })))
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((module) => ({ default: module.FriendsPage })))
const GamePage = lazy(() => import('./pages/GamePage').then((module) => ({ default: module.GamePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const MultiplayerGamePage = lazy(() => import('./pages/MultiplayerGamePage').then((module) => ({ default: module.MultiplayerGamePage })))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage').then((module) => ({ default: module.ProfileSettingsPage })))
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((module) => ({ default: module.RegisterPage })))

type SocialOverview = {
  friends: PublicPlayer[]
  incoming: FriendRequestData[]
  outgoing: FriendRequestData[]
}

type FloatingToast = {
  id: string
  notificationId?: string
  title: string
  body?: string | null
  href?: string | null
  variant?: 'info' | 'success'
}

type ToastEventDetail = {
  title: string
  body?: string | null
  href?: string | null
  variant?: 'info' | 'success'
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function reportBackgroundError(context: string, error: unknown) {
  if (error instanceof ApiRequestError && (error.status === 401 || error.code === 'profile_incomplete')) {
    return
  }

  if (import.meta.env.DEV) {
    console.warn(`[Mayele] ${context}`, error)
  }
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16l-2-2Z" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
    </svg>
  )
}

function App() {
  const { user, isAuthenticated, logout, getToken } = useAuth()
  const { profile, refreshProfile } = useProfile()
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [notifications, setNotifications] = useState<NotificationData[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [floatingToasts, setFloatingToasts] = useState<FloatingToast[]>([])
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const notificationsLoadedRef = useRef(false)
  const displayUser = profile ?? user
  const displayName = formatDisplayName(displayUser)
  const presenceStatus = displayUser?.presenceStatus ?? 'online'

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

  useRealtimeEvents({
    isAuthenticated: Boolean(isAuthenticated && profile?.profileComplete),
    getToken,
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

  useEffect(() => {
    if (!isAuthenticated || !profile?.profileComplete) {
      knownNotificationIdsRef.current = new Set()
      notificationsLoadedRef.current = false
      setNotifications([])
      setUnreadNotifications(0)
      setFloatingToasts([])
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

  useEffect(() => {
    if (!isAuthenticated || !profile?.profileComplete) {
      return
    }

    const dashboardCacheKey = userCacheKey(DASHBOARD_CACHE_PREFIX, profile.clerkUserId)
    const socialCacheKey = userCacheKey(SOCIAL_CACHE_PREFIX, profile.clerkUserId)
    const schedule =
      'requestIdleCallback' in window
        ? window.requestIdleCallback.bind(window)
        : (callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 100)
    const cancel =
      'cancelIdleCallback' in window
        ? window.cancelIdleCallback.bind(window)
        : (handle: number) => window.clearTimeout(handle)
    const handle = schedule(() => {
      const path = window.location.pathname

      if (path !== '/dashboard' && !readCache<DashboardData>(dashboardCacheKey)) {
        void api.getDashboard(getToken).then((payload) => writeCache(dashboardCacheKey, payload)).catch((error) => {
          reportBackgroundError('Prechargement du tableau de bord impossible.', error)
        })
      }

      if (path !== '/amis' && !readCache<SocialOverview>(socialCacheKey)) {
        void api.getSocialOverview(getToken).then((payload) => writeCache(socialCacheKey, payload)).catch((error) => {
          reportBackgroundError('Prechargement social impossible.', error)
        })
      }
    })

    return () => cancel(handle)
  }, [getToken, isAuthenticated, profile?.clerkUserId, profile?.profileComplete])

  function handleLogout() {
    void logout()
  }

  async function handlePresenceChange(nextStatus: PresenceStatus) {
    setPresenceSaving(true)

    try {
      await api.updatePresenceStatus(getToken, nextStatus)
      await refreshProfile()
    } catch (error) {
      reportBackgroundError('Mise a jour de presence impossible.', error)
      await refreshProfile()
    } finally {
      setPresenceSaving(false)
    }
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

  function renderPresenceControl(className = '') {
    return (
      <label className={`presence-control presence-${presenceStatus} ${className}`}>
        <span className="presence-dot" aria-hidden="true" />
        <select
          aria-label="Statut en ligne"
          value={presenceStatus}
          disabled={presenceSaving}
          onChange={(event) => void handlePresenceChange(event.target.value as PresenceStatus)}
        >
          <option value="online">En ligne</option>
          <option value="away">Absent</option>
          <option value="busy">Occupe</option>
          <option value="offline">Hors ligne</option>
        </select>
      </label>
    )
  }

  function renderNotificationCenter() {
    return (
      <div className="notification-center">
        <button
          className="notification-bell-button"
          type="button"
          aria-label="Centre de notifications"
          aria-expanded={notificationPanelOpen}
          onClick={() => setNotificationPanelOpen((current) => !current)}
        >
          <BellIcon />
          {unreadNotifications > 0 ? <span className="notification-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span> : null}
        </button>

        {notificationPanelOpen ? (
          <div className="notification-panel">
            <div className="notification-panel-heading">
              <strong>Notifications</strong>
              <button type="button" disabled={!unreadNotifications} onClick={() => void handleMarkAllNotificationsRead()}>
                Tout lu
              </button>
            </div>

            {notifications.length ? (
              <div className="notification-list">
                {notifications.map((notification) => {
                  const content = (
                    <>
                      <span className="notification-item-title">{notification.title}</span>
                      {notification.body ? <span className="notification-item-body">{notification.body}</span> : null}
                      <span className="notification-item-time">{formatNotificationDate(notification.createdAt)}</span>
                    </>
                  )

                  return (
                    <article key={notification.id} className={`notification-item ${notification.readAt ? '' : 'unread'}`}>
                      {notification.href ? (
                        <Link className="notification-item-content" to={notification.href} onClick={() => void handleMarkNotificationRead(notification)}>
                          {content}
                        </Link>
                      ) : (
                        <button className="notification-item-content" type="button" onClick={() => void handleMarkNotificationRead(notification)}>
                          {content}
                        </button>
                      )}
                      <button
                        className="notification-delete-button"
                        type="button"
                        aria-label="Supprimer la notification"
                        onClick={() => void handleDeleteNotification(notification.id)}
                      >
                        x
                      </button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="notification-empty">Aucune notification.</div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  const routes = (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate replace to="/dashboard" /> : <HomePage />} />
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
        notificationsSlot={isAuthenticated ? renderNotificationCenter() : null}
        presenceSlot={isAuthenticated ? renderPresenceControl : undefined}
        onLogout={handleLogout}
      >
        {isAuthenticated ? <TimeZonePrompt /> : null}
        <ErrorBoundary>
          <Suspense fallback={<div className="page-loading" role="status">Chargement...</div>}>{routes}</Suspense>
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
