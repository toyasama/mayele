import type { MatchParticipantData } from '../../lib/api'

type ResultOutcome = 'winner' | 'loser' | 'neutral'

type MatchResultStageProps = {
  self: MatchParticipantData | null
  opponent: MatchParticipantData | null
  opponentName: string
  selfOutcome: ResultOutcome
  opponentOutcome: ResultOutcome
  selfForfeited: boolean
  opponentForfeited: boolean
  opponentDismissed: boolean
  rematchRequested: boolean
  opponentRematchRequested: boolean
  rematchPending: boolean
  onRematch: () => void
  onLeave: () => void
}

function outcomeLabel(outcome: ResultOutcome) {
  if (outcome === 'winner') return 'Victoire'
  if (outcome === 'loser') return 'Défaite'
  return 'Égalité'
}

function ResultPlayer({
  participant,
  name,
  outcome,
  forfeited,
  playerKey,
}: {
  participant: MatchParticipantData | null
  name: string
  outcome: ResultOutcome
  forfeited: boolean
  playerKey: 'self' | 'opponent'
}) {
  return (
    <div
      className={`multiplayer-result-player is-${outcome}`}
      data-forfeited={forfeited ? 'true' : 'false'}
      data-result-outcome={outcome}
      data-result-player={playerKey}
    >
      <div className="multiplayer-result-player-line">
        <span>{name}</span>
        <small>+{participant?.xp ?? 0} XP</small>
      </div>
      {forfeited ? <span className="multiplayer-result-forfeit-badge">Abandon</span> : null}
      <div className="multiplayer-result-score">
        <strong>{participant?.scorePoints ?? 0}</strong>
        <span>points</span>
      </div>
      <div className="multiplayer-result-stats">
        <strong>{participant ? `${participant.correctAnswers}/${participant.totalQuestions}` : '-'}<small>bonnes</small></strong>
        <strong>{participant?.bestStreak ?? 0}<small>série</small></strong>
        <strong>{participant?.totalQuestions ?? 0}<small>questions</small></strong>
      </div>
    </div>
  )
}

export function MatchResultStage({
  self,
  opponent,
  opponentName,
  selfOutcome,
  opponentOutcome,
  selfForfeited,
  opponentForfeited,
  opponentDismissed,
  rematchRequested,
  opponentRematchRequested,
  rematchPending,
  onRematch,
  onLeave,
}: MatchResultStageProps) {
  return (
    <div className="multiplayer-result-panel multiplayer-result-stage">
      <header className={`multiplayer-result-verdict is-${selfOutcome}`}>
        <strong>{outcomeLabel(selfOutcome)}</strong>
      </header>

      <div className="multiplayer-result-grid">
        <ResultPlayer participant={self} name="Vous" outcome={selfOutcome} forfeited={selfForfeited} playerKey="self" />
        <span className="multiplayer-result-versus" aria-hidden="true">VS</span>
        <ResultPlayer participant={opponent} name={opponent?.player.name ?? opponentName} outcome={opponentOutcome} forfeited={opponentForfeited} playerKey="opponent" />
      </div>

      <div className="multiplayer-result-actions">
        {opponentDismissed ? (
          <button className="secondary-button full-width" type="button" disabled>
            Relance indisponible
          </button>
        ) : (
          <button className="primary-button full-width" type="button" disabled={rematchRequested || rematchPending} onClick={onRematch}>
            {rematchRequested ? 'Relance demandée' : 'Rejouer ce duel'}
          </button>
        )}
        <button className="secondary-button full-width" type="button" onClick={onLeave}>
          Quitter le résultat
        </button>
      </div>

      {opponentDismissed ? <p className="muted">L’adversaire est parti. Lancez un nouveau défi pour rejouer.</p> : null}
      {rematchRequested && !opponentRematchRequested && !opponentDismissed ? <p className="muted">Demande envoyée. En attente de la réponse adverse.</p> : null}
    </div>
  )
}
