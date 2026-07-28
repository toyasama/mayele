import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FriendRequestData, PresenceStatus, PublicPlayer } from '../../lib/api'
import { getPlayerProgress } from '../../lib/game'

export type SocialStatus = 'friend' | 'outgoing' | 'incoming'

export type SocialRosterEntry = {
  key: string
  status: SocialStatus
  player: PublicPlayer
  request?: FriendRequestData
}

type SocialRosterProps = {
  entries: SocialRosterEntry[]
  renderActions: (entry: SocialRosterEntry) => ReactNode
}

function initials(player: PublicPlayer) {
  return (player.name || player.username || 'MJ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MJ'
}

function presenceLabel(status: PresenceStatus) {
  if (status === 'online') return 'En ligne'
  if (status === 'away') return 'Absent'
  return 'Hors ligne'
}

function relationLabel(status: SocialStatus) {
  if (status === 'incoming') return 'Demande reçue'
  if (status === 'outgoing') return 'Demande envoyée'
  return 'Ami'
}

function lastActivityLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Activité inconnue'

  return `Vu le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)}`
}

function PlayerFace({ player, size = 'normal' }: { player: PublicPlayer; size?: 'normal' | 'large' }) {
  if (player.avatarUrl) {
    return <img className={`social-roster-avatar ${size}`} src={player.avatarUrl} alt="" />
  }

  return <span className={`social-roster-avatar initials ${size}`} aria-hidden="true">{initials(player)}</span>
}

export function SocialRoster({ entries, renderActions }: SocialRosterProps) {
  const defaultId = entries[0]?.player.id ?? null
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(defaultId)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.player.id === selectedPlayerId) ?? entries[0] ?? null,
    [entries, selectedPlayerId],
  )
  const selectedProgress = selectedEntry ? getPlayerProgress(selectedEntry.player.totalXp) : null

  useEffect(() => {
    if (!mobileDetailOpen) return undefined

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileDetailOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileDetailOpen])

  return (
    <section className="social-roster-layout profile-card-scroller" aria-label="Profils amis et demandes">
      <div className="social-roster-list" role="listbox" aria-label="Relations">
        {entries.map((entry) => {
          const selected = entry.player.id === selectedEntry?.player.id

          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              className={`profile-card social-roster-item status-${entry.status} ${selected ? 'active' : ''}`}
              key={entry.key}
              onClick={() => {
                setSelectedPlayerId(entry.player.id)
                setMobileDetailOpen(true)
              }}
            >
              <span className={`social-roster-presence presence-${entry.player.presenceStatus}`} aria-hidden="true" />
              <PlayerFace player={entry.player} />
              <span className="social-roster-copy">
                <strong>{entry.player.name}</strong>
                <small>{presenceLabel(entry.player.presenceStatus)}</small>
              </span>
              <span className="social-roster-relation">{relationLabel(entry.status)}</span>
            </button>
          )
        })}
      </div>

      {selectedEntry ? (
        <>
          <button
            type="button"
            className={`social-profile-backdrop ${mobileDetailOpen ? 'is-open' : ''}`}
            aria-label="Fermer le profil"
            onClick={() => setMobileDetailOpen(false)}
          />
          <article className={`profile-card social-profile-detail status-${selectedEntry.status} ${mobileDetailOpen ? 'mobile-open' : ''}`} aria-live="polite">
            <button type="button" className="social-profile-close" aria-label="Fermer le profil" onClick={() => setMobileDetailOpen(false)}>
              <span aria-hidden="true">×</span>
            </button>
            <div className="social-profile-identity">
              <PlayerFace player={selectedEntry.player} size="large" />
              <div>
                <span className={`profile-presence presence-${selectedEntry.player.presenceStatus}`}>
                  <span aria-hidden="true" />
                  {presenceLabel(selectedEntry.player.presenceStatus)}
                </span>
                <h3>{selectedEntry.player.name}</h3>
                <p>{selectedEntry.player.username ? `@${selectedEntry.player.username}` : 'Profil Mayele'}</p>
              </div>
            </div>

            <div className="social-profile-metrics">
              <div><span>Niveau</span><strong>{getPlayerProgress(selectedEntry.player.totalXp).level}</strong></div>
              <div><span>XP</span><strong>{new Intl.NumberFormat('fr-FR').format(selectedEntry.player.totalXp)}</strong></div>
              <div><span>Relation</span><strong>{relationLabel(selectedEntry.status)}</strong></div>
            </div>

            {selectedProgress ? (
              <div className="social-profile-progress">
                <div>
                  <span>Niveau {selectedProgress.level}</span>
                  <strong>{selectedProgress.isMaxLevel ? 'Niveau maximum' : `${selectedProgress.xpRemaining} XP avant le niveau ${selectedProgress.nextLevel}`}</strong>
                </div>
                <div className="social-profile-progress-bar" aria-label={`${selectedProgress.progress}% du niveau`}>
                  <i style={{ width: `${selectedProgress.progress}%` }} />
                </div>
                <small>{selectedEntry.player.presenceStatus === 'online' ? 'Disponible maintenant' : lastActivityLabel(selectedEntry.player.presenceUpdatedAt)}</small>
              </div>
            ) : null}

            <div className="profile-card-actions social-profile-actions">{renderActions(selectedEntry)}</div>
          </article>
        </>
      ) : null}
    </section>
  )
}
