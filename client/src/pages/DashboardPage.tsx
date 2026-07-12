import { useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageFrame } from '../components/layout/PageFrame'
import { ResponsiveTabs } from '../components/layout/ResponsiveTabs'
import { useAuth } from '../context/auth'
import { DASHBOARD_CACHE_PREFIX, readCache, userCacheKey, writeCache } from '../lib/appCache'
import { api, type DashboardData } from '../lib/api'
import { GAME_LABELS, LEVEL_LABELS, SKILL_LABELS, getPlayerProgress, type GameLevel, type GameType, type SkillTag } from '../lib/game'
import { formatDisplayName } from '../lib/profile'

type ProgressItem = DashboardData['progressByMode'][number]
type BadgeItem = DashboardData['badges'][number]
type DashboardMobileTab = 'overview' | 'stats' | 'missions' | 'history'
type DashboardProfileSource = {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  username?: string | null
  avatarUrl?: string | null
}

const LEVEL_ORDER: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']
const GAME_ORDER: GameType[] = ['addition', 'soustraction', 'multiplication', 'division', 'mixte']
const BADGE_FAMILY_ORDER = ['mastery', 'speed', 'streak', 'volume']
const DASHBOARD_VIEWS: DashboardMobileTab[] = ['overview', 'stats', 'missions', 'history']

function dashboardCacheKey(clerkUserId: string) {
  return userCacheKey(DASHBOARD_CACHE_PREFIX, clerkUserId)
}

function readCachedDashboard(key: string) {
  return readCache<DashboardData>(key)
}

function writeCachedDashboard(key: string, payload: DashboardData) {
  writeCache(key, payload)
}

function profileInitials(profile: DashboardProfileSource | null | undefined) {
  const source =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    profile?.name ||
    profile?.username ||
    'Mayele'

  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MJ'
}

function DashboardProfileAvatar({ profile }: { profile: DashboardProfileSource | null | undefined }) {
  if (profile?.avatarUrl) {
    return <img className="dashboard-profile-avatar" src={profile.avatarUrl} alt="" />
  }

  return (
    <span className="dashboard-profile-avatar initials" aria-hidden="true">
      {profileInitials(profile)}
    </span>
  )
}

function profileHandle(profile: DashboardProfileSource | null | undefined) {
  return profile?.username ? `@${profile.username}` : 'Profil Mayele'
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Pas encore joué'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatResponseTime(value: number | null | undefined) {
  if (!value) {
    return '—'
  }

  if (value < 1000) {
    return `${value}ms`
  }

  const seconds = value / 1000
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`
}

function formatSignedPercent(value: number) {
  if (!value) {
    return 'stable'
  }

  return `${value > 0 ? '+' : ''}${value}%`
}

function formatSignedNumber(value: number) {
  if (!value) {
    return 'stable'
  }

  return `${value > 0 ? '+' : ''}${value}`
}

function gameLabel(value: string) {
  return GAME_LABELS[value as GameType] ?? value
}

function levelLabel(value: string | null) {
  if (!value) {
    return 'Débutant'
  }

  return LEVEL_LABELS[value as GameLevel] ?? value
}

function skillLabel(value: SkillTag | null) {
  if (!value) {
    return 'Aucune compétence ciblée'
  }

  return SKILL_LABELS[value] ?? value
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function badgeRankClass(tier: BadgeItem['tier']) {
  if (['master', 'sprinter_flash', 'streak_long', 'volume_marathon'].includes(tier)) {
    return 'rank-three'
  }

  if (['confirmed', 'sprinter_sharp', 'streak_solid', 'volume_pillar'].includes(tier)) {
    return 'rank-two'
  }

  return 'rank-one'
}

function badgeFamilyIcon(badge: BadgeItem) {
  return badge.family === 'mastery' ? levelLabel(badge.level) : badge.familyLabel
}

function groupBadgesByLevel(badges: BadgeItem[]) {
  return LEVEL_ORDER.map((level) => ({
    level,
    label: LEVEL_LABELS[level],
    badges: badges.filter((badge) => badge.level === level),
  })).filter((group) => group.badges.length > 0)
}

function badgeLevelCaption(familyKey: string, levelLabel: string) {
  if (familyKey === 'mastery') {
    return `Jeune, Confirmé, Maître ${levelLabel}`
  }

  if (familyKey === 'speed') {
    return `Apprenti, précis, éclair en ${levelLabel}`
  }

  if (familyKey === 'streak') {
    return `Stable, solide, longue en ${levelLabel}`
  }

  if (familyKey === 'volume') {
    return `Habitué, pilier, marathonien en ${levelLabel}`
  }

  return `Badges ${levelLabel}`
}

function groupBadgeFamilies(badges: BadgeItem[]) {
  const familyMap = new Map<string, { key: string; label: string; description: string; badges: BadgeItem[] }>()

  badges.forEach((badge) => {
    const current = familyMap.get(badge.family) ?? {
      key: badge.family,
      label: badge.familyLabel,
      description: badge.familyDescription,
      badges: [],
    }

    current.badges.push(badge)
    familyMap.set(badge.family, current)
  })

  return Array.from(familyMap.values())
    .map((family) => {
      const completedCount = family.badges.filter((badge) => badge.completed).length

      return {
        ...family,
        completedCount,
        progress: clampPercent((completedCount / Math.max(1, family.badges.length)) * 100),
      }
    })
    .sort((left, right) => BADGE_FAMILY_ORDER.indexOf(left.key) - BADGE_FAMILY_ORDER.indexOf(right.key))
}

function weightedAverage(items: ProgressItem[], field: 'averageAccuracy' | 'averageScore') {
  const attempts = items.reduce((sum, item) => sum + item.attempts, 0)

  if (!attempts) {
    return 0
  }

  return Math.round(items.reduce((sum, item) => sum + item[field] * item.attempts, 0) / attempts)
}

function latestDate(items: ProgressItem[]) {
  return items
    .map((item) => item.lastPlayedAt)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null
}

function playLink(options: { game?: GameType; level?: GameLevel; focus?: SkillTag | null }) {
  const params = new URLSearchParams()

  if (options.game) {
    params.set('game', options.game)
  }

  if (options.level) {
    params.set('level', options.level)
  }

  if (options.focus) {
    params.set('focus', options.focus)
  }

  const query = params.toString()
  return query ? `/jeu?${query}` : '/jeu'
}

function DashboardBadgeCard({ badge, onSelect }: { badge: BadgeItem; onSelect?: (badge: BadgeItem) => void }) {
  return (
    <article
      className={`card badge-card badge-objective-card badge-${badge.tier} badge-family-${badge.family} ${badgeRankClass(badge.tier)} ${
        badge.completed ? 'earned' : 'locked'
      }`}
    >
      <button
        type="button"
        className="badge-objective-action"
        aria-label={`Afficher le detail du badge ${badge.title}`}
        onClick={() => onSelect?.(badge)}
      >
        <div className="badge-objective-header">
        <span className={`badge-art ${badgeRankClass(badge.tier)}`} aria-hidden="true">
          <span className="badge-core">
            <span className="badge-family-icon">{badgeFamilyIcon(badge)}</span>
          </span>
          <span className="badge-tier-flourish" />
          {badge.completed ? null : <span className="badge-lock-icon" aria-hidden="true" />}
        </span>
        <div>
          <strong>{badge.title}</strong>
          <p>{badge.description}</p>
          <small className="badge-progress-copy">
            {badge.completedObjectives}/{badge.totalObjectives} objectifs validés
          </small>
          {badge.completed ? <span className="badge-status-chip earned">Débloqué</span> : null}
        </div>
        </div>
        <div className="goal-bar" aria-hidden="true">
          <span style={{ width: `${clampPercent(badge.progress)}%` }} />
        </div>
      </button>
      <div className="objective-check-list">
        {badge.objectives.map((objective) => (
          <div className={`objective-check-row ${objective.completed ? 'done' : ''}`} key={objective.key}>
            <span aria-hidden="true">{objective.completed ? 'OK' : '—'}</span>
            <div className="objective-check-copy">
              <strong>{objective.label}</strong>
              <em>{objective.detail}</em>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

function DashboardBadgeDetailSheet({ badge, onClose }: { badge: BadgeItem; onClose: () => void }) {
  return (
    <div className="dashboard-badge-sheet-backdrop" onClick={onClose}>
      <section
        className={`dashboard-badge-sheet badge-family-${badge.family}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Details du badge ${badge.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dashboard-badge-sheet-grip" aria-hidden="true" />
        <div className="dashboard-badge-sheet-header">
          <span className={`badge-art ${badgeRankClass(badge.tier)}`} aria-hidden="true">
            <span className="badge-core">
              <span className="badge-family-icon">{badgeFamilyIcon(badge)}</span>
            </span>
            <span className="badge-tier-flourish" />
            {badge.completed ? null : <span className="badge-lock-icon" aria-hidden="true" />}
          </span>
          <div>
            <span className="eyebrow">{badge.familyLabel}</span>
            <h2>{badge.title}</h2>
            <p>{badge.description}</p>
          </div>
          <button type="button" className="dashboard-badge-sheet-close" aria-label="Fermer le detail du badge" onClick={onClose}>
            x
          </button>
        </div>

        <div className="dashboard-badge-sheet-progress">
          <div>
            <strong>{badge.completedObjectives}/{badge.totalObjectives}</strong>
            <span>objectifs valides</span>
          </div>
          <div>
            <strong>{clampPercent(badge.progress)}%</strong>
            <span>{badge.completed ? 'Debloque' : 'Progression'}</span>
          </div>
        </div>
        <div className="goal-bar" aria-hidden="true">
          <span style={{ width: `${clampPercent(badge.progress)}%` }} />
        </div>

        <div className="dashboard-badge-sheet-objectives">
          {badge.objectives.map((objective) => (
            <div className={`dashboard-badge-sheet-objective ${objective.completed ? 'done' : ''}`} key={objective.key}>
              <span aria-hidden="true">{objective.completed ? 'OK' : '...'}</span>
              <div>
                <strong>{objective.label}</strong>
                <em>{objective.detail}</em>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function DashboardUnlockedBadgeCard({ badge }: { badge: BadgeItem }) {
  return (
    <article className={`card friend-badge-card dashboard-profile-badge-card badge-family-${badge.family}`} key={badge.key}>
      <span className={`badge-art ${badgeRankClass(badge.tier)}`} aria-hidden="true">
        <span className="badge-core">
          <span className="badge-family-icon">{badgeFamilyIcon(badge)}</span>
        </span>
        <span className="badge-tier-flourish" />
      </span>
      <div>
        <strong>{badge.title}</strong>
      </div>
    </article>
  )
}

function DashboardUnlockedBadgePlaceholder() {
  return (
    <article className="card friend-badge-card friend-badge-placeholder dashboard-profile-badge-card">
      <span className="badge-art locked rank-one" aria-hidden="true">
        <span className="badge-core">
          <span className="badge-family-icon">?</span>
        </span>
        <span className="badge-tier-flourish" />
        <span className="badge-lock-icon" aria-hidden="true" />
      </span>
      <div>
        <strong>Pas de badge</strong>
      </div>
    </article>
  )
}

function DashboardBadgeMobileSummary({ families }: { families: ReturnType<typeof groupBadgeFamilies> }) {
  if (!families.length) {
    return null
  }

  return (
    <div className="dashboard-badge-mobile-summary" aria-label="Synthese des badges">
      {families.map((family) => {
        const nextBadges = family.badges.filter((badge) => !badge.completed).slice(0, 2)
        const highlightedBadges = nextBadges.length ? nextBadges : family.badges.filter((badge) => badge.completed).slice(0, 2)

        return (
          <article className={`dashboard-badge-summary-card badge-family-${family.key}`} key={family.key}>
            <div className="dashboard-badge-summary-main">
              <span className="dashboard-badge-family-mark" aria-hidden="true">
                <span className="badge-family-icon">{family.label}</span>
              </span>
              <div>
                <strong>{family.label}</strong>
                <span>{family.completedCount}/{family.badges.length} debloques</span>
              </div>
            </div>
            <div className="goal-bar" aria-hidden="true">
              <span style={{ width: `${clampPercent(family.progress)}%` }} />
            </div>
            <div className="dashboard-badge-summary-chips" aria-label={nextBadges.length ? 'Prochains badges' : 'Badges debloques'}>
              {highlightedBadges.map((badge) => (
                <span key={badge.key}>{badge.title}</span>
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function DashboardLoadingState({ profile, profileName }: { profile: DashboardProfileSource | null; profileName: string }) {
  return (
    <PageFrame className="dashboard-page" aria-busy="true">
      <div className="dashboard-hero dashboard-hero-v2">
        <DashboardProfileAvatar profile={profile} />
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1 className="dashboard-profile-title">{profileName}</h1>
          <p className="lead small-lead">Chargement de vos résultats...</p>
        </div>
      </div>

      <div className="stats-grid dashboard-stats-grid">
        {['Sessions', 'Record', 'Précision', 'Meilleure série'].map((label) => (
          <article className="card stat-card skeleton-card" key={label}>
            <span>{label}</span>
            <strong className="skeleton-line skeleton-number" />
          </article>
        ))}
      </div>
    </PageFrame>
  )
}

export function DashboardPage() {
  const { user, getToken, isAuthenticated } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const cacheKey = user?.clerkUserId ? dashboardCacheKey(user.clerkUserId) : null
  const cachedDashboard = useMemo(() => (cacheKey ? readCachedDashboard(cacheKey) : null), [cacheKey])
  const [liveDashboard, setLiveDashboard] = useState<{ cacheKey: string; payload: DashboardData } | null>(null)
  const [error, setError] = useState('')
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [selectedBadge, setSelectedBadge] = useState<BadgeItem | null>(null)
  const viewParam = searchParams.get('view') as DashboardMobileTab | null
  const activeView = viewParam && DASHBOARD_VIEWS.includes(viewParam) ? viewParam : 'overview'
  const data = liveDashboard?.cacheKey === cacheKey ? liveDashboard.payload : cachedDashboard

  function selectDashboardView(view: DashboardMobileTab) {
    const nextParams = new URLSearchParams(searchParams)

    if (view === 'overview') {
      nextParams.delete('view')
    } else {
      nextParams.set('view', view)
    }

    setSearchParams(nextParams)
    window.scrollTo({ top: 0 })
  }

  function handleBadgeFamilyToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const panel = event.currentTarget

    if (!panel.open || window.innerWidth > 767) {
      return
    }

    window.requestAnimationFrame(() => {
      const topbarOffset = 92
      const targetTop = panel.getBoundingClientRect().top + window.scrollY - topbarOffset

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  }

  useEffect(() => {
    if (!selectedBadge) {
      return
    }

    const previousBodyOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedBadge(null)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedBadge])

  useEffect(() => {
    if (!isAuthenticated || !cacheKey) {
      return
    }

    let active = true

    api
      .getDashboard(getToken)
      .then((payload) => {
        if (active) {
          setLiveDashboard({ cacheKey, payload })
          setError('')
          writeCachedDashboard(cacheKey, payload)
        }
      })
      .catch((err) => {
        if (active) {
          const message = err instanceof Error ? err.message : 'Impossible de charger votre espace.'
          setError(cachedDashboard ? 'Données affichées depuis le dernier chargement. Mise à jour impossible pour le moment.' : message)
        }
      })

    return () => {
      active = false
    }
  }, [cacheKey, cachedDashboard, getToken, isAuthenticated])

  const levelGroups = useMemo(() => {
    if (!data) {
      return []
    }

    return LEVEL_ORDER.map((level) => {
      const items = data.progressByMode
        .filter((item) => item.level === level)
        .sort((left, right) => GAME_ORDER.indexOf(left.game as GameType) - GAME_ORDER.indexOf(right.game as GameType))
      const attempts = items.reduce((sum, item) => sum + item.attempts, 0)
      const averageAccuracy = weightedAverage(items, 'averageAccuracy')
      const averageScore = weightedAverage(items, 'averageScore')
      const bestScore = items.reduce((best, item) => Math.max(best, item.bestScore), 0)
      const bestStreak = items.reduce((best, item) => Math.max(best, item.bestStreak), 0)
      const status = attempts === 0 ? 'À essayer' : averageAccuracy >= 85 && attempts >= 3 ? 'Solide' : 'En cours'

      return {
        level,
        items,
        attempts,
        averageAccuracy,
        averageScore,
        bestScore,
        bestStreak,
        lastPlayedAt: latestDate(items),
        status,
      }
    })
  }, [data])

  const profileSource = data?.player ?? user
  const profileName = formatDisplayName(profileSource)

  if (error && !data) {
    return (
      <PageFrame>
        <div className="card form-error">{error}</div>
      </PageFrame>
    )
  }

  if (!data) {
    return <DashboardLoadingState profile={profileSource} profileName={profileName} />
  }

  const totalXp = data.summary.totalXp
  const playerLevel = data.summary.playerProgress ?? getPlayerProgress(totalXp)
  const dashboardMissions = data.missions ?? []
  const dashboardBadges = data.badges ?? []
  const completedDashboardBadges = dashboardBadges.filter((badge) => badge.completed)
  const completedBadgesCount = completedDashboardBadges.length
  const badgeFamilies = groupBadgeFamilies(dashboardBadges)
  const dashboardStats = data.stats ?? {
    averageResponseTimeMs: 0,
    byGame: GAME_ORDER.map((game) => {
      const items = data.progressByMode.filter((item) => item.game === game)

      return {
        game,
        attempts: items.reduce((sum, item) => sum + item.attempts, 0),
        averageAccuracy: weightedAverage(items, 'averageAccuracy'),
        bestScore: items.reduce((best, item) => Math.max(best, item.bestScore), 0),
        bestStreak: items.reduce((best, item) => Math.max(best, item.bestStreak), 0),
        averageResponseTimeMs: 0,
        lastPlayedAt: latestDate(items),
      }
    }),
    byLevel: levelGroups.map((group) => ({
      level: group.level,
      attempts: group.attempts,
      averageAccuracy: group.averageAccuracy,
      bestScore: group.bestScore,
      bestStreak: group.bestStreak,
      averageResponseTimeMs: 0,
      lastPlayedAt: group.lastPlayedAt,
    })),
    bestCombination: null,
    recentTrend: {
      sessions: 0,
      averageAccuracy: data.summary.averageAccuracy,
      averageXp: 0,
      bestStreak: data.summary.bestStreak,
      accuracyDelta: 0,
      xpDelta: 0,
    },
    records: {
      bestScore: data.summary.bestScore,
      bestStreak: data.summary.bestStreak,
      bestXp: 0,
      fastestAverageResponseTimeMs: null,
    },
  }
  const levelStatsByLevel = new Map(dashboardStats.byLevel.map((item) => [item.level, item]))
  const bestCombination = dashboardStats.bestCombination
  const estimatedGamesToNext =
    playerLevel.xpRemaining && dashboardStats.recentTrend.averageXp
      ? Math.ceil(playerLevel.xpRemaining / dashboardStats.recentTrend.averageXp)
      : null
  const statsFocusItems = dashboardStats.byGame
    .filter((item) => item.attempts === 0 || item.averageAccuracy < 75)
    .sort((a, b) => {
      if (a.attempts === 0 && b.attempts !== 0) {
        return -1
      }

      if (a.attempts !== 0 && b.attempts === 0) {
        return 1
      }

      return a.averageAccuracy - b.averageAccuracy || b.attempts - a.attempts
    })
    .slice(0, 3)

  const stats = [
    { label: 'Sessions', value: data.summary.totalSessions, tone: 'coral', mark: 'S' },
    { label: 'XP totale', value: totalXp, tone: 'mint', mark: 'XP' },
    { label: 'Record', value: `${data.summary.bestScore}%`, tone: 'blue', mark: 'R' },
    { label: 'Meilleure série', value: data.summary.bestStreak, tone: 'rose', mark: 'x' },
  ]

  const mobileTabs: Array<{ key: DashboardMobileTab; label: string }> = [
    { key: 'overview', label: 'Vue' },
    { key: 'stats', label: 'Stats' },
    { key: 'missions', label: 'Missions' },
    { key: 'history', label: 'Historique' },
  ]

  return (
    <PageFrame className={`dashboard-page dashboard-active-${activeView}`}>
      <div id="overview" className="dashboard-hero dashboard-hero-v2">
        <DashboardProfileAvatar profile={data.player} />
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1 className="dashboard-profile-title">{profileName}</h1>
          <p className="lead small-lead dashboard-profile-meta">
            {profileHandle(data.player)} · Niveau {playerLevel.level}
          </p>
        </div>
      </div>

      {error ? <div className="card form-error dashboard-refresh-error">{error}</div> : null}

      <section className="dashboard-profile-badges-section" aria-label="Badges recents">
        {completedDashboardBadges.length ? (
          <div className="dashboard-profile-badge-window" aria-label="Badges debloques">
            {completedDashboardBadges.map((badge) => (
              <DashboardUnlockedBadgeCard badge={badge} key={badge.key} />
            ))}
          </div>
        ) : (
          <DashboardUnlockedBadgePlaceholder />
        )}
      </section>

      <ResponsiveTabs
        ariaLabel="Sections de mon espace"
        className="dashboard-section-nav"
        options={mobileTabs.map((tab) => ({ label: tab.label === 'Vue' ? "Vue d'ensemble" : tab.label, value: tab.key }))}
        value={activeView}
        onChange={selectDashboardView}
      />

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-overview-section ${activeView === 'overview' ? 'active' : ''}`}>
        <div className="section-kicker compact-kicker">
          <span className="eyebrow">Synthèse</span>
          <h2>Vos repères clés.</h2>
        </div>

        <div className="stats-grid dashboard-stats-grid">
          {stats.map((stat) => (
            <article className={`card stat-card tone-${stat.tone}`} key={stat.label}>
              <div>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
              <span className="stat-mark" aria-hidden="true">{stat.mark}</span>
            </article>
          ))}
        </div>

        <article className="card player-level-card">
          <div>
            <span className="eyebrow">Progression joueur</span>
            <h3>Niveau {playerLevel.level}</h3>
            <p>{totalXp} XP cumulée</p>
          </div>
          <div className="goal-bar" aria-hidden="true">
            <span style={{ width: `${playerLevel.progress}%` }} />
          </div>
          <p className="muted">
            {playerLevel.nextLevel ? `${playerLevel.xpRemaining} XP restantes avant le niveau ${playerLevel.nextLevel}.` : 'Palier maximal atteint.'}
          </p>
        </article>
      </section>

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-level-section ${activeView === 'stats' ? 'active' : ''}`}>
        <div className="section-kicker">
          <span className="eyebrow">Statistiques</span>
          <h2>Vos statistiques détaillées.</h2>
        </div>

        <div className="stats-insight-grid">
          <article className="card stats-insight-card">
            <span>Temps moyen</span>
            <strong className="insight-main">{formatResponseTime(dashboardStats.averageResponseTimeMs)}</strong>
            <p>Temps moyen de réponse calculé sur toutes les réponses enregistrées.</p>
          </article>

          <article className="card stats-insight-card">
            <span>Meilleure combinaison</span>
            {bestCombination ? (
              <>
                <strong className="insight-main">
                  {gameLabel(bestCombination.game)} - {levelLabel(bestCombination.level)}
                </strong>
                <div className="insight-detail-list">
                  <div className="insight-detail-row">
                    <span>Précision</span>
                    <strong>{bestCombination.averageAccuracy}%</strong>
                  </div>
                  <div className="insight-detail-row">
                    <span>Sprints</span>
                    <strong>{bestCombination.attempts}</strong>
                  </div>
                </div>
              </>
            ) : (
              <>
                <strong className="insight-main">À construire</strong>
                <p>Quelques sprints suffiront pour identifier votre combinaison la plus solide.</p>
              </>
            )}
          </article>

          <article className="card stats-insight-card">
            <span>Tendance récente</span>
            <strong className="insight-main">{dashboardStats.recentTrend.averageAccuracy}%</strong>
            <p>
              {dashboardStats.recentTrend.sessions
                ? `Moyenne sur les ${dashboardStats.recentTrend.sessions} dernières parties.`
                : 'Aucune partie récente à comparer.'}
            </p>
            <div className="trend-chip-row">
              <span className={`trend-chip ${dashboardStats.recentTrend.accuracyDelta > 0 ? 'positive' : dashboardStats.recentTrend.accuracyDelta < 0 ? 'negative' : ''}`}>
                Précision {formatSignedPercent(dashboardStats.recentTrend.accuracyDelta)}
              </span>
              <span className={`trend-chip ${dashboardStats.recentTrend.xpDelta > 0 ? 'positive' : dashboardStats.recentTrend.xpDelta < 0 ? 'negative' : ''}`}>
                XP {formatSignedNumber(dashboardStats.recentTrend.xpDelta)}
              </span>
            </div>
          </article>

          <article className="card stats-insight-card">
            <span>Objectif niveau</span>
            <strong className="insight-main">{playerLevel.progress}%</strong>
            <p>
              {playerLevel.nextLevel
                ? `${playerLevel.xpRemaining} XP avant le niveau ${playerLevel.nextLevel}.`
                : 'Palier maximal atteint.'}
            </p>
            <div className="goal-bar" aria-hidden="true">
              <span style={{ width: `${playerLevel.progress}%` }} />
            </div>
            {estimatedGamesToNext ? <p className="muted">Environ {estimatedGamesToNext} sprint{estimatedGamesToNext > 1 ? 's' : ''} au rythme actuel.</p> : null}
          </article>

          <article className="card stats-insight-card">
            <span>Records personnels</span>
            <div className="record-grid">
              <div>
                <span>Score</span>
                <strong>{dashboardStats.records.bestScore}%</strong>
              </div>
              <div>
                <span>Série</span>
                <strong>{dashboardStats.records.bestStreak}</strong>
              </div>
              <div>
                <span>XP</span>
                <strong>{dashboardStats.records.bestXp}</strong>
              </div>
              <div>
                <span>Temps</span>
                <strong>{formatResponseTime(dashboardStats.records.fastestAverageResponseTimeMs)}</strong>
              </div>
            </div>
          </article>
        </div>

        <div className="section-kicker compact-kicker stats-subsection-title">
          <span className="eyebrow">Modes</span>
          <h3>Progression par type de sprint.</h3>
        </div>

        <div className="operation-stats-grid">
          {dashboardStats.byGame.map((item) => (
            <article className={`card operation-stat-card ${item.attempts ? 'played' : 'unplayed'}`} key={item.game}>
              <div className="operation-stat-topline">
                <span>{gameLabel(item.game)}</span>
                <strong>{item.attempts ? `${item.averageAccuracy}%` : '—'}</strong>
              </div>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${item.attempts ? clampPercent(item.averageAccuracy) : 0}%` }} />
              </div>
              <div className="stat-detail-grid">
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

        <article className="card stats-focus-panel">
          <div>
            <span className="eyebrow">À renforcer</span>
            <h3>Priorités utiles.</h3>
          </div>
          {statsFocusItems.length ? (
            <div className="stats-focus-list">
              {statsFocusItems.map((item) => (
                <div className="stats-focus-row" key={item.game}>
                  <strong>{gameLabel(item.game)}</strong>
                  <span>
                    {item.attempts
                      ? `${item.averageAccuracy}% de précision sur ${item.attempts} sprint${item.attempts > 1 ? 's' : ''}.`
                      : 'Aucune partie jouée sur ce mode.'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucune priorité nette pour le moment. Continuez à varier les modes pour confirmer ces résultats.</p>
          )}
        </article>

        <div className="section-kicker compact-kicker stats-subsection-title">
          <span className="eyebrow">Niveaux</span>
          <h3>Répartition par difficulté.</h3>
        </div>

        <div className="level-ladder">
          {levelGroups.map((group) => {
            const levelStats = levelStatsByLevel.get(group.level)

            return (
              <article className={`card level-card ${group.attempts ? 'played' : ''}`} key={group.level}>
                <div className="level-card-header">
                  <div>
                    <span>Niveau</span>
                    <h3>{levelLabel(group.level)}</h3>
                  </div>
                  <strong>{group.status}</strong>
                </div>

                <div className="level-metrics">
                  <div>
                    <span>Sprints</span>
                    <strong>{group.attempts}</strong>
                  </div>
                  <div>
                    <span>Précision</span>
                    <strong>{group.averageAccuracy}%</strong>
                  </div>
                  <div>
                    <span>Record</span>
                    <strong>{group.bestScore}%</strong>
                  </div>
                  <div>
                    <span>Temps</span>
                    <strong>{formatResponseTime(levelStats?.averageResponseTimeMs)}</strong>
                  </div>
                </div>

                <div className="goal-bar" aria-hidden="true">
                  <span style={{ width: `${clampPercent(group.averageAccuracy)}%` }} />
                </div>

                {group.items.length ? (
                  <div className="mode-chip-list">
                    {group.items.map((item) => (
                      <span className="mode-chip" key={`${item.game}-${item.level}`}>
                        <strong>{gameLabel(item.game)}</strong>
                        <em>{item.bestScore}% · {item.attempts}x</em>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Pas encore de session sur ce niveau.</p>
                )}

                <Link className="secondary-button full-width" to={playLink({ game: 'mixte', level: group.level })}>
                  {group.attempts ? 'Rejouer ce niveau' : 'Essayer ce niveau'}
                </Link>
              </article>
            )
          })}
        </div>
      </section>

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-plan-section ${activeView === 'missions' ? 'active' : ''}`}>
        <div className="section-kicker">
          <span className="eyebrow">Missions XP</span>
          <h2>Atteignez les objectifs et gagnez des XP.</h2>
        </div>

        <div className="mission-board-grid">
          {dashboardMissions.map((mission) => (
            <article className={`card mission-card mission-xp-card ${mission.claimed ? 'completed' : ''}`} key={`${mission.key}-${mission.scopeKey}`}>
              <div className="mission-topline">
                <span className="mission-mark" aria-hidden="true">XP</span>
                <span>{mission.scope === 'daily' ? 'Quotidienne' : 'Progression'}</span>
                <strong>+{mission.rewardXp}</strong>
              </div>
              <h3>{mission.title}</h3>
              <p>{mission.description}</p>
              <div className="mission-progress-row">
                <span>{mission.current}/{mission.target}</span>
                <strong>{mission.claimed ? 'XP reçue' : mission.completed ? 'Validée' : `${mission.progress}%`}</strong>
              </div>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${clampPercent(mission.progress)}%` }} />
              </div>
            </article>
          ))}
        </div>

        <div className="section-kicker compact-kicker badge-subsection-title">
          <span className="eyebrow">Badges</span>
          <h3>{completedBadgesCount}/{dashboardBadges.length} badges débloqués.</h3>
        </div>

        <DashboardBadgeMobileSummary families={badgeFamilies} />

        <div className="badge-family-stack dashboard-badge-detail-stack">
          {badgeFamilies.map((family) => (
            <details className={`badge-family-panel badge-family-${family.key}`} key={family.key} onToggle={handleBadgeFamilyToggle}>
              <summary>
                <div>
                  <strong>{family.label}</strong>
                  <span>{family.description}</span>
                </div>
                <em>{family.completedCount}/{family.badges.length}</em>
              </summary>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${clampPercent(family.progress)}%` }} />
              </div>
              <div className="badge-level-stack">
                {groupBadgesByLevel(family.badges).map((levelGroup) => (
                  <section className="badge-level-group" key={levelGroup.level}>
                    <div className="badge-level-heading">
                      <strong>{levelGroup.label}</strong>
                      <span>{badgeLevelCaption(family.key, levelGroup.label)}</span>
                    </div>
                    <div className="badge-objective-grid badge-level-grid">
                      {levelGroup.badges.map((badge) => (
                        <DashboardBadgeCard badge={badge} key={badge.key} onSelect={setSelectedBadge} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <article className={`dashboard-view-panel card dashboard-history dashboard-mobile-panel dashboard-history-section ${activeView === 'history' ? 'active' : ''}`}>
        <div className="section-header compact-header">
          <div>
            <span className="eyebrow">Historique</span>
            <h2>Parties récentes</h2>
          </div>
          <Link className="secondary-button" to="/jeu">
            Nouveau sprint
          </Link>
        </div>
        {data.recentSessions.length ? (
          <div className="session-list detailed-session-list">
            {data.recentSessions.map((session) => (
              <div className="session-row enriched-session-row detailed-session-row" key={session.id}>
                <div>
                  <strong>{gameLabel(session.game)}</strong>
                  <div className="session-tags">
                    <span>{levelLabel(session.level)}</span>
                    <span>{session.correctAnswers}/{session.totalQuestions} bonnes réponses</span>
                    <span>série {session.bestStreak}</span>
                    <span>{session.durationSeconds}s</span>
                    {session.practiceSkill ? <span>{skillLabel(session.practiceSkill)}</span> : null}
                  </div>
                </div>
                <div className="history-score-grid">
                  <span><strong>{session.score}%</strong> précision</span>
                  <span><strong>{session.xp}</strong> XP</span>
                  <span>{formatDate(session.playedAt)}</span>
                  <button
                    className="secondary-button history-answers-button"
                    type="button"
                    aria-expanded={expandedSessionId === session.id}
                    onClick={() => setExpandedSessionId((current) => (current === session.id ? null : session.id))}
                  >
                    {expandedSessionId === session.id ? 'Masquer les réponses' : 'Voir les réponses'}
                  </button>
                  {expandedSessionId === session.id ? (
                    <div className="answer-history-panel">
                      {session.answers.length ? (
                        <div className="answer-history-list">
                          {session.answers.map((answer, index) => (
                            <div className={`answer-history-row ${answer.isCorrect ? 'correct' : 'wrong'}`} key={answer.id}>
                              <span className="answer-index">{index + 1}</span>
                              <strong>{answer.prompt}</strong>
                              <span>
                                Votre réponse <b>{answer.userAnswer}</b>
                              </span>
                              <span>
                                Attendu <b>{answer.correctAnswer}</b>
                              </span>
                              <span>{Math.round(answer.responseTimeMs / 100) / 10}s</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">Aucune réponse enregistrée pour cette partie.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Vos sprints apparaîtront ici après vos premières parties.</p>
        )}
      </article>
      {selectedBadge ? <DashboardBadgeDetailSheet badge={selectedBadge} onClose={() => setSelectedBadge(null)} /> : null}
    </PageFrame>
  )
}
