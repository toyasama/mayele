import type { SessionRewardData } from '../lib/api'
import '../styles/earned-rewards.css'

type EarnedRewardsProps = {
  rewards: SessionRewardData | null | undefined
}

export function EarnedRewards({ rewards }: EarnedRewardsProps) {
  const completedMissions = rewards?.completedMissions ?? []
  const completedBadges = rewards?.completedBadges ?? []

  if (!completedMissions.length && !completedBadges.length) {
    return null
  }

  return (
    <section className="earned-rewards" aria-label="Récompenses obtenues">
      <header className="earned-rewards-heading">
        <span aria-hidden="true">★</span>
        <div>
          <small>Gains de la partie</small>
          <h2>Récompenses obtenues</h2>
        </div>
      </header>

      <ul className="earned-rewards-list">
        {completedMissions.map((mission) => (
          <li className="earned-reward reward-mission" key={`mission-${mission.key}`}>
            <span className="earned-reward-symbol" aria-hidden="true">✓</span>
            <span className="earned-reward-copy">
              <small>Mission terminée</small>
              <strong>{mission.title}</strong>
            </span>
            <span className="earned-reward-xp">+{mission.rewardXp} XP</span>
          </li>
        ))}
        {completedBadges.map((badge) => (
          <li className="earned-reward reward-badge" key={`badge-${badge.key}`}>
            <span className="earned-reward-symbol" aria-hidden="true">★</span>
            <span className="earned-reward-copy">
              <small>Badge débloqué · {badge.familyLabel}</small>
              <strong>{badge.title}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
