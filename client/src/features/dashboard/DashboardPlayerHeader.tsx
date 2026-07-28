import type { ReactNode } from 'react'
import type { PlayerProgress } from '../../lib/api'

type DashboardPlayerHeaderProps = {
  avatar: ReactNode
  name: string
  handle: string
  progress: PlayerProgress
  bestStreak: number
  todaySessions: number
  dailyGoal: number
  lastPlayedAt: string | null
  formatDate: (value: string | null) => string
}

export function DashboardPlayerHeader({
  avatar,
  name,
  handle,
  progress,
  bestStreak,
  todaySessions,
  dailyGoal,
  lastPlayedAt,
  formatDate,
}: DashboardPlayerHeaderProps) {
  const dailyProgress = dailyGoal ? Math.min(100, Math.round((todaySessions / dailyGoal) * 100)) : 0

  return (
    <header className="dashboard-player-header" id="overview">
      <div className="dashboard-player-identity">
        {avatar}
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1 className="dashboard-profile-title">{name}</h1>
          <p>{handle}</p>
        </div>
      </div>

      <div className="dashboard-level-progress">
        <div className="dashboard-level-heading">
          <span>Niveau {progress.level}</span>
          <strong>{progress.nextLevel ? `${progress.xpRemaining} XP avant le niveau ${progress.nextLevel}` : 'Niveau maximal atteint'}</strong>
        </div>
        <div
          className="dashboard-level-track"
          role="progressbar"
          aria-label="Progression du niveau"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.progress}
        >
          <i style={{ width: `${progress.progress}%` }} />
        </div>
      </div>

      <div className="dashboard-player-pulse">
        <div>
          <span>Aujourd’hui</span>
          <strong>{todaySessions}/{dailyGoal} partie{dailyGoal > 1 ? 's' : ''}</strong>
          <i
            role="progressbar"
            aria-label="Objectif quotidien"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={dailyProgress}
          >
            <b style={{ width: `${dailyProgress}%` }} />
          </i>
        </div>
        <div>
          <span>Meilleure série</span>
          <strong>{bestStreak}</strong>
          <small>réponses justes</small>
        </div>
        <div>
          <span>Dernière partie</span>
          <strong>{formatDate(lastPlayedAt)}</strong>
        </div>
      </div>
    </header>
  )
}
