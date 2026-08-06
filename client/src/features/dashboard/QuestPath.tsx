import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardData } from '../../lib/api'
import { isDailyMissionV2, missionConfigurationLabel, missionLaunchPath, missionLevelLabel } from '../../lib/missionNavigation'

type Mission = DashboardData['missions'][number]

type QuestPathProps = {
  missions: Mission[]
}

function questState(mission: Mission, index: number, firstIncompleteIndex: number) {
  if (mission.claimed || mission.completed) {
    return 'done'
  }

  if (index === firstIncompleteIndex) {
    return 'current'
  }

  return 'upcoming'
}

export function QuestPath({ missions }: QuestPathProps) {
  const renderableMissions = missions.filter(isDailyMissionV2)
  const firstIncompleteIndex = renderableMissions.findIndex((mission) => !mission.completed && !mission.claimed)
  const completedCount = renderableMissions.filter((mission) => mission.completed || mission.claimed).length

  return (
    <section className="quest-path-board" aria-label="Parcours de missions">
      <div className="quest-path-heading">
        <div>
          <h3>Objectifs du jour</h3>
        </div>
        <strong>{completedCount}/{renderableMissions.length} étapes</strong>
      </div>

      {renderableMissions.length ? (
        <ol className="mission-board-grid quest-path-list">
          {renderableMissions.map((mission, index) => {
            const state = questState(mission, index, firstIncompleteIndex)

            return (
              <li
                className={`mission-xp-card quest-path-step is-${state}`}
                key={`${mission.key}-${mission.scopeKey}`}
                style={{ '--quest-progress': `${Math.max(0, Math.min(100, mission.progress))}%` } as CSSProperties}
              >
                <span className="quest-node" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
                <div className="quest-step-copy">
                  <h3>{mission.title}</h3>
                  <span className="mission-tag-row" aria-label={`Mission ${mission.tierLabel}, ${mission.requirements.playContext === 'solo' ? 'Solo' : 'Multijoueur'}, ${mission.requirements.challengeMode === 'sprint' ? 'Sprint' : 'Tempo'}, niveau ${missionLevelLabel(mission)}, configuration ${missionConfigurationLabel(mission)}`}>
                    <em data-tier={mission.tier}>{mission.tierLabel}</em>
                    <em>{mission.requirements.playContext === 'solo' ? 'Solo' : 'Multi'}</em>
                    <em>{mission.requirements.challengeMode === 'sprint' ? 'Sprint' : 'Tempo'}</em>
                    <em>{missionLevelLabel(mission)}</em>
                    <em>{missionConfigurationLabel(mission)}</em>
                  </span>
                  <p>{mission.description}</p>
                  <div className="quest-step-progress">
                    <span aria-hidden="true"><i /></span>
                    <strong>{mission.current}/{mission.target}</strong>
                  </div>
                </div>
                <div className="quest-reward">
                  <strong>+{mission.rewardXp}</strong>
                  <span>XP</span>
                  <small>{mission.claimed ? 'Reçue' : mission.completed ? 'Validée' : `${mission.progress}%`}</small>
                  {!mission.completed && !mission.claimed ? (
                    <Link className="mission-prepare-link" to={missionLaunchPath(mission)}>
                      Préparer
                    </Link>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="dashboard-empty-state"><strong>Aucune quête active</strong><span>Revenez après votre prochain sprint.</span></div>
      )}
    </section>
  )
}
