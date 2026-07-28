import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { NotificationData } from '../../lib/api'

type NotificationCenterProps = {
  notifications: NotificationData[]
  unreadCount: number
  open: boolean
  onToggle: () => void
  onMarkRead: (notification: NotificationData) => void
  onMarkAllRead: () => void
  onDelete: (notificationId: string) => void
}

function notificationTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function notificationDay(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const key = date.toDateString()

  if (key === today.toDateString()) return "Aujourd'hui"
  if (key === yesterday.toDateString()) return 'Hier'

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function notificationKind(type: string) {
  if (type.includes('friend')) return { symbol: 'A', label: 'Social' }
  if (type.includes('match') || type.includes('challenge')) return { symbol: 'VS', label: 'Défi' }
  if (type.includes('badge') || type.includes('level')) return { symbol: 'XP', label: 'Progression' }
  return { symbol: 'i', label: 'Information' }
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16l-2-2Z" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
    </svg>
  )
}

export function NotificationCenter({
  notifications,
  unreadCount,
  open,
  onToggle,
  onMarkRead,
  onMarkAllRead,
  onDelete,
}: NotificationCenterProps) {
  const groups = useMemo(() => {
    const grouped = new Map<string, NotificationData[]>()

    notifications.forEach((notification) => {
      const label = notificationDay(notification.createdAt)
      grouped.set(label, [...(grouped.get(label) ?? []), notification])
    })

    return Array.from(grouped.entries())
  }, [notifications])

  return (
    <div className="notification-center">
      <button
        className="notification-bell-button"
        type="button"
        aria-label="Centre de notifications"
        aria-expanded={open}
        onClick={onToggle}
      >
        <BellIcon />
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
      </button>

      {open ? (
        <aside className="notification-panel" aria-label="Notifications récentes">
          <div className="notification-panel-heading">
            <div>
              <span className="eyebrow">Activité</span>
              <strong>Notifications</strong>
            </div>
            <button type="button" disabled={!unreadCount} onClick={onMarkAllRead}>
              Tout marquer comme lu
            </button>
          </div>

          {groups.length ? (
            <div className="notification-list">
              {groups.map(([label, items]) => (
                <section className="notification-group" aria-labelledby={`notifications-${label}`} key={label}>
                  <h3 id={`notifications-${label}`}>{label}</h3>
                  <div className="notification-group-items">
                    {items.map((notification) => {
                      const kind = notificationKind(notification.type)
                      const content = (
                        <>
                          <span className="notification-kind" aria-hidden="true">{kind.symbol}</span>
                          <span className="notification-item-copy">
                            <span className="notification-item-title">{notification.title}</span>
                            {notification.body ? <span className="notification-item-body">{notification.body}</span> : null}
                            <span className="notification-item-meta">{kind.label} · {notificationTime(notification.createdAt)}</span>
                          </span>
                        </>
                      )

                      return (
                        <article key={notification.id} className={`notification-item ${notification.readAt ? '' : 'unread'}`}>
                          {notification.href ? (
                            <Link className="notification-item-content" to={notification.href} onClick={() => onMarkRead(notification)}>
                              {content}
                            </Link>
                          ) : (
                            <button className="notification-item-content" type="button" onClick={() => onMarkRead(notification)}>
                              {content}
                            </button>
                          )}
                          <button
                            className="notification-delete-button"
                            type="button"
                            aria-label={`Supprimer la notification ${notification.title}`}
                            onClick={() => onDelete(notification.id)}
                          >
                            ×
                          </button>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="notification-empty">
              <strong>Tout est calme.</strong>
              <span>Vos défis, invitations et récompenses apparaîtront ici.</span>
            </div>
          )}
        </aside>
      ) : null}
    </div>
  )
}
