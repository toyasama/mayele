import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { api, type FriendProfileData, type PublicPlayer } from '../lib/api'
import { GAME_LABELS, LEVEL_LABELS, getPlayerProgress, type GameLevel, type GameType } from '../lib/game'

type FriendBadge = FriendProfileData['badges'][number]

function playerInitials(player: Pick<PublicPlayer, 'name' | 'username'> | null | undefined) {
  const source = player?.name || player?.username || 'Joueur'

  return (
    source
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'MJ'
  )
}

function playerHandle(player: PublicPlayer) {
  return player.username ? `@${player.username}` : 'Profil Mayele'
}

function gameLabel(value: string) {
  return GAME_LABELS[value as GameType] ?? value
}

function levelLabel(value: string) {
  return LEVEL_LABELS[value as GameLevel] ?? value
}

function formatResponseTime(value: number | null | undefined) {
  if (!value) {
    return '-'
  }

  if (value < 1000) {
    return `${value}ms`
  }

  const seconds = value / 1000
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value)
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function badgeRankClass(tier: FriendBadge['tier']) {
  if (['confirmed', 'sprinter_sharp', 'streak_solid', 'volume_pillar'].includes(tier)) {
    return 'rank-two'
  }

  if (['master', 'sprinter_flash', 'streak_long', 'volume_marathon'].includes(tier)) {
    return 'rank-three'
  }

  return 'rank-one'
}

function badgeFamilyIcon(badge: FriendBadge) {
  return badge.family === 'mastery' ? levelLabel(badge.level) : badge.familyLabel
}

function FriendAvatar({ player }: { player: PublicPlayer }) {
  if (player.avatarUrl) {
    return <img className="friend-profile-avatar" src={player.avatarUrl} alt="" />
  }

  return (
    <span className="friend-profile-avatar initials" aria-hidden="true">
      {playerInitials(player)}
    </span>
  )
}

function FriendBadgeCard({ badge }: { badge: FriendBadge }) {
  return (
    <article className={`card friend-badge-card badge-family-${badge.family}`} key={badge.key}>
      <span className={`badge-art ${badgeRankClass(badge.tier)}`} aria-hidden="true">
        <span className="badge-core">
          <span className="badge-family-icon">{badgeFamilyIcon(badge)}</span>
        </span>
        <span className="badge-tier-flourish" />
      </span>
      <div>
        <strong>{badge.title}</strong>
        <em>{badge.familyLabel}</em>
      </div>
    </article>
  )
}

function FriendSectionHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return (
    <div className="friend-profile-section-header">
      <div className="section-kicker compact-kicker">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {meta ? <span className="friend-profile-section-meta">{meta}</span> : null}
    </div>
  )
}

export function FriendProfilePage() {
  const { friendId } = useParams()
  const { getToken, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<FriendProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated || !friendId) {
      return
    }

    let active = true
    api
      .getFriendProfile(getToken, friendId)
      .then((payload) => {
        if (active) {
          setProfile(payload)
        }
      })
      .catch((caughtError) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Impossible de charger ce profil.')
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [friendId, getToken, isAuthenticated])

  const playerLevel = useMemo(() => (profile ? getPlayerProgress(profile.player.totalXp).level : 1), [profile])

  if (loading) {
    return (
      <section className="page friend-profile-page">
        <div className="card loading-card">Chargement du profil...</div>
      </section>
    )
  }

  if (error || !profile) {
    return (
      <section className="page friend-profile-page">
        <div className="friend-profile-topbar">
          <button className="secondary-button friend-profile-back" type="button" onClick={() => navigate('/amis')}>
            Retour aux amis
          </button>
        </div>
        <div className="card form-error">{error || 'Profil introuvable.'}</div>
      </section>
    )
  }

  return (
    <section className="page friend-profile-page">
      <div className="friend-profile-topbar">
        <button className="secondary-button friend-profile-back" type="button" onClick={() => navigate('/amis')}>
          Retour aux amis
        </button>
      </div>

      <header className="friend-profile-hero">
        <FriendAvatar player={profile.player} />
        <div className="friend-profile-hero-copy">
          <span className="eyebrow">Profil ami</span>
          <h1>{profile.player.name}</h1>
          <p>
            {playerHandle(profile.player)} - Niveau {playerLevel}
          </p>
        </div>
        <div className="friend-profile-summary" aria-label="Résumé du profil ami">
          <div>
            <span>Niveau</span>
            <strong>{playerLevel}</strong>
          </div>
          <div>
            <span>XP</span>
            <strong>{formatNumber(profile.player.totalXp)}</strong>
          </div>
          <div>
            <span>Badges</span>
            <strong>{profile.badges.length}</strong>
          </div>
        </div>
      </header>

      {profile.badges.length ? (
        <section className="friend-profile-section">
          <FriendSectionHeader eyebrow="Badges" title="Badges débloqués" meta={`${profile.badges.length} obtenus`} />
          <div className="friend-badge-grid">
            {profile.badges.map((badge) => (
              <FriendBadgeCard badge={badge} key={badge.key} />
            ))}
          </div>
        </section>
      ) : (
        <section className="friend-profile-section">
          <FriendSectionHeader eyebrow="Badges" title="Badges débloqués" />
          <article className="card friend-badge-card friend-badge-placeholder">
            <span className="badge-art locked rank-one" aria-hidden="true">
              <span className="badge-core">
                <span className="badge-family-icon">?</span>
              </span>
              <span className="badge-tier-flourish" />
              <span className="badge-lock-icon" aria-hidden="true" />
            </span>
            <div>
              <strong>Pas de badge</strong>
              <em>Profil en progression</em>
            </div>
          </article>
        </section>
      )}

      <section className="friend-profile-section">
        <FriendSectionHeader eyebrow="Modes" title="Progression par type de sprint" />

        <div className="friend-stat-grid">
          {profile.stats.byGame.map((item) => (
            <article className="card friend-stat-card" key={item.game}>
              <div className="friend-stat-topline">
                <strong>{gameLabel(item.game)}</strong>
                <span>{item.attempts ? `${item.averageAccuracy}%` : '-'}</span>
              </div>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${clampPercent(item.averageAccuracy)}%` }} />
              </div>
              <div className="friend-stat-metrics">
                <div>
                  <span>Sprints</span>
                  <strong>{item.attempts}</strong>
                </div>
                <div>
                  <span>Record</span>
                  <strong>{item.bestScore}%</strong>
                </div>
                <div>
                  <span>Série</span>
                  <strong>{item.bestStreak}</strong>
                </div>
                <div>
                  <span>Temps</span>
                  <strong>{formatResponseTime(item.averageResponseTimeMs)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="friend-profile-section">
        <FriendSectionHeader eyebrow="Niveaux" title="Répartition par difficulté" />

        <div className="friend-level-grid">
          {profile.stats.byLevel.map((item) => (
            <article className="card friend-level-card" key={item.level}>
              <div className="friend-stat-topline">
                <div>
                  <span>Niveau</span>
                  <strong>{levelLabel(item.level)}</strong>
                </div>
                <em>{item.attempts ? 'En cours' : 'À essayer'}</em>
              </div>
              <div className="friend-stat-metrics">
                <div>
                  <span>Sprints</span>
                  <strong>{item.attempts}</strong>
                </div>
                <div>
                  <span>Précision</span>
                  <strong>{item.averageAccuracy}%</strong>
                </div>
                <div>
                  <span>Record</span>
                  <strong>{item.bestScore}%</strong>
                </div>
                <div>
                  <span>Temps</span>
                  <strong>{formatResponseTime(item.averageResponseTimeMs)}</strong>
                </div>
              </div>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${clampPercent(item.averageAccuracy)}%` }} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
