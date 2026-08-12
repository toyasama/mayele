import type { ReactNode } from 'react'
import type { DashboardData, PlayerProgress } from '../../lib/api'
import { isDailyMissionV2 } from '../../lib/missionNavigation'

type Mission = DashboardData['missions'][number]

type DashboardPlayerHeaderProps = {
  avatar: ReactNode
  name: string
  handle: string
  progress: PlayerProgress
  missions: Mission[]
}

function boundedProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function DashboardDailyMissions({ missions }: { missions: Mission[] }) {
  const dailyMissions = missions.filter(isDailyMissionV2)

  return (
    <ul className="dashboard-daily-missions" aria-label="Missions du jour">
      {dailyMissions.length ? dailyMissions.map((mission) => {
        const progress = boundedProgress(mission.progress)
        const completed = mission.completed || mission.claimed

        return (
          <li className={completed ? 'is-complete' : ''} key={`${mission.key}-${mission.scopeKey}`}>
            <div>
              <span title={mission.title}>{mission.title}</span>
              <strong>{completed ? 'Terminée' : `${mission.current}/${mission.target}`}</strong>
            </div>
            <span
              className="dashboard-daily-mission-progress"
              role="progressbar"
              aria-label={`Progression de la mission ${mission.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <b style={{ width: `${progress}%` }} />
            </span>
          </li>
        )
      }) : (
        <li className="dashboard-daily-missions-empty">Aucune mission active aujourd’hui.</li>
      )}
    </ul>
  )
}

export function DashboardPlayerHeader({
  avatar,
  name,
  handle,
  progress,
  missions,
}: DashboardPlayerHeaderProps) {
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
        <DashboardDailyMissions missions={missions} />
      </div>
    </header>
  )
}
