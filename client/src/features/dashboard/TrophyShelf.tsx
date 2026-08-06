import { useMemo, useState } from 'react'
import type { DashboardData } from '../../lib/api'
import '../../styles/dashboard-collections-v2.css'

type Badge = DashboardData['badges'][number]

type TrophyShelfProps = {
  badges: Badge[]
  onSelect: (badge: Badge) => void
}

const FAMILY_ORDER = ['mastery', 'speed', 'streak', 'volume']
const SECOND_RANK_TIERS = ['confirmed', 'sprinter_sharp', 'streak_solid', 'volume_pillar']
const THIRD_RANK_TIERS = ['master', 'sprinter_flash', 'streak_long', 'volume_marathon']

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function badgeRankClass(tier: Badge['tier']) {
  if (THIRD_RANK_TIERS.includes(tier)) return 'rank-three'
  if (SECOND_RANK_TIERS.includes(tier)) return 'rank-two'
  return 'rank-one'
}

function BadgeIllustration({ badge }: { badge: Badge }) {
  return (
    <span className={`badge-art ${badgeRankClass(badge.tier)}`} aria-hidden="true">
      <span className="badge-core">
        <span className="badge-family-icon">{badge.familyLabel}</span>
      </span>
      <span className="badge-tier-flourish" />
      {badge.completed ? null : <span className="badge-lock-icon" />}
    </span>
  )
}

export function TrophyShelf({ badges, onSelect }: TrophyShelfProps) {
  const families = useMemo(() => Array.from(new Map(badges.map((badge) => [badge.family, badge.familyLabel])).entries())
    .sort((left, right) => {
      const leftRank = FAMILY_ORDER.indexOf(left[0])
      const rightRank = FAMILY_ORDER.indexOf(right[0])
      return (leftRank < 0 ? FAMILY_ORDER.length : leftRank) - (rightRank < 0 ? FAMILY_ORDER.length : rightRank)
    }), [badges])
  const [activeFamily, setActiveFamily] = useState(() => families[0]?.[0] ?? 'all')
  const selectedFamily = activeFamily === 'all' || families.some(([family]) => family === activeFamily)
    ? activeFamily
    : (families[0]?.[0] ?? 'all')
  const visibleBadges = selectedFamily === 'all' ? badges : badges.filter((badge) => badge.family === selectedFamily)
  const completedCount = badges.filter((badge) => badge.completed).length

  return (
    <section className="trophy-cabinet" aria-label="Collection de badges">
      <div className="trophy-cabinet-heading">
        <div>
          <h3>Trophées</h3>
        </div>
        <strong>{completedCount}/{badges.length} débloqués</strong>
      </div>

      <section className="trophy-mode-section" aria-labelledby="trophy-mode-sprint-title">
        <header className="trophy-mode-heading">
          <div>
            <span>Mode de jeu</span>
            <h4 id="trophy-mode-sprint-title">Sprint</h4>
          </div>
          <p>Badges obtenus lors des Sprints solo terminés.</p>
        </header>

        <div className="trophy-family-tabs" role="tablist" aria-label="Familles de badges Sprint">
          <button
            type="button"
            id="trophy-family-all"
            role="tab"
            aria-controls="trophy-family-panel"
            aria-selected={selectedFamily === 'all'}
            className={selectedFamily === 'all' ? 'active' : ''}
            onClick={() => setActiveFamily('all')}
          >
            <span>Tous</span>
            <small>{completedCount}/{badges.length}</small>
          </button>
          {families.map(([family, label]) => {
            const familyBadges = badges.filter((badge) => badge.family === family)
            const familyCompleted = familyBadges.filter((badge) => badge.completed).length

            return (
              <button
                type="button"
                id={`trophy-family-${family}`}
                role="tab"
                aria-controls="trophy-family-panel"
                aria-selected={selectedFamily === family}
                className={selectedFamily === family ? 'active' : ''}
                key={family}
                onClick={() => setActiveFamily(family)}
              >
                <span>{label}</span>
                <small>{familyCompleted}/{familyBadges.length}</small>
              </button>
            )
          })}
        </div>

        <div
          id="trophy-family-panel"
          className="badge-family-stack trophy-shelf-stack"
          role="tabpanel"
          aria-labelledby={`trophy-family-${selectedFamily}`}
        >
          {visibleBadges.length ? Array.from({ length: Math.ceil(visibleBadges.length / 6) }, (_, shelfIndex) => (
            <div className="trophy-shelf" key={`shelf-${shelfIndex}`}>
              {visibleBadges.slice(shelfIndex * 6, shelfIndex * 6 + 6).map((badge) => {
                const progress = clampPercent(badge.progress)

                return (
                  <button
                    type="button"
                    className={`badge-objective-card trophy-item badge-family-${badge.family} badge-${badge.tier} ${badge.completed ? 'earned' : 'locked'}`}
                    aria-label={`Afficher le détail du badge ${badge.title}, ${progress}%`}
                    key={badge.key}
                    onClick={() => onSelect(badge)}
                  >
                    <BadgeIllustration badge={badge} />
                    <span className="trophy-item-copy">
                      <strong>{badge.title}</strong>
                      <small>{badge.completed ? 'Débloqué' : `${badge.completedObjectives}/${badge.totalObjectives} objectifs`}</small>
                    </span>
                    <span className="trophy-item-progress">
                      <span>
                        <small>{badge.completed ? 'Terminé' : 'Progression'}</small>
                        <strong>{progress}%</strong>
                      </span>
                      <progress max="100" value={progress} aria-label={`Progression du badge ${badge.title}`} />
                    </span>
                  </button>
                )
              })}
            </div>
          )) : (
            <p className="trophy-empty-state">Aucun badge dans cette famille.</p>
          )}
        </div>
      </section>
    </section>
  )
}
