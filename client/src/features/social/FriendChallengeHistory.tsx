import type { FriendProfileData } from '../../lib/api'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../../lib/game'

type HeadToHead = NonNullable<FriendProfileData['headToHead']>

type FriendChallengeHistoryProps = {
  friendName: string
  headToHead?: HeadToHead
  onChallenge: () => void
}

function outcomeLabel(challenge: HeadToHead['recent'][number]) {
  if (challenge.decidedBy === 'forfeit' && challenge.outcome === 'win') return 'Gagné par forfait'
  if (challenge.decidedBy === 'forfeit' && challenge.outcome === 'loss') return 'Perdu par forfait'

  if (challenge.outcome === 'win') return 'Gagné'
  if (challenge.outcome === 'loss') return 'Perdu'
  return 'Égalité'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(value))
}

export function FriendChallengeHistory({ friendName, headToHead, onChallenge }: FriendChallengeHistoryProps) {
  const summary = headToHead?.summary ?? { wins: 0, losses: 0, draws: 0 }

  return (
    <section className="friend-duels-view" aria-labelledby="friend-duels-title">
      <div className="friend-duel-overview">
        <div className="friend-duel-overview-copy">
          <span className="eyebrow">Face-à-face</span>
          <h2 id="friend-duels-title">Votre bilan</h2>
          <p>Retrouvez vos résultats communs et relancez un défi avec {friendName}.</p>
        </div>
        <div
          className="friend-versus-record friend-duel-overview-record"
          aria-label={`${summary.wins} gagnés, ${summary.losses} perdus et ${summary.draws} égalités`}
        >
          <span><strong>{summary.wins}</strong> gagnés</span>
          <span><strong>{summary.losses}</strong> perdus</span>
          <span><strong>{summary.draws}</strong> nuls</span>
        </div>
        <button className="primary-button" type="button" onClick={onChallenge}>
          Défier {friendName}
        </button>
      </div>

      <section className="friend-duel-history friend-profile-section" aria-labelledby="friend-history-title">
        <div className="friend-profile-section-header">
          <div>
            <span className="eyebrow">Duels</span>
            <h2 id="friend-history-title">Vos derniers défis</h2>
          </div>
        </div>

        {!headToHead ? (
          <div className="friend-duel-empty">
            <span aria-hidden="true">VS</span>
            <div>
              <strong>Historique indisponible</strong>
              <small>{friendName}</small>
            </div>
          </div>
        ) : headToHead.recent.length ? (
          <div className="friend-duel-list">
            {headToHead.recent.map((challenge) => (
              <article className={`friend-duel-row is-${challenge.outcome}`} key={challenge.id}>
                <time dateTime={challenge.playedAt}>{formatDate(challenge.playedAt)}</time>
                <div>
                  <strong>{GAME_LABELS[challenge.game as GameType] ?? challenge.game}</strong>
                  <span>{challenge.challengeMode === 'tempo' ? 'Tempo' : 'Sprint'} · {LEVEL_LABELS[challenge.level as GameLevel] ?? challenge.level}</span>
                </div>
                <span className="friend-duel-row-score">
                  <strong>{challenge.myScore ?? '—'}</strong>
                  <i>:</i>
                  <strong>{challenge.friendScore ?? '—'}</strong>
                </span>
                <em>{outcomeLabel(challenge)}</em>
              </article>
            ))}
          </div>
        ) : (
          <div className="friend-duel-empty">
            <span aria-hidden="true">VS</span>
            <div>
              <strong>Aucun défi terminé</strong>
              <small>Vous et {friendName}</small>
            </div>
          </div>
        )}
      </section>
    </section>
  )
}
