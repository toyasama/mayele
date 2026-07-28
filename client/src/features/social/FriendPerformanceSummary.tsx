import type { FriendProfileData } from '../../lib/api'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../../lib/game'

type FriendPerformanceSummaryProps = {
  stats: FriendProfileData['stats']
}

const LEVEL_ORDER: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']

function formatResponseTime(value: number | null | undefined) {
  if (!value) return '—'
  if (value < 1000) return `${Math.round(value)} ms`

  const seconds = value / 1000
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)} s`
}

function scoreTone(score: number) {
  if (score < 25) return 'is-red'
  if (score < 50) return 'is-yellow'
  if (score < 75) return 'is-orange'
  return 'is-green'
}

export function FriendPerformanceSummary({ stats }: FriendPerformanceSummaryProps) {
  const levelsByKey = new Map(stats.byLevel.map((level) => [level.level as GameLevel, level]))
  const playedLevels = stats.byLevel.filter((level) => level.attempts > 0)
  const totalAttempts = playedLevels.reduce((sum, level) => sum + level.attempts, 0)

  return (
    <section className="friend-performance-v3 friend-profile-section" aria-labelledby="friend-performance-title">
      <div className="friend-profile-section-header">
        <div>
          <span className="eyebrow">Résultats</span>
          <h2 id="friend-performance-title">Niveau par niveau</h2>
        </div>
        <span className="friend-profile-section-meta">{totalAttempts} sprint{totalAttempts > 1 ? 's' : ''}</span>
      </div>

      <div className="friend-level-rail">
        {LEVEL_ORDER.map((levelKey) => {
          const level = levelsByKey.get(levelKey)
          const accuracy = level?.attempts ? Math.round(level.averageAccuracy) : 0

          return (
            <article className={`friend-level-row ${level?.attempts ? scoreTone(accuracy) : 'is-unplayed'}`} key={levelKey}>
              <div className="friend-level-row-title">
                <strong>{LEVEL_LABELS[levelKey]}</strong>
                <span>{level?.attempts ? `${accuracy}%` : 'Non joué'}</span>
              </div>
              <div className="friend-level-row-bar" aria-label={level?.attempts ? `${accuracy}% de précision` : 'Niveau non joué'}>
                <i style={{ width: `${accuracy}%` }} />
              </div>
              <dl>
                <div><dt>Sprints</dt><dd>{level?.attempts ?? 0}</dd></div>
                <div><dt>Record</dt><dd>{level?.attempts ? `${level.bestScore}%` : '—'}</dd></div>
                <div><dt>Série</dt><dd>{level?.bestStreak ?? 0}</dd></div>
                <div><dt>Temps</dt><dd>{formatResponseTime(level?.averageResponseTimeMs)}</dd></div>
              </dl>
            </article>
          )
        })}
      </div>

      <div className="friend-operation-strip" aria-label="Résultats par opération">
        {stats.byGame.map((game) => (
          <article className={game.attempts ? scoreTone(game.averageAccuracy) : 'is-unplayed'} key={game.game}>
            <span>{GAME_LABELS[game.game as GameType] ?? game.game}</span>
            <strong>{game.attempts ? `${Math.round(game.averageAccuracy)}%` : '—'}</strong>
            <small>{game.attempts} sprint{game.attempts > 1 ? 's' : ''}</small>
          </article>
        ))}
      </div>
    </section>
  )
}
