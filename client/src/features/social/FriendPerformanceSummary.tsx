import type { FriendProfileData, OperationHistorySession } from '../../lib/api'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../../lib/game'
import { PerformanceCockpit } from '../dashboard/PerformanceCockpit'

type FriendPerformanceSummaryProps = {
  stats: FriendProfileData['stats']
  progressByMode: FriendProfileData['progressByMode']
  loadOperationHistory: (game: GameType, level: GameLevel) => Promise<OperationHistorySession[]>
}

function formatResponseTime(value: number | null | undefined) {
  if (!value) return '—'
  if (value < 1000) return `${Math.round(value)} ms`

  const seconds = value / 1000
  return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)} s`
}

function gameLabel(value: string) {
  return GAME_LABELS[value as GameType] ?? value
}

function levelLabel(value: string | null) {
  if (!value) return 'Débutant'
  return LEVEL_LABELS[value as GameLevel] ?? value
}

export function FriendPerformanceSummary({ stats, progressByMode, loadOperationHistory }: FriendPerformanceSummaryProps) {
  return (
    <div className="friend-performance-cockpit">
      <PerformanceCockpit
        stats={stats}
        progressByMode={progressByMode}
        loadOperationHistory={loadOperationHistory}
        gameLabel={gameLabel}
        levelLabel={levelLabel}
        formatResponseTime={formatResponseTime}
      />
    </div>
  )
}
