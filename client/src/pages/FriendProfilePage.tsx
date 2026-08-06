import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ResponsiveTabs } from '../components/layout/ResponsiveTabs'
import { useAuth } from '../context/auth'
import { FriendChallengeHistory } from '../features/social/FriendChallengeHistory'
import { FriendPerformanceSummary } from '../features/social/FriendPerformanceSummary'
import { api, type FriendProfileData, type PublicPlayer } from '../lib/api'
import { LEVEL_LABELS, getPlayerProgress, type GameLevel, type GameType } from '../lib/game'
import '../styles/routes/friend-profile.css'

type FriendBadge = FriendProfileData['badges'][number]
type FriendProfileView = 'duels' | 'stats'

const FRIEND_PROFILE_VIEWS: FriendProfileView[] = ['duels', 'stats']
const FRIEND_PROFILE_TABS: Array<{ label: string; value: FriendProfileView }> = [
  { label: 'Duels', value: 'duels' },
  { label: 'Stats', value: 'stats' },
]

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
  if (badge.family === 'mastery') {
    return levelLabel(badge.level).slice(0, 1)
  }

  return ({ speed: 'V', streak: 'S', volume: 'XP' } as Record<string, string>)[badge.family]
    ?? badge.familyLabel.slice(0, 2).toUpperCase()
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

export function FriendProfilePage() {
  const { friendId } = useParams()
  const { getToken, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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

  const playerLevel = profile ? getPlayerProgress(profile.player.totalXp).level : 1
  const viewParam = searchParams.get('view') as FriendProfileView | null
  const activeView = viewParam && FRIEND_PROFILE_VIEWS.includes(viewParam) ? viewParam : 'duels'
  const loadFriendOperationHistory = useCallback(async (game: GameType, level: GameLevel) => {
    if (!friendId) {
      return []
    }

    const result = await api.getFriendOperationHistory(getToken, friendId, game, level)
    return result.sessions
  }, [friendId, getToken])

  function selectProfileView(view: FriendProfileView) {
    const nextParams = new URLSearchParams(searchParams)

    if (view === 'duels') {
      nextParams.delete('view')
    } else {
      nextParams.set('view', view)
    }

    setSearchParams(nextParams)
    window.scrollTo({ top: 0 })
  }

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
    <section className={`page friend-profile-page friend-profile-active-${activeView}`}>
      <div className="friend-profile-topbar">
        <button className="secondary-button friend-profile-back" type="button" onClick={() => navigate('/amis')}>
          Retour aux amis
        </button>
      </div>

      <header className="friend-profile-hero friend-versus-stage friend-profile-identity-stage">
        <div className="friend-versus-player">
          <FriendAvatar player={profile.player} />
          <div className="friend-profile-hero-copy">
            <span className="eyebrow">Profil ami</span>
            <h1>{profile.player.name}</h1>
            <p>
              {playerHandle(profile.player)} · Niveau {playerLevel}
            </p>

            <div className="friend-profile-inline-badges">
              <div className="friend-profile-inline-badges-heading">
                <span className="eyebrow">Badges</span>
                <strong>{profile.badges.length ? `${profile.badges.length} débloqué${profile.badges.length > 1 ? 's' : ''}` : 'En progression'}</strong>
              </div>
              <div className="friend-badge-grid" aria-label="Badges débloqués">
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
            </div>
          </div>
        </div>
      </header>

      <ResponsiveTabs
        ariaLabel="Sections du profil ami"
        className="friend-profile-section-nav"
        options={FRIEND_PROFILE_TABS}
        value={activeView}
        onChange={selectProfileView}
      />

      <div className={`friend-profile-view-panel friend-profile-duels-panel ${activeView === 'duels' ? 'active' : ''}`}>
        <FriendChallengeHistory
          friendName={profile.player.name}
          headToHead={profile.headToHead}
          onChallenge={() => navigate('/jeu/multijoueur')}
        />
      </div>

      <div className={`friend-profile-view-panel friend-profile-stats-panel ${activeView === 'stats' ? 'active' : ''}`}>
        <FriendPerformanceSummary
          stats={profile.stats}
          progressByMode={profile.progressByMode}
          loadOperationHistory={loadFriendOperationHistory}
        />
      </div>
    </section>
  )
}
