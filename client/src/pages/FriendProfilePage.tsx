import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { FriendChallengeHistory } from '../features/social/FriendChallengeHistory'
import { FriendPerformanceSummary } from '../features/social/FriendPerformanceSummary'
import { api, type FriendProfileData, type PublicPlayer } from '../lib/api'
import { LEVEL_LABELS, getPlayerProgress, type GameLevel } from '../lib/game'
import '../styles/routes/friend-profile.css'

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

function levelLabel(value: string) {
  return LEVEL_LABELS[value as GameLevel] ?? value
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
    api.getFriendProfile(getToken, friendId)
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

      <header className="friend-profile-hero friend-versus-stage">
        <div className="friend-versus-player">
          <FriendAvatar player={profile.player} />
          <div className="friend-profile-hero-copy">
            <span className="eyebrow">Profil ami</span>
            <h1>{profile.player.name}</h1>
            <p>
              {playerHandle(profile.player)} · Niveau {playerLevel}
            </p>
          </div>
        </div>

        <aside className="friend-challenge-card" aria-label="Défier cet ami">
          <div className="friend-challenge-heading">
            <span className="eyebrow">Face-à-face</span>
            <strong>{profile.headToHead?.summary.wins ?? 0} — {profile.headToHead?.summary.losses ?? 0}</strong>
          </div>
          <div className="friend-versus-record" aria-label="Bilan des défis">
            <span><strong>{profile.headToHead?.summary.wins ?? 0}</strong> gagnés</span>
            <span><strong>{profile.headToHead?.summary.losses ?? 0}</strong> perdus</span>
            <span><strong>{profile.headToHead?.summary.draws ?? 0}</strong> nuls</span>
          </div>
          <button className="primary-button" type="button" onClick={() => navigate('/jeu/multijoueur')}>
            Défier {profile.player.name}
          </button>
        </aside>
      </header>

      <FriendChallengeHistory friendName={profile.player.name} headToHead={profile.headToHead} />

      <FriendPerformanceSummary stats={profile.stats} />

      <section className="friend-profile-section">
        <FriendSectionHeader
          eyebrow="Badges"
          title="Badges débloqués"
          meta={profile.badges.length ? `${profile.badges.length} obtenus` : undefined}
        />
        <div className="friend-badge-grid">
          {profile.badges.length ? (
            profile.badges.map((badge) => (
              <FriendBadgeCard badge={badge} key={badge.key} />
            ))
          ) : (
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
          )}
        </div>
      </section>

    </section>
  )
}
