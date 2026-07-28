import type { MatchData, PublicPlayer } from '../../lib/api'
import { matchSetupSummary, playerInitials } from '../../lib/multiplayerPageUtils'

type MultiplayerLobbyProps = {
  action: string
  friends: PublicPlayer[]
  invitations: MatchData[]
  onDeclineInvitation: (match: MatchData) => void
  onInvite: (friend: PublicPlayer) => void
  onNewChallenge: () => void
  onOpenInvitation: (match: MatchData) => void
}

function presenceLabel(status: PublicPlayer['presenceStatus']) {
  if (status === 'online') return 'En ligne'
  if (status === 'away') return 'Absent'
  return 'Hors ligne'
}

export function MultiplayerLobby({
  action,
  friends,
  invitations,
  onDeclineInvitation,
  onInvite,
  onNewChallenge,
  onOpenInvitation,
}: MultiplayerLobbyProps) {
  const onlineFriends = friends.filter((friend) => friend.presenceStatus === 'online').length

  return (
    <div className="multiplayer-lobby-grid">
      <article className="card multiplayer-lobby-card multiplayer-arena-hub">
        <div className="multiplayer-lobby-title-row">
          <div>
            <span className="eyebrow">Arène</span>
            <h1>À qui le tour&nbsp;?</h1>
          </div>
          <button
            className="primary-button"
            type="button"
            aria-label="Commencer un nouveau défi"
            onClick={() => onNewChallenge()}
          >
            <span aria-hidden="true">+</span>
            Nouveau défi
          </button>
        </div>

        <div className="multiplayer-lobby-pulse" aria-label="Activité de vos amis">
          <span><i className="presence-dot online" aria-hidden="true" />{onlineFriends} en ligne</span>
          <span><strong>{friends.length}</strong> amis</span>
          <span><strong>{invitations.length}</strong> invitation{invitations.length > 1 ? 's' : ''}</span>
        </div>

        <div className="multiplayer-direct-challenges" aria-label="Défier un ami">
          <div className="multiplayer-direct-heading">
            <strong>Choisir un adversaire</strong>
            <span>{friends.length}</span>
          </div>
          {friends.length ? (
            <div className="multiplayer-direct-list">
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  disabled={action === `invite:${friend.id}`}
                  onClick={() => onInvite(friend)}
                >
                  <span className="multiplayer-direct-avatar-shell">
                    {friend.avatarUrl ? (
                      <img className="multiplayer-direct-avatar" src={friend.avatarUrl} alt="" />
                    ) : (
                      <span className="multiplayer-direct-avatar initials">{playerInitials(friend)}</span>
                    )}
                    <i className={`presence-dot ${friend.presenceStatus}`} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{friend.name}</strong>
                    <em>{friend.username ? `@${friend.username}` : presenceLabel(friend.presenceStatus)}</em>
                  </span>
                  <small>{action === `invite:${friend.id}` ? 'Envoi…' : 'Défier'}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Ajoutez un ami pour commencer un défi.</p>
          )}
        </div>
      </article>

      <article className={`card multiplayer-challenge-list ${invitations.length ? 'has-invitations' : 'is-empty'}`}>
        <div className="multiplayer-room-state">
          <div>
            <span className="eyebrow">Invitations</span>
            <strong>{invitations.length ? 'À vous de jouer' : 'Rien en attente'}</strong>
          </div>
          <span className="multiplayer-inbox-count">{invitations.length}</span>
        </div>
        {invitations.length ? (
          <div className="multiplayer-invitation-stack">
            {invitations.map((match) => (
              <div key={match.id} className="multiplayer-invitation-item">
                <button className="multiplayer-invitation-open" type="button" onClick={() => onOpenInvitation(match)}>
                  <span className="multiplayer-invitation-avatar" aria-hidden="true">{playerInitials(match.createdBy)}</span>
                  <span>
                    <strong>{match.createdBy.name}</strong>
                    <small>{matchSetupSummary(match)}</small>
                  </span>
                  <em>Ouvrir</em>
                </button>
                <button
                  className="multiplayer-invitation-decline"
                  type="button"
                  disabled={action === `decline:${match.id}`}
                  onClick={() => onDeclineInvitation(match)}
                >
                  Refuser
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="multiplayer-inbox-empty" aria-hidden="true">
            <span>VS</span>
            <i />
            <span>?</span>
          </div>
        )}
      </article>
    </div>
  )
}
