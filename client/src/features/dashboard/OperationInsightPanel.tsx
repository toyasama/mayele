import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardData, OperationHistorySession } from '../../lib/api'
import type { GameLevel, GameType } from '../../lib/game'

type ProgressItem = DashboardData['progressByMode'][number]
type ChartMetric = 'accuracy' | 'speed'
type SessionLimit = 5 | 10 | 20

type OperationInsightPanelProps = {
  game: GameType
  level: GameLevel
  progress: ProgressItem
  levelAverageAccuracy: number
  sessions: OperationHistorySession[]
  isLoading: boolean
  hasLoadError: boolean
  gameLabel: (game: string) => string
  levelLabel: (level: string | null) => string
  formatResponseTime: (value: number | null | undefined) => string
  playHref?: (level: GameLevel, game?: GameType) => string
  onClose: () => void
  onRetry: () => void
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }

    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

function sessionAverageResponseTime(session: OperationHistorySession) {
  return session.averageResponseTimeMs
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

function chartGeometry(values: number[], metric: ChartMetric) {
  const width = 320
  const height = 104
  const horizontalInset = 34
  const verticalInset = 10
  const minimum = metric === 'accuracy' ? 0 : Math.min(...values) * 0.85
  const maximum = metric === 'accuracy' ? 100 : Math.max(...values) * 1.15
  const range = Math.max(1, maximum - minimum)

  return {
    points: values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : horizontalInset + (index / (values.length - 1)) * (width - horizontalInset - 10)
      const y = height - verticalInset - ((value - minimum) / range) * (height - verticalInset * 2)
      return { x, y, value }
    }),
    ticks: [maximum, minimum + range / 2, minimum],
  }
}

function accuracyTrendLabel(value: number) {
  if (!value) {
    return 'Stable sur la période'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(0)} points`
}

function speedTrendLabel(value: number) {
  if (!value) {
    return 'Stable sur la période'
  }

  return value > 0 ? `${value.toFixed(1)} s plus rapide` : `${Math.abs(value).toFixed(1)} s plus lent`
}

function chartTickLabel(value: number, metric: ChartMetric) {
  return metric === 'accuracy' ? `${Math.round(value)}%` : `${value.toFixed(1)}s`
}

export function OperationInsightPanel({
  game,
  level,
  progress,
  levelAverageAccuracy,
  sessions,
  isLoading,
  hasLoadError,
  gameLabel,
  levelLabel,
  formatResponseTime,
  playHref,
  onClose,
  onRetry,
}: OperationInsightPanelProps) {
  const [metric, setMetric] = useState<ChartMetric>('accuracy')
  const [limit, setLimit] = useState<SessionLimit>(5)
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null)
  const isMobileDialog = useMediaQuery('(max-width: 767px)')
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const visibleSessions = sessions.slice(0, limit)
  const chronologicalSessions = [...visibleSessions].reverse()
  const chartValues = chronologicalSessions.map((session) => (
    metric === 'accuracy' ? session.score : sessionAverageResponseTime(session) / 1000
  ))
  const geometry = chartValues.length ? chartGeometry(chartValues, metric) : { points: [], ticks: [] }
  const points = geometry.points
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')
  const responseTimes = visibleSessions.map(sessionAverageResponseTime).filter((value) => value > 0)
  const recentAverageResponseTime = responseTimes.length
    ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
    : progress.averageResponseTimeMs ?? 0
  const oldest = chronologicalSessions[0]
  const latest = chronologicalSessions.at(-1)
  const accuracyTrend = oldest && latest ? latest.score - oldest.score : 0
  const speedTrend = oldest && latest
    ? (sessionAverageResponseTime(oldest) - sessionAverageResponseTime(latest)) / 1000
    : 0
  const trend = metric === 'accuracy'
    ? accuracyTrendLabel(accuracyTrend)
    : speedTrendLabel(speedTrend)
  const levelDifference = Math.round(progress.averageAccuracy - levelAverageAccuracy)
  const panelTitle = `${gameLabel(game)} · ${levelLabel(level)}`
  const recentTargetCount = visibleSessions.filter((session) => session.score >= 80).length
  const latestScore = visibleSessions[0]?.score
  const bestRecentScore = visibleSessions.length
    ? Math.max(...visibleSessions.map((session) => session.score))
    : null
  const displayedPointIndex = activePointIndex ?? (points.length === 1 ? 0 : null)
  const displayedPoint = displayedPointIndex === null ? null : points[displayedPointIndex]
  const displayedSession = displayedPointIndex === null ? null : chronologicalSessions[displayedPointIndex]
  const tooltipX = displayedPoint ? Math.max(36, Math.min(202, displayedPoint.x - 55)) : 0
  const tooltipY = displayedPoint ? (displayedPoint.y < 52 ? displayedPoint.y + 8 : displayedPoint.y - 44) : 0

  useEffect(() => {
    if (!isMobileDialog) {
      return
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'))
        const first = focusable[0]
        const last = focusable.at(-1)

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [isMobileDialog, onClose])

  return (
    <>
      {isMobileDialog ? <button className="operation-insight-backdrop" type="button" aria-label="Fermer le détail" onClick={onClose} /> : null}
      <aside
        ref={panelRef}
        className={`operation-insight-panel ${isMobileDialog ? 'is-mobile-dialog' : ''}`}
        id={`operation-insight-${level}-${game}`}
        role={isMobileDialog ? 'dialog' : 'region'}
        aria-modal={isMobileDialog || undefined}
        aria-label={`Détail ${panelTitle}`}
      >
        <header className="operation-insight-header">
          <div>
            <button className="operation-insight-return" type="button" onClick={onClose}>
              <span aria-hidden="true">←</span>
              Retour au niveau {levelLabel(level)}
            </button>
            <h4>{gameLabel(game)}</h4>
            <p> {progress.attempts} sprint{progress.attempts > 1 ? 's' : ''}</p>
          </div>
          {!isMobileDialog && playHref ? (
            <Link className="primary-button operation-insight-header-play" to={playHref(level, game)}>
              Jouer en {gameLabel(game)}
            </Link>
          ) : null}
          <button ref={closeButtonRef} className="operation-insight-close" type="button" aria-label="Fermer le détail de l’opération" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="operation-insight-overview">
          <section className="operation-insight-score" aria-label="Précision moyenne">
            <span>Précision moyenne</span>
            <strong>{progress.attempts ? `${Math.round(progress.averageAccuracy)}%` : '—'}</strong>
            {progress.attempts ? (
              <small className={levelDifference < 0 ? 'negative' : 'positive'}>
                {levelDifference >= 0 ? '+' : ''}{levelDifference} points par rapport au niveau
              </small>
            ) : (
              <small>Pas encore de résultat</small>
            )}
            <i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(100, progress.averageAccuracy))}%` }} /></i>
          </section>

          <dl className="operation-insight-metrics">
            <div>
              <dt>Record</dt>
              <dd>{progress.attempts ? `${progress.bestScore}%` : '—'}</dd>
            </div>
            <div>
              <dt>Meilleure série</dt>
              <dd>{progress.attempts ? progress.bestStreak : '—'}</dd>
            </div>
            <div>
              <dt>Temps récent</dt>
              <dd>{formatResponseTime(recentAverageResponseTime)}</dd>
            </div>
          </dl>
        </div>

        <div className="operation-insight-main">
          <section className="operation-insight-chart" aria-label="Évolution des dernières parties">
            <div className="operation-insight-chart-heading">
              <div>
                <strong>{metric === 'accuracy' ? 'Précision des dernières parties' : 'Temps moyen par réponse'}</strong>
                <span className={(metric === 'accuracy' ? accuracyTrend : speedTrend) < 0 ? 'negative' : 'positive'}>{trend}</span>
              </div>
              <div className="operation-insight-limit" role="group" aria-label="Nombre de parties affichées">
                {([5, 10, 20] as SessionLimit[]).map((value) => (
                  <button
                    type="button"
                    className={limit === value ? 'active' : ''}
                    aria-pressed={limit === value}
                    onClick={() => {
                      setLimit(value)
                      setActivePointIndex(null)
                    }}
                    key={value}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="operation-insight-metric-switch" role="group" aria-label="Mesure du graphique">
              <button type="button" className={metric === 'accuracy' ? 'active' : ''} aria-pressed={metric === 'accuracy'} onClick={() => { setMetric('accuracy'); setActivePointIndex(null) }}>
                Précision
              </button>
              <button type="button" className={metric === 'speed' ? 'active' : ''} aria-pressed={metric === 'speed'} onClick={() => { setMetric('speed'); setActivePointIndex(null) }}>
                Temps
              </button>
            </div>

            {points.length ? (
              <svg className="operation-insight-sparkline" viewBox="0 0 320 128" role="img" aria-label={`Évolution de ${metric === 'accuracy' ? 'la précision' : 'la vitesse'} sur ${points.length} partie${points.length > 1 ? 's' : ''}`}>
                {geometry.ticks.map((tick, index) => {
                  const y = [10, 52, 94][index]
                  return (
                    <g className="operation-insight-grid" key={`${metric}-${tick}-${index}`}>
                      <line x1="34" y1={y} x2="310" y2={y} />
                      <text x="2" y={y + 3}>{chartTickLabel(tick, metric)}</text>
                    </g>
                  )
                })}
                <polyline points={polyline} />
                {points.map((point, index) => (
                  <g
                    className={`operation-insight-point ${displayedPointIndex === index ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${formatSessionDate(chronologicalSessions[index].playedAt)}, ${metric === 'accuracy' ? `${Math.round(point.value)}% de précision` : `${point.value.toFixed(1)} secondes par réponse`}`}
                    onMouseEnter={() => setActivePointIndex(index)}
                    onMouseLeave={() => setActivePointIndex(null)}
                    onFocus={() => setActivePointIndex(index)}
                    onBlur={() => setActivePointIndex(null)}
                    onClick={() => setActivePointIndex((current) => current === index ? null : index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setActivePointIndex((current) => current === index ? null : index)
                      }
                    }}
                    key={`${chronologicalSessions[index].id}-${metric}`}
                  >
                    <circle className="operation-insight-point-hit" cx={point.x} cy={point.y} r="13" />
                    <circle className="operation-insight-point-dot" cx={point.x} cy={point.y} r="4" />
                  </g>
                ))}
                {chronologicalSessions.length === 1 ? (
                  <text className="operation-insight-axis-date" x="160" y="122" textAnchor="middle">{formatSessionDate(chronologicalSessions[0].playedAt)}</text>
                ) : (
                  <>
                    <text className="operation-insight-axis-date" x="34" y="122">{formatSessionDate(chronologicalSessions[0].playedAt)}</text>
                    <text className="operation-insight-axis-date" x="310" y="122" textAnchor="end">{formatSessionDate(chronologicalSessions.at(-1)?.playedAt ?? '')}</text>
                  </>
                )}
                {displayedPoint && displayedSession ? (
                  <g className="operation-insight-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} aria-hidden="true">
                    <rect width="112" height="38" rx="8" />
                    <text x="8" y="15">{metric === 'accuracy' ? `${Math.round(displayedPoint.value)}% de précision` : `${displayedPoint.value.toFixed(1)}s par réponse`}</text>
                    <text x="8" y="29">{formatSessionDate(displayedSession.playedAt)} · {displayedSession.correctAnswers}/{displayedSession.totalQuestions} justes</text>
                  </g>
                ) : null}
              </svg>
            ) : isLoading ? (
              <div className="operation-insight-empty-chart loading" role="status">
                <strong>Chargement des parties…</strong>
                <span>Récupération de cet historique précis.</span>
              </div>
            ) : hasLoadError ? (
              <div className="operation-insight-empty-chart error" role="alert">
                <strong>Historique indisponible</strong>
                <button type="button" onClick={onRetry}>Réessayer</button>
              </div>
            ) : (
              <div className="operation-insight-empty-chart">
                <strong>Aucune partie récente</strong>
                <span>Jouez cette combinaison pour commencer son suivi.</span>
              </div>
            )}
          </section>

          <section className="operation-insight-facts" aria-label="Repères récents">
            <span className="eyebrow">Repères récents</span>
            <dl>
              <div>
                <dt>À 80% ou plus</dt>
                <dd>{visibleSessions.length ? `${recentTargetCount}/${visibleSessions.length}` : '—'}</dd>
              </div>
              <div>
                <dt>Dernier résultat</dt>
                <dd>{latestScore === undefined ? '—' : `${latestScore}%`}</dd>
              </div>
              <div>
                <dt>Meilleur résultat récent</dt>
                <dd>{bestRecentScore === null ? '—' : `${bestRecentScore}%`}</dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="operation-insight-history" aria-label="Résultats récents">
          <div>
            <span className="eyebrow">Historique récent</span>
            <strong>{visibleSessions.length ? `${visibleSessions.length} partie${visibleSessions.length > 1 ? 's' : ''} affichée${visibleSessions.length > 1 ? 's' : ''}` : 'Aucune partie'}</strong>
          </div>
          {visibleSessions.length ? (
            <div className="operation-insight-session-strip">
              {visibleSessions.slice(0, 5).map((session) => (
                <article key={session.id}>
                  <span>{formatSessionDate(session.playedAt)}</span>
                  <strong>{session.score}%</strong>
                  <small>{session.correctAnswers}/{session.totalQuestions} justes</small>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {isMobileDialog && playHref ? (
          <Link className="primary-button operation-insight-play" to={playHref(level, game)}>Jouer en {gameLabel(game)}</Link>
        ) : null}
      </aside>
    </>
  )
}
