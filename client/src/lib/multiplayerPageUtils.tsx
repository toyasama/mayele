import type { RealtimeMatchProgressPayload } from '../hooks/useRealtimeEvents'
import { ApiRequestError, type MatchData, type PublicPlayer } from './api'
import { LEVEL_LABELS, type AnswerResult, type GameLevel } from './game'
import { isVisibleRoomParticipantStatus } from './multiplayerRoom'
import type { RoomConfig } from './multiplayerConfig'
import { calculateSessionScorePoints } from './scoring'

export const CONFIG_SYNC_ERROR = 'Synchronisation du salon impossible.'

const MATCH_STATUS_ORDER: Record<string, number> = {
  pending: 10,
  accepted: 20,
  ready: 30,
  in_progress: 40,
  completed: 50,
  cancelled: 50,
  expired: 50,
}

export type ConfigDraft = {
  matchId: string
  config: RoomConfig
}

export type PendingTempoAnswer = {
  questionIndex: number
  userAnswer: number | null
  responseTimeMs: number
} | null

export function playerInitials(player: Pick<PublicPlayer, 'name' | 'username'>) {
  const source = player.name || player.username || 'Joueur'
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MJ'
}

export function roomStatusLabel(match: MatchData | null, hasSelectedOpponent: boolean) {
  if (!match) {
    return hasSelectedOpponent ? 'Invitation a envoyer' : 'Nouveau salon'
  }

  switch (match.status) {
    case 'pending':
      return 'Invitation envoyee'
    case 'accepted':
      return 'Salon ouvert'
    case 'ready':
      return 'Configuration proposee'
    case 'in_progress':
      return 'Defi lance'
    case 'completed':
      return 'Defi termine'
    default:
      return `Salon ${match.status}`
  }
}

export function playerCard(
  player: Pick<PublicPlayer, 'name' | 'username' | 'avatarUrl'> | null,
  label: string,
  active = false,
  statusText?: string,
  participant?: MatchData['participants'][number] | null,
  options?: { id?: string },
) {
  const showMasterBadge = active && label !== 'Maitre du salon'
  const roomStats = participant?.challengeStats.room
  const cardClassName = [
    'card',
    'multiplayer-player-card',
    active ? 'is-room-master' : '',
    showMasterBadge ? 'has-hand' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClassName} id={options?.id}>
      <div className="multiplayer-player-main">
        <span className="eyebrow">{label}</span>
        {player ? (
          <>
            {player.avatarUrl ? <img className="multiplayer-avatar" src={player.avatarUrl} alt="" /> : <span className="multiplayer-avatar initials">{playerInitials(player)}</span>}
            <strong>{player.name}</strong>
            <span>{player.username ? `@${player.username}` : 'Profil Mayele'}</span>
            {statusText ? <small className="multiplayer-player-status">{statusText}</small> : null}
          </>
        ) : (
          <>
            <span className="multiplayer-avatar empty-slot">+</span>
            <strong>En attente</strong>
            <span>Invitez un ami dans le salon.</span>
            {statusText ? <small className="multiplayer-player-status">{statusText}</small> : null}
          </>
        )}
      </div>
      {roomStats ? (
        <div className="multiplayer-player-room-stats" aria-label="Bilan du salon">
          <span>
            <strong>{roomStats.wins}</strong>
            G
          </span>
          <span>
            <strong>{roomStats.losses}</strong>
            P
          </span>
          <span>
            <strong>{roomStats.draws}</strong>
            N
          </span>
        </div>
      ) : null}
    </article>
  )
}

export function matchSetupSummary(match: MatchData) {
  if (!match.game || !match.level) {
    return ''
  }

  const modeLabel = match.challengeMode === 'tempo' ? 'Tempo' : 'Sprint'
  const levelLabel = LEVEL_LABELS[match.level as GameLevel] ?? 'Niveau a choisir'

  return `${modeLabel} - ${levelLabel}`
}

export function isVisibleRoomParticipant(status: string | undefined) {
  return isVisibleRoomParticipantStatus(status)
}

export function isParticipantInRoom(status: string | undefined) {
  return status === 'accepted' || status === 'ready' || status === 'playing'
}

export function participantStatusLabel(participant: MatchData['participants'][number] | null | undefined) {
  switch (participant?.status) {
    case 'invited':
      return 'Invitation envoyee'
    case 'accepted':
    case 'ready':
      if (participant.player.presenceStatus === 'away' || participant.player.presenceStatus === 'offline') {
        return 'Absent temporairement'
      }

      if (participant.player.presenceStatus === 'busy') {
        return 'Occupe'
      }

      return 'Dans le salon'
    case 'playing':
      return 'En jeu'
    case 'submitting':
      return 'Validation'
    case 'completed':
      return 'Termine'
    case 'declined':
      return 'A refuse'
    case 'disconnected':
      return 'Hors salon'
    default:
      return ''
  }
}

export function computeBestStreak(answers: AnswerResult[]) {
  let current = 0
  let best = 0

  for (const answer of answers) {
    current = answer.isCorrect ? current + 1 : 0
    best = Math.max(best, current)
  }

  return best
}

export function computeCurrentStreak(answers: AnswerResult[]) {
  let streak = 0

  for (let index = answers.length - 1; index >= 0; index -= 1) {
    if (!answers[index].isCorrect) {
      break
    }

    streak += 1
  }

  return streak
}

export function participantProgressFromAnswers(level: GameLevel | null, answers: AnswerResult[]): RealtimeMatchProgressPayload {
  const totalQuestions = answers.length
  const correctAnswers = answers.filter((answer) => answer.isCorrect).length

  return {
    score: totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0,
    scorePoints: level ? calculateSessionScorePoints(level, answers) : 0,
    correctAnswers,
    totalQuestions,
    totalResponseTimeMs: answers.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
    bestStreak: computeBestStreak(answers),
  }
}

export function isStaleRoomError(error: unknown) {
  return error instanceof ApiRequestError && (
    error.code === 'match_not_found' ||
    error.code === 'match_not_participant' ||
    error.code === 'match_not_owned' ||
    error.code === 'match_host_inactive' ||
    error.code === 'match_not_pending' ||
    error.code === 'match_not_accepted' ||
    error.code === 'match_not_ready' ||
    error.code === 'participant_not_invited'
  )
}

export function isTransientAuthError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.status === 401 || error.code === 'unauthorized' || error.code === 'auth_pending'
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return message.includes('connexion requise') || message.includes('authentification requise') || message.includes('session en cours')
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function matchStatusOrder(status: string) {
  return MATCH_STATUS_ORDER[status] ?? 0
}

export function isOlderMatchSnapshot(current: MatchData | null | undefined, next: MatchData) {
  if (!current || current.id !== next.id) {
    return false
  }

  const currentStatusOrder = matchStatusOrder(current.status)
  const nextStatusOrder = matchStatusOrder(next.status)

  if (
    current.status === 'ready' &&
    next.status === 'accepted' &&
    next.configVersion > current.configVersion
  ) {
    return false
  }

  if (nextStatusOrder < currentStatusOrder) {
    return true
  }

  if (next.configVersion < current.configVersion) {
    return true
  }

  if (
    nextStatusOrder === currentStatusOrder &&
    current.status === 'in_progress' &&
    next.status === 'in_progress' &&
    current.challengeMode === 'tempo' &&
    next.challengeMode === 'tempo' &&
    typeof current.tempoQuestionIndex === 'number' &&
    typeof next.tempoQuestionIndex === 'number' &&
    next.tempoQuestionIndex < current.tempoQuestionIndex
  ) {
    return true
  }

  return false
}

export function mergeMonotonicMatchFields(current: MatchData | null | undefined, next: MatchData) {
  if (!current || current.id !== next.id) {
    return next
  }

  const currentParticipantsById = new Map(current.participants.map((participant) => [participant.id, participant]))
  const shouldKeepCurrentTempoIndex =
    current.status === 'in_progress' &&
    next.status === 'in_progress' &&
    current.challengeMode === 'tempo' &&
    next.challengeMode === 'tempo' &&
    typeof current.tempoQuestionIndex === 'number' &&
    (typeof next.tempoQuestionIndex !== 'number' || next.tempoQuestionIndex < current.tempoQuestionIndex)

  return {
    ...next,
    tempoQuestionIndex: shouldKeepCurrentTempoIndex ? current.tempoQuestionIndex : next.tempoQuestionIndex,
    tempoQuestionStartedAt: shouldKeepCurrentTempoIndex ? current.tempoQuestionStartedAt : next.tempoQuestionStartedAt,
    participants: next.participants.map((participant) => {
      const currentParticipant = currentParticipantsById.get(participant.id)

      if (!currentParticipant) {
        return participant
      }

      return {
        ...participant,
        rematchRequestedAt: participant.rematchRequestedAt ?? currentParticipant.rematchRequestedAt,
        resultDismissedAt: participant.resultDismissedAt ?? currentParticipant.resultDismissedAt,
        forfeitedAt: participant.forfeitedAt ?? currentParticipant.forfeitedAt,
      }
    }),
  }
}
