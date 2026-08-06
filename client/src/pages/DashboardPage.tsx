import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageFrame } from '../components/layout/PageFrame'
import { ResponsiveTabs } from '../components/layout/ResponsiveTabs'
import { useAuth } from '../context/auth'
import { useProfile } from '../context/profile-context'
import { DashboardPlayerHeader } from '../features/dashboard/DashboardPlayerHeader'
import { PerformanceCockpit } from '../features/dashboard/PerformanceCockpit'
import { QuestPath } from '../features/dashboard/QuestPath'
import { SessionTimeline } from '../features/dashboard/SessionTimeline'
import { TrophyShelf } from '../features/dashboard/TrophyShelf'
import { useDailyScopeKey } from '../hooks/useDailyScopeKey'
import { DASHBOARD_CACHE_PREFIX, readCache, userCacheKey, writeCache } from '../lib/appCache'
import { api, type DashboardData } from '../lib/api'
import { GAME_LABELS, LEVEL_LABELS, SKILL_LABELS, getPlayerProgress, type GameLevel, type GameType, type SkillTag } from '../lib/game'
import { isDailyMissionV2 } from '../lib/missionNavigation'
import { formatDisplayName } from '../lib/profile'
import '../styles/routes/dashboard.css'

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
const DASHBOARD_VIEWS: DashboardMobileTab[] = ['overview', 'stats', 'missions', 'history']

function dashboardCacheKey(clerkUserId: string) {
  return userCacheKey(DASHBOARD_CACHE_PREFIX, clerkUserId)
}

type CachedDashboard = {
  dailyScopeKey: string
  payload: DashboardData
}

function readCachedDashboard(key: string, dailyScopeKey: string) {
  const cached = readCache<CachedDashboard>(key)
  return cached?.dailyScopeKey === dailyScopeKey && cached.payload
    ? sanitizeDashboardMissions(cached.payload)
    : null
}

function writeCachedDashboard(key: string, dailyScopeKey: string, payload: DashboardData) {
  writeCache(key, { dailyScopeKey, payload })
}

function sanitizeDashboardMissions(payload: DashboardData): DashboardData {
  const missions = Array.isArray(payload.missions) ? payload.missions.filter(isDailyMissionV2) : []
  return missions.length === payload.missions?.length ? payload : { ...payload, missions }
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
  const { profile } = useProfile()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentDailyScope = useDailyScopeKey(profile?.timeZone ?? user?.timeZone)
  const cacheKey = user?.clerkUserId ? dashboardCacheKey(user.clerkUserId) : null
  const cachedDashboard = useMemo(
    () => (cacheKey ? readCachedDashboard(cacheKey, currentDailyScope) : null),
    [cacheKey, currentDailyScope],
  )
  const [liveDashboard, setLiveDashboard] = useState<{
    cacheKey: string
    dailyScopeKey: string
    payload: DashboardData
  } | null>(null)
  const [error, setError] = useState('')
  const [refreshRequestId, setRefreshRequestId] = useState(0)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [selectedBadge, setSelectedBadge] = useState<BadgeItem | null>(null)
  const viewParam = searchParams.get('view') as DashboardMobileTab | null
  const activeView = viewParam && DASHBOARD_VIEWS.includes(viewParam) ? viewParam : 'overview'
  const data = liveDashboard?.cacheKey === cacheKey && liveDashboard.dailyScopeKey === currentDailyScope
    ? liveDashboard.payload
    : cachedDashboard
  const loadOperationHistory = useCallback(
    async (game: GameType, level: GameLevel) => (await api.getOperationHistory(getToken, game, level)).sessions,
    [getToken],
  )

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
          const sanitizedPayload = sanitizeDashboardMissions(payload)
          setLiveDashboard({ cacheKey, dailyScopeKey: currentDailyScope, payload: sanitizedPayload })
          setError('')
          writeCachedDashboard(cacheKey, currentDailyScope, sanitizedPayload)
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
  }, [cacheKey, cachedDashboard, currentDailyScope, getToken, isAuthenticated, refreshRequestId])

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
  const stats = [
    { label: 'Sessions', value: data.summary.totalSessions, tone: 'coral', mark: 'S' },
    { label: 'XP totale', value: totalXp, tone: 'mint', mark: 'XP' },
    { label: 'Record', value: `${data.summary.bestScore}%`, tone: 'blue', mark: 'R' },
    { label: 'Meilleure série', value: data.summary.bestStreak, tone: 'rose', mark: 'x' },
  ]

  const mobileTabs: Array<{ key: DashboardMobileTab; label: string }> = [
    { key: 'overview', label: 'Aperçu' },
    { key: 'stats', label: 'Stats' },
    { key: 'missions', label: 'Missions' },
    { key: 'history', label: 'Historique' },
  ]

  return (
    <PageFrame className={`dashboard-page dashboard-active-${activeView}`}>
      <ResponsiveTabs
        ariaLabel="Sections de mon espace"
        className="dashboard-section-nav"
        options={mobileTabs.map((tab) => ({ label: tab.label, value: tab.key }))}
        value={activeView}
        onChange={selectDashboardView}
      />

      {activeView === 'overview' ? (
        <DashboardPlayerHeader
          avatar={<DashboardProfileAvatar profile={data.player} />}
          name={profileName}
          handle={profileHandle(data.player)}
          progress={playerLevel}
          bestStreak={data.summary.bestStreak}
          todaySessions={data.summary.todaySessions}
          dailyGoal={data.summary.dailyGoal}
          lastPlayedAt={data.summary.lastPlayedAt}
          formatDate={formatDate}
        />
      ) : null}

      {error ? (
        <div className="card form-error dashboard-refresh-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError('')
              setRefreshRequestId((current) => current + 1)
            }}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {activeView === 'overview' ? (
        <section className="dashboard-profile-badges-section" aria-label="Badges récents">
          {completedDashboardBadges.length ? (
            <div className="dashboard-profile-badge-window" aria-label="Badges débloqués">
              {completedDashboardBadges.slice(0, 6).map((badge) => (
                <DashboardUnlockedBadgeCard badge={badge} key={badge.key} />
              ))}
            </div>
          ) : (
            <DashboardUnlockedBadgePlaceholder />
          )}
        </section>
      ) : null}

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-overview-section ${activeView === 'overview' ? 'active' : ''}`}>
        <div className="section-kicker compact-kicker">
          <span className="eyebrow">Bilan</span>
          <h2>Vos résultats</h2>
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

      </section>

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-level-section ${activeView === 'stats' ? 'active' : ''}`}>
        <div className="section-kicker">
        </div>

        <PerformanceCockpit
          stats={dashboardStats}
          progressByMode={data.progressByMode}
          recentSessions={data.recentSessions}
          loadOperationHistory={loadOperationHistory}
          gameLabel={gameLabel}
          levelLabel={levelLabel}
          formatResponseTime={formatResponseTime}
          playHref={(level, game) => playLink({ level, game })}
        />
      </section>

      <section className={`dashboard-view-panel dashboard-section dashboard-mobile-panel dashboard-plan-section ${activeView === 'missions' ? 'active' : ''}`}>

        <QuestPath missions={dashboardMissions} />

        <div className="section-kicker compact-kicker badge-subsection-title">
          <span className="eyebrow">Badges</span>
          <h3>{completedBadgesCount}/{dashboardBadges.length} badges débloqués.</h3>
        </div>

        <TrophyShelf badges={dashboardBadges} onSelect={setSelectedBadge} />
      </section>

      <article className={`dashboard-view-panel dashboard-mobile-panel dashboard-history-section ${activeView === 'history' ? 'active' : ''}`}>
        <SessionTimeline
          sessions={data.recentSessions}
          expandedSessionId={expandedSessionId}
          onToggleSession={(sessionId) => setExpandedSessionId((current) => (current === sessionId ? null : sessionId))}
          gameLabel={gameLabel}
          levelLabel={levelLabel}
          skillLabel={skillLabel}
          formatDate={formatDate}
        />
      </article>
      {selectedBadge ? <DashboardBadgeDetailSheet badge={selectedBadge} onClose={() => setSelectedBadge(null)} /> : null}
    </PageFrame>
  )
}
