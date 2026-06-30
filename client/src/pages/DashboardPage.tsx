import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { api, type DashboardData } from '../lib/api'
import { GAME_LABELS, LEVEL_LABELS, SKILL_LABELS, type GameLevel, type GameType, type SkillTag } from '../lib/game'

type ProgressItem = DashboardData['progressByMode'][number]
type DashboardMobileTab = 'today' | 'levels' | 'progress' | 'history'

const LEVEL_ORDER: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']
const GAME_ORDER: GameType[] = ['addition', 'soustraction', 'multiplication', 'division', 'mixte']
const DASHBOARD_CACHE_PREFIX = 'mayele.dashboard.'

function dashboardCacheKey(clerkUserId: string) {
  return `${DASHBOARD_CACHE_PREFIX}${clerkUserId}`
}

function readCachedDashboard(key: string) {
  try {
    const cached = window.sessionStorage.getItem(key)
    return cached ? (JSON.parse(cached) as DashboardData) : null
  } catch {
    return null
  }
}

function writeCachedDashboard(key: string, payload: DashboardData) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Non-critical: the live API response remains the source of truth.
  }
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

function toGameLevel(value: string | null | undefined): GameLevel {
  return LEVEL_ORDER.includes(value as GameLevel) ? (value as GameLevel) : 'debutant'
}

function nextLevel(level: GameLevel) {
  const currentIndex = LEVEL_ORDER.indexOf(level)
  return LEVEL_ORDER[currentIndex + 1] ?? null
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

function DashboardLoadingState({ profileName }: { profileName: string }) {
  return (
    <section className="page dashboard-page" aria-busy="true">
      <div className="dashboard-hero dashboard-hero-v2">
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1>Bonjour {profileName}</h1>
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

      <section className="dashboard-section">
        <div className="section-kicker">
          <span className="eyebrow">Objectif du jour</span>
          <h2>Préparation de votre espace.</h2>
        </div>
        <div className="mission-grid">
          {[0, 1, 2, 3].map((item) => (
            <article className="card mission-card skeleton-card" key={item}>
              <div className="skeleton-line" />
              <div className="skeleton-line wide" />
              <div className="skeleton-line short" />
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

export function DashboardPage() {
  const { user, getToken, isAuthenticated } = useAuth()
  const cacheKey = user?.clerkUserId ? dashboardCacheKey(user.clerkUserId) : null
  const cachedDashboard = useMemo(() => (cacheKey ? readCachedDashboard(cacheKey) : null), [cacheKey])
  const [liveDashboard, setLiveDashboard] = useState<{ cacheKey: string; payload: DashboardData } | null>(null)
  const [error, setError] = useState('')
  const [activeMobileTab, setActiveMobileTab] = useState<DashboardMobileTab>('today')
  const data = liveDashboard?.cacheKey === cacheKey ? liveDashboard.payload : cachedDashboard

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

  const profileName = user?.name || data?.player.name || 'Joueur Mayele'

  if (error && !data) {
    return (
      <section className="page">
        <div className="card form-error">{error}</div>
      </section>
    )
  }

  if (!data) {
    return <DashboardLoadingState profileName={profileName} />
  }

  const primaryWeakSkill = data.weakSkills[0] ?? null
  const practiceLevel = toGameLevel(data.practicePlan.recommendedLevel)
  const practiceLink = data.practicePlan.recommendedSkill
    ? playLink({ focus: data.practicePlan.recommendedSkill, level: practiceLevel })
    : playLink({ game: 'mixte', level: practiceLevel })
  const todayProgress = clampPercent((data.summary.todaySessions / data.summary.dailyGoal) * 100)
  const remainingSessions = Math.max(0, data.summary.dailyGoal - data.summary.todaySessions)
  const recentLevel = toGameLevel(data.recentSessions[0]?.level ?? data.practicePlan.recommendedLevel)
  const recentLevelGroup = levelGroups.find((group) => group.level === recentLevel) ?? levelGroups[0]
  const suggestedNextLevel =
    recentLevelGroup?.attempts >= 2 && recentLevelGroup.averageAccuracy >= 80 ? nextLevel(recentLevel) : null
  const levelTarget = suggestedNextLevel ?? recentLevel
  const levelTargetLabel = levelLabel(levelTarget)
  const levelObjectiveTitle =
    recentLevelGroup?.attempts === 0
      ? `Mesurer le niveau ${levelTargetLabel}`
      : suggestedNextLevel
        ? `Tester le niveau ${levelTargetLabel}`
        : `Consolider ${levelTargetLabel}`
  const levelObjectiveText =
    recentLevelGroup?.attempts === 0
      ? 'Lancez une première session pour obtenir une base de comparaison.'
      : suggestedNextLevel
        ? `Votre précision en ${levelLabel(recentLevel)} permet d’essayer plus difficile.`
        : `Visez 80% de précision avant de monter d’un cran.`
  const levelObjectiveProgress = recentLevelGroup?.attempts ? recentLevelGroup.averageAccuracy : 0
  const diagnosticProgress = primaryWeakSkill ? primaryWeakSkill.accuracy : Math.min(100, (data.summary.totalSessions / 3) * 100)
  const streakTarget = data.summary.bestStreak >= 5 ? data.summary.bestStreak + 1 : 5
  const streakProgress = clampPercent((data.summary.bestStreak / streakTarget) * 100)
  const dailyObjectives = [
    {
      label: 'Rythme',
      value: `${data.summary.todaySessions}/${data.summary.dailyGoal}`,
      title: remainingSessions ? `${remainingSessions} sprint${remainingSessions > 1 ? 's' : ''} aujourd’hui` : 'Objectif atteint',
      text: remainingSessions ? 'Terminez une session courte.' : 'Rejouez pour battre votre score.',
      progress: todayProgress,
      to: playLink({ game: 'mixte', level: practiceLevel }),
      action: remainingSessions ? 'Faire un sprint' : 'Rejouer',
    },
    {
      label: primaryWeakSkill ? 'Correction' : 'Diagnostic',
      value: primaryWeakSkill ? `${primaryWeakSkill.accuracy}%` : `${Math.min(3, data.summary.totalSessions)}/3`,
      title: primaryWeakSkill ? skillLabel(primaryWeakSkill.skill) : 'Créer le diagnostic',
      text: primaryWeakSkill
        ? `${primaryWeakSkill.correctAnswers}/${primaryWeakSkill.attempts} bonnes réponses.`
        : 'Faites trois sprints pour détecter vos erreurs récurrentes.',
      progress: diagnosticProgress,
      to: practiceLink,
      action: primaryWeakSkill ? 'Corriger' : 'Commencer',
    },
    {
      label: 'Niveau',
      value: `${levelObjectiveProgress}%`,
      title: levelObjectiveTitle,
      text: levelObjectiveText,
      progress: levelObjectiveProgress,
      to: playLink({ game: 'mixte', level: levelTarget }),
      action: `Jouer ${levelTargetLabel}`,
    },
    {
      label: 'Série',
      value: `${data.summary.bestStreak}/${streakTarget}`,
      title: data.summary.bestStreak ? `Viser série x${streakTarget}` : 'Lancer une première série',
      text: data.summary.bestStreak ? 'Gardez le rythme sans erreur.' : 'Enchaînez cinq bonnes réponses.',
      progress: streakProgress,
      to: playLink({ game: 'mixte', level: practiceLevel }),
      action: 'Tenter',
    },
  ]
  const mobileTabs: Array<{ key: DashboardMobileTab; label: string }> = [
    { key: 'today', label: "Aujourd'hui" },
    { key: 'levels', label: 'Niveaux' },
    { key: 'progress', label: 'Progres' },
    { key: 'history', label: 'Historique' },
  ]

  return (
    <section className="page dashboard-page">
      <div className="dashboard-hero dashboard-hero-v2">
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1>Bonjour {profileName}</h1>
          <p className="lead small-lead">Bienvenue sur votre espace.</p>
        </div>
      </div>

      {error ? <div className="card form-error dashboard-refresh-error">{error}</div> : null}

      <div className="stats-grid dashboard-stats-grid">
        <article className="card stat-card">
          <span>Sessions</span>
          <strong>{data.summary.totalSessions}</strong>
        </article>
        <article className="card stat-card">
          <span>Record</span>
          <strong>{data.summary.bestScore}%</strong>
        </article>
        <article className="card stat-card">
          <span>Précision</span>
          <strong>{data.summary.averageAccuracy}%</strong>
        </article>
        <article className="card stat-card">
          <span>Meilleure série</span>
          <strong>{data.summary.bestStreak}</strong>
        </article>
      </div>

      <nav className="dashboard-mobile-tabs" aria-label="Sections de mon espace">
        {mobileTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeMobileTab === tab.key ? 'active' : ''}
            aria-pressed={activeMobileTab === tab.key}
            onClick={() => setActiveMobileTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={`dashboard-section dashboard-mobile-panel ${activeMobileTab === 'today' ? 'active' : ''}`}>
        <div className="section-kicker">
          <span className="eyebrow">Objectif du jour</span>
          <h2>À faire maintenant.</h2>
        </div>

        <div className="mission-grid">
          {dailyObjectives.map((objective) => (
            <article className="card mission-card" key={objective.label}>
              <div className="mission-topline">
                <span>{objective.label}</span>
                <strong>{objective.value}</strong>
              </div>
              <h3>{objective.title}</h3>
              <p>{objective.text}</p>
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${clampPercent(objective.progress)}%` }} />
              </div>
              <Link className="secondary-button full-width" to={objective.to}>
                {objective.action}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className={`dashboard-section dashboard-mobile-panel ${activeMobileTab === 'levels' ? 'active' : ''}`}>
        <div className="section-kicker">
          <span className="eyebrow">Niveaux</span>
          <h2>Suivez séparément les niveaux joués.</h2>
        </div>

        <div className="level-ladder">
          {levelGroups.map((group) => (
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
          ))}
        </div>
      </section>

      <div
        className={`grid ${data.achievements.length ? 'two-columns' : ''} dashboard-focus-grid dashboard-mobile-panel ${
          activeMobileTab === 'progress' ? 'active' : ''
        }`}
      >
        <article className="card diagnostic-card">
          <h2>À corriger</h2>
          <p className="muted">{data.practicePlan.message}</p>
          {data.weakSkills.length ? (
            <div className="skill-list">
              {data.weakSkills.map((item) => (
                <div className="skill-row" key={item.skill}>
                  <div>
                    <strong>{skillLabel(item.skill)}</strong>
                    <span>{item.correctAnswers}/{item.attempts} bonnes réponses</span>
                  </div>
                  <span>{item.accuracy}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Faites quelques sprints mixtes pour obtenir un diagnostic fiable.</p>
          )}
          <Link className="primary-button full-width" to={practiceLink}>
            Lancer l’entraînement ciblé
          </Link>
        </article>

        {data.achievements.length ? (
          <article className="card diagnostic-card">
            <h2>Badges récents</h2>
            <div className="badge-list compact-badge-list">
              {data.achievements.slice(0, 4).map((achievement) => (
                <div className="badge-chip" key={achievement.key}>
                  <strong>{achievement.label}</strong>
                  <span>{achievement.description}</span>
                </div>
              ))}
            </div>
          </article>
        ) : null}
      </div>

      <article className={`card dashboard-history dashboard-mobile-panel ${activeMobileTab === 'history' ? 'active' : ''}`}>
        <div className="section-header compact-header">
          <h2>Historique récent</h2>
          <Link className="secondary-button" to="/jeu">
            Nouveau sprint
          </Link>
        </div>
        {data.recentSessions.length ? (
          <div className="session-list">
            {data.recentSessions.map((session) => (
              <div className="session-row enriched-session-row" key={session.id}>
                <div>
                  <strong>{gameLabel(session.game)}</strong>
                  <div className="session-tags">
                    <span>{levelLabel(session.level)}</span>
                    <span>{session.correctAnswers}/{session.totalQuestions} bonnes réponses</span>
                    <span>série {session.bestStreak}</span>
                    {session.practiceSkill ? <span>{skillLabel(session.practiceSkill)}</span> : null}
                  </div>
                </div>
                <div className="progress-meta right-align">
                  <span>{session.score}% · {session.points} pts</span>
                  <span>{formatDate(session.playedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Vos sprints apparaîtront ici après vos premières parties.</p>
        )}
      </article>
    </section>
  )
}
