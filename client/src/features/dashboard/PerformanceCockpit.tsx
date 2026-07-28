import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardData, OperationHistorySession } from '../../lib/api'
import type { GameLevel, GameType } from '../../lib/game'
import { OperationInsightPanel } from './OperationInsightPanel'
import '../../styles/dashboard-performance-v2.css'

type LevelStat = DashboardData['stats']['byLevel'][number]
type ProgressItem = DashboardData['progressByMode'][number]

type PerformanceCockpitProps = {
  stats: DashboardData['stats']
  progressByMode: DashboardData['progressByMode']
  recentSessions: DashboardData['recentSessions']
  loadOperationHistory: (game: GameType, level: GameLevel) => Promise<OperationHistorySession[]>
  gameLabel: (game: string) => string
  levelLabel: (level: string | null) => string
  formatResponseTime: (value: number | null | undefined) => string
  playHref: (level: GameLevel, game?: GameType) => string
}

const LEVELS: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']
const GAMES: GameType[] = ['addition', 'soustraction', 'multiplication', 'division', 'mixte']

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function sampleLabel(attempts: number) {
  if (!attempts) {
    return 'Pas encore joué'
  }

  if (attempts < 3) {
    return 'Premier repère'
  }

  if (attempts < 10) {
    return 'Tendance à confirmer'
  }

  return 'Résultat confirmé'
}

function performanceLabel(accuracy: number, attempts: number) {
  if (!attempts) {
    return 'Niveau à découvrir'
  }

  if (accuracy >= 85) {
    return 'Très régulier à ce niveau'
  }

  if (accuracy >= 70) {
    return 'De bons acquis à ce niveau'
  }

  if (accuracy >= 50) {
    return 'En progression à ce niveau'
  }

  return 'Ce niveau demande encore de la pratique'
}

function levelStatFor(stats: DashboardData['stats'], level: GameLevel): LevelStat {
  return stats.byLevel.find((item) => item.level === level) ?? {
    level,
    attempts: 0,
    averageAccuracy: 0,
    bestScore: 0,
    bestStreak: 0,
    averageResponseTimeMs: 0,
    lastPlayedAt: null,
  }
}

function formatShortDate(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

function nextActionLabel(item: ProgressItem | undefined) {
  if (!item?.attempts) {
    return 'À essayer ensuite'
  }

  if (item.averageAccuracy < 70) {
    return 'À retravailler'
  }

  if (item.averageAccuracy < 85) {
    return 'À consolider'
  }

  return 'Pour continuer'
}

function gameProgressForLevel(progressByMode: ProgressItem[], level: GameLevel) {
  return GAMES.map((game) => progressByMode.find((item) => item.level === level && item.game === game) ?? {
    game,
    level,
    attempts: 0,
    bestScore: 0,
    averageScore: 0,
    averageAccuracy: 0,
    bestStreak: 0,
    lastPlayedAt: null,
  })
}

function defaultSelectedLevel(stats: DashboardData['stats']) {
  return [...LEVELS]
    .reverse()
    .find((level) => levelStatFor(stats, level).attempts > 0) ?? LEVELS[0]
}

function dashboardSessionToHistory(session: DashboardData['recentSessions'][number]): OperationHistorySession {
  const responseTimes = session.answers.map((answer) => answer.responseTimeMs)

  return {
    id: session.id,
    score: session.score,
    correctAnswers: session.correctAnswers,
    totalQuestions: session.totalQuestions,
    bestStreak: session.bestStreak,
    playedAt: session.playedAt,
    averageResponseTimeMs: responseTimes.length
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0,
  }
}

type OperationHistoryState =
  | { status: 'loading'; sessions: OperationHistorySession[] }
  | { status: 'ready'; sessions: OperationHistorySession[] }
  | { status: 'error'; sessions: OperationHistorySession[] }

export function PerformanceCockpit({
  stats,
  progressByMode,
  recentSessions,
  loadOperationHistory,
  gameLabel,
  levelLabel,
  formatResponseTime,
  playHref,
}: PerformanceCockpitProps) {
  const [selectedLevel, setSelectedLevel] = useState<GameLevel>(() => defaultSelectedLevel(stats))
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null)
  const [operationHistories, setOperationHistories] = useState<Record<string, OperationHistoryState>>({})
  const historyRequestsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const selected = levelStatFor(stats, selectedLevel)
  const selectedGames = gameProgressForLevel(progressByMode, selectedLevel)
  const playedGames = selectedGames.filter((item) => item.attempts > 0)
  const selectedProgress = selectedGame ? selectedGames.find((item) => item.game === selectedGame) : undefined
  const historyKey = selectedGame ? `${selectedLevel}:${selectedGame}` : null
  const historyState = historyKey ? operationHistories[historyKey] : undefined
  const fallbackHistory = useMemo(
    () => selectedGame
      ? recentSessions
        .filter((session) => session.level === selectedLevel && session.game === selectedGame)
        .map(dashboardSessionToHistory)
      : [],
    [recentSessions, selectedGame, selectedLevel],
  )
  const operationHistory = historyState?.status === 'ready' ? historyState.sessions : fallbackHistory
  const priorityGame = [...selectedGames].sort((left, right) => {
    if (!left.attempts && right.attempts) return -1
    if (left.attempts && !right.attempts) return 1
    return left.averageAccuracy - right.averageAccuracy
  })[0]
  const closeOperationDetail = useCallback(() => setSelectedGame(null), [])
  const retryOperationHistory = useCallback(() => {
    if (!historyKey) {
      return
    }

    historyRequestsRef.current.delete(historyKey)
    setOperationHistories((current) => {
      const next = { ...current }
      delete next[historyKey]
      return next
    })
  }, [historyKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!selectedGame || !selectedProgress?.attempts || !historyKey || historyState || historyRequestsRef.current.has(historyKey)) {
      return
    }

    historyRequestsRef.current.add(historyKey)
    setOperationHistories((current) => ({
      ...current,
      [historyKey]: { status: 'loading', sessions: fallbackHistory },
    }))

    void loadOperationHistory(selectedGame, selectedLevel)
      .then((sessions) => {
        if (mountedRef.current) {
          setOperationHistories((current) => ({
            ...current,
            [historyKey]: { status: 'ready', sessions },
          }))
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setOperationHistories((current) => ({
            ...current,
            [historyKey]: { status: 'error', sessions: fallbackHistory },
          }))
        }
      })
  }, [fallbackHistory, historyKey, historyState, loadOperationHistory, selectedGame, selectedLevel, selectedProgress?.attempts])

  return (
    <section className="performance-v2" aria-labelledby="performance-v2-title">

      <div className="performance-level-tabs" role="group" aria-label="Choisir un niveau de difficulté">
        {LEVELS.map((level) => {
          const item = levelStatFor(stats, level)
          const active = selectedLevel === level
          const accuracy = boundedPercent(item.averageAccuracy)

          return (
            <button
              type="button"
              id={`performance-tab-${level}`}
              aria-controls={`performance-panel-${level}`}
              aria-pressed={active}
              className={`performance-level-tab ${active ? 'active' : ''} ${item.attempts ? 'played' : 'unplayed'}`}
              key={level}
              onClick={() => {
                setSelectedLevel(level)
                setSelectedGame(null)
              }}
            >
              <span className="performance-level-tab-heading">
                <strong>{levelLabel(level)}</strong>
              </span>
              <span
                className="performance-level-ring"
                style={{ '--level-accuracy': `${accuracy}%` } as CSSProperties}
                aria-label={item.attempts ? `${accuracy}% de précision au niveau ${levelLabel(level)}` : `Niveau ${levelLabel(level)} pas encore joué`}
              >
                <strong>{item.attempts ? `${accuracy}%` : '—'}</strong>
              </span>
              <span className="performance-level-sample">
                <strong>{item.attempts} sprint{item.attempts > 1 ? 's' : ''}</strong>
                <small>{sampleLabel(item.attempts)}</small>
              </span>
            </button>
          )
        })}
      </div>

      <article
        className={`performance-level-detail ${selectedGame && selectedProgress ? 'is-operation-selected' : ''}`}
        id={`performance-panel-${selectedLevel}`}
        aria-labelledby={`performance-tab-${selectedLevel}`}
        aria-live="polite"
      >
        {selectedGame && selectedProgress ? (
          <OperationInsightPanel
            game={selectedGame}
            level={selectedLevel}
            progress={selectedProgress}
            levelAverageAccuracy={selected.averageAccuracy}
            sessions={operationHistory}
            isLoading={historyState?.status === 'loading' || (!historyState && Boolean(selectedProgress.attempts))}
            hasLoadError={historyState?.status === 'error'}
            gameLabel={gameLabel}
            levelLabel={levelLabel}
            formatResponseTime={formatResponseTime}
            playHref={playHref}
            onClose={closeOperationDetail}
            onRetry={retryOperationHistory}
          />
        ) : null}

        <div className="performance-level-summary">
          <div className="performance-level-summary-heading">
            <h3>{levelLabel(selectedLevel)}</h3>
            <p>{performanceLabel(selected.averageAccuracy, selected.attempts)}</p>
          </div>

          <div className="performance-level-score">
            <strong>{selected.attempts ? `${boundedPercent(selected.averageAccuracy)}%` : '—'}</strong>
            <span>{selected.attempts ? 'de précision' : 'aucun résultat'}</span>
            <small>{sampleLabel(selected.attempts)}</small>
          </div>

          <dl className="performance-level-metrics">
            <div>
              <dt>Meilleur score</dt>
              <dd>{selected.attempts ? `${selected.bestScore}%` : '—'}</dd>
            </div>
            <div>
              <dt>Meilleure série</dt>
              <dd>{selected.attempts ? selected.bestStreak : '—'}</dd>
            </div>
            <div>
              <dt>Temps moyen</dt>
              <dd>{formatResponseTime(selected.averageResponseTimeMs)}</dd>
            </div>
            <div>
              <dt>Dernière partie</dt>
              <dd>{formatShortDate(selected.lastPlayedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="performance-mode-detail">
          <div className="performance-mode-heading">
            <span>{playedGames.length}/{GAMES.length} modes joués</span>
          </div>

          <div className="performance-mode-workspace">
            <div className="performance-mode-list" role="list" aria-label={`Résultats par opération au niveau ${levelLabel(selectedLevel)}`}>
              {selectedGames.map((item) => {
                const accuracy = boundedPercent(item.averageAccuracy)
                const active = selectedGame === item.game

                return (
                  <div className="performance-mode-list-item" role="listitem" key={item.game}>
                    <button
                      className={`performance-mode-row ${item.attempts ? 'played' : 'unplayed'} ${active ? 'active' : ''}`}
                      type="button"
                      aria-expanded={active}
                      aria-controls={active ? `operation-insight-${selectedLevel}-${item.game}` : undefined}
                      onClick={() => setSelectedGame((current) => current === item.game ? null : item.game as GameType)}
                    >
                      <span className="performance-mode-name">
                        <strong>{gameLabel(item.game)}</strong>
                        <small>{item.attempts ? `${item.attempts} sprint${item.attempts > 1 ? 's' : ''}` : 'Pas encore joué'}</small>
                      </span>
                      <span className="performance-mode-track" aria-hidden="true">
                        <i style={{ width: `${accuracy}%` }} />
                      </span>
                      <span className="performance-mode-score">
                        <strong>{item.attempts ? `${accuracy}%` : '—'}</strong>
                        <small>{item.attempts ? `record ${item.bestScore}%` : ''}</small>
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>

          </div>

          <div className="performance-level-action">
            <div>
              <span>{nextActionLabel(priorityGame)}</span>
              <strong>{priorityGame ? gameLabel(priorityGame.game) : 'Mixte'}</strong>
            </div>
            <Link className="primary-button" to={playHref(selectedLevel, (priorityGame?.game as GameType | undefined) ?? 'mixte')}>
              Jouer en {levelLabel(selectedLevel)}
            </Link>
          </div>
        </div>
      </article>
    </section>
  )
}
