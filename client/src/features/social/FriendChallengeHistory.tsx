import type { FriendProfileData } from '../../lib/api'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../../lib/game'

type HeadToHead = NonNullable<FriendProfileData['headToHead']>

type FriendChallengeHistoryProps = {
  friendName: string
  headToHead?: HeadToHead
}

function outcomeLabel(outcome: HeadToHead['recent'][number]['outcome']) {
  if (outcome === 'win') return 'Gagné'
  if (outcome === 'loss') return 'Perdu'
  return 'Égalité'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(value))
}

export function FriendChallengeHistory({ friendName, headToHead }: FriendChallengeHistoryProps) {
  const summary = headToHead?.summary ?? { wins: 0, losses: 0, draws: 0 }

  return (
    <section className="friend-duel-history friend-profile-section" aria-labelledby="friend-history-title">
      <div className="friend-profile-section-header">
        <div>
          <span className="eyebrow">Face-à-face</span>
          <h2 id="friend-history-title">Vos derniers défis</h2>
        </div>
        {headToHead ? (
          <div className="friend-duel-score" aria-label={`${summary.wins} gagnés, ${summary.losses} perdus et ${summary.draws} égalités`}>
            <span><strong>{summary.wins}</strong> G</span>
            <span><strong>{summary.losses}</strong> P</span>
            <span><strong>{summary.draws}</strong> N</span>
          </div>
        ) : null}
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
              <em>{outcomeLabel(challenge.outcome)}</em>
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
  )
}
