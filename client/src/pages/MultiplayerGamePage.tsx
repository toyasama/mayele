import { type FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChallengeArenaScreen, type ChallengeMetric } from '../components/ChallengeExperience'
import { LaunchActionButton } from '../components/LaunchActionButton'
import { PlayModeNavigationDialog } from '../components/PlayModeNavigationDialog'
import { PlayModeTabs, type PlayModePath } from '../components/PlayModeTabs'
import { useAuth } from '../context/auth'
import { MatchResultStage } from '../features/multiplayer/MatchResultStage'
import { MultiplayerLobby } from '../features/multiplayer/MultiplayerLobby'
import { MultiplayerRoomConfigurator } from '../features/multiplayer/MultiplayerRoomConfigurator'
import { useProfile } from '../context/profile-context'
import {
  useRealtimeEvents,
  type RealtimeMatchProgressPayload,
  type RealtimeMatchResultPayload,
  type MatchRealtimePayload,
  type RealtimeConfigPayload,
  type RealtimeTempoAnswerPayload,
  type RealtimeSprintAnswerPayload,
  type MatchTempoAnswerRecordedPayload,
  type PresenceRealtimePayload,
  type RoomRealtimeEvent,
  type RoomSnapshotPayload,
} from '../hooks/useRealtimeEvents'
import { api, ApiRequestError, type ChallengeMode, type MatchData, type PublicPlayer } from '../lib/api'
import { clearCachePrefix, DASHBOARD_CACHE_PREFIX } from '../lib/appCache'
import { parseAnswerInput } from '../lib/answerInput'
import { criticalRemainingSeconds } from '../lib/challengeTiming'
import { LEVEL_LABELS, calculateElapsedSessionSeconds, calculateRemainingSessionSeconds, type AnswerResult } from '../lib/game'
import { generateMatchQuestion } from '../lib/matchQuestions'
import '../styles/routes/multiplayer.css'
import {
  completeConfigPayload,
  DEFAULT_ROOM_CONFIG,
  isCompleteConfig,
  matchToConfig,
  normalizeRoomConfig,
  roomConfigPayload,
  type RoomConfig,
} from '../lib/multiplayerConfig'
import {
  isActiveRoomMatch,
  isDisplayableRoomMatch,
  selectRoomMatch,
} from '../lib/multiplayerRoom'
import {
  initialMultiplayerRoomState,
  lastSeenEventIdForMatch,
  multiplayerRoomReducer,
} from '../lib/multiplayerRoomReducer'
import { calculateSessionScorePoints } from '../lib/scoring'
import {
  CONFIG_SYNC_ERROR,
  computeBestStreak,
  computeCurrentStreak,
  errorMessage,
  isOlderMatchSnapshot,
  isParticipantInRoom,
  isStaleRoomError,
  isTransientAuthError,
  isVisibleRoomParticipant,
  mergeMonotonicMatchFields,
  participantStatusLabel,
  playerCard,
  roomStatusLabel,
  type ConfigDraft,
  type PendingTempoAnswer,
} from '../lib/multiplayerPageUtils'

type MobileRoomView = 'primary' | 'players'

const MATCH_HYDRATION_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000]

function waitForMatchHydrationRetry(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
}

export function MultiplayerGamePage() {
  const { getToken, isAuthenticated } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedMatchId = searchParams.get('match')
  const [friends, setFriends] = useState<PublicPlayer[]>([])
  const [matches, setMatches] = useState<MatchData[]>([])
  const [activeMatch, setActiveMatch] = useState<MatchData | null>(null)
  const [orderedRoomState, dispatchOrderedRoomState] = useReducer(multiplayerRoomReducer, initialMultiplayerRoomState)
  const orderedRoomStateRef = useRef(orderedRoomState)
  const joinedRealtimeRoomRef = useRef<string | null>(null)
  const roomOverviewRequestRef = useRef<Promise<{ friends: PublicPlayer[]; matches: MatchData[] }> | null>(null)
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_ROOM_CONFIG)
  const [roomDraftOpen, setRoomDraftOpen] = useState(Boolean(selectedMatchId))
  const [selectedOpponent, setSelectedOpponent] = useState<PublicPlayer | null>(null)
  const [friendPickerOpen, setFriendPickerOpen] = useState(false)
  const [mobileRoomView, setMobileRoomView] = useState<MobileRoomView>('primary')
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [roomSyncError, setRoomSyncError] = useState('')
  const [pendingModePath, setPendingModePath] = useState<PlayModePath | null>(null)
  const [answer, setAnswer] = useState('')
  const [localScore, setLocalScore] = useState({ correct: 0, total: 0 })
  const [matchAnswers, setMatchAnswers] = useState<AnswerResult[]>([])
  const [question, setQuestion] = useState(() => generateMatchQuestion('draft', 0, 'addition', 'debutant'))
  const [tempoActiveQuestionIndex, setTempoActiveQuestionIndex] = useState(0)
  const [tempoRemainingSeconds, setTempoRemainingSeconds] = useState(DEFAULT_ROOM_CONFIG.perQuestionTimeLimitSeconds)
  const [tempoPendingAnswer, setTempoPendingAnswer] = useState<PendingTempoAnswer>(null)
  const [sprintRemainingSeconds, setSprintRemainingSeconds] = useState(DEFAULT_ROOM_CONFIG.durationSeconds)
  const roomActionInFlightRef = useRef<string | null>(null)
  const questionRef = useRef(question)
  const questionStartedAtRef = useRef(Date.now())
  const matchStartedAtRef = useRef(Date.now())
  const tempoQuestionStartedAtByIndexRef = useRef(new Map<number, number>())
  const completedTempoQuestionIndexesRef = useRef(new Set<number>())
  const activeRunKeyRef = useRef<string | null>(null)
  const serverTimeOffsetMsRef = useRef(0)
  const matchAnswersRef = useRef<AnswerResult[]>([])
  const tempoActiveQuestionIndexRef = useRef(0)
  const tempoPendingAnswerRef = useRef<PendingTempoAnswer>(null)
  const answerInputRef = useRef<HTMLInputElement | null>(null)
  const resultSubmittedRef = useRef<string | null>(null)
  const heartbeatTargetIdRef = useRef<string | null>(null)
  const heartbeatInFlightMatchIdRef = useRef<string | null>(null)
  const configFlushTokenRef = useRef(0)
  const configSyncInFlightRef = useRef(false)
  const configSyncPromiseRef = useRef<Promise<void> | null>(null)
  const flushConfigSyncRef = useRef<() => void>(() => {})
  const createMatchInvitationRealtimeRef = useRef<((payload: {
    opponentPlayerId: string
    game?: string
    level?: string
    practiceSkill?: RealtimeConfigPayload['practiceSkill']
    challengeMode?: ChallengeMode
    durationSeconds?: number
    questionCount?: number
    perQuestionTimeLimitSeconds?: number
  }) => Promise<{ match: MatchData }>) | null>(null)
  const updateMatchConfigRealtimeRef = useRef<((matchId: string, config: RealtimeConfigPayload) => Promise<{ match: MatchData }>) | null>(null)
  const acceptMatchInvitationRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const declineMatchInvitationRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const proposeMatchRealtimeRef = useRef<((matchId: string, config?: RealtimeConfigPayload) => Promise<{ match: MatchData }>) | null>(null)
  const acceptMatchProposalRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const declineMatchProposalRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const requestMatchRematchRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const forfeitMatchRealtimeRef = useRef<((matchId: string, progress?: RealtimeMatchProgressPayload) => Promise<{ match: MatchData }>) | null>(null)
  const leaveMatchRealtimeRef = useRef<((matchId: string) => Promise<{ match: MatchData }>) | null>(null)
  const submitTempoAnswerRealtimeRef = useRef<((matchId: string, answer: RealtimeTempoAnswerPayload) => Promise<{
    match: MatchData
    progress: {
      questionIndex: number
      answeredCount: number
      expectedAnswerCount: number
      complete: boolean
      nextQuestionIndex: number
    }
  }>) | null>(null)
  const submitSprintAnswerRealtimeRef = useRef<((matchId: string, answer: RealtimeSprintAnswerPayload) => Promise<{ match: MatchData }>) | null>(null)
  const sprintAnswerSyncPromisesRef = useRef(new Set<Promise<unknown>>())
  const submitMatchResultRealtimeRef = useRef<((matchId: string, result: RealtimeMatchResultPayload) => Promise<{ match: MatchData }>) | null>(null)
  const completeTempoQuestionRef = useRef<(questionIndex: number, nextQuestionStartedAtMs?: number) => void>(() => {})
  const activeMatchRef = useRef<MatchData | null>(null)
  const leavingCompletedMatchRef = useRef<string | null>(null)
  const dismissedMatchIdsRef = useRef(new Set<string>())
  const notifiedInviteMatchIdsRef = useRef(new Set<string>())
  const configDraftRef = useRef<ConfigDraft | null>(null)
  const submittedConfigRef = useRef<ConfigDraft | null>(null)
  const configRef = useRef<RoomConfig>(DEFAULT_ROOM_CONFIG)
  const preferredMatchIdRef = useRef<string | null>(selectedMatchId)
  const selectedMatchIdRef = useRef<string | null>(selectedMatchId)
  const roomRevisionRef = useRef<Record<string, number>>({})

  const currentPlayer = profile
    ? {
        id: profile.id,
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        totalXp: 0,
        presenceStatus: profile.presenceStatus,
        presenceUpdatedAt: profile.presenceUpdatedAt,
      }
    : null
  const roomRealtimeAuthenticated = Boolean(isAuthenticated && profile?.profileComplete)

  const incomingInvitations = useMemo(() => {
    if (!profile) {
      return []
    }

    return matches.filter(
      (match) =>
        isActiveRoomMatch(match) &&
        match.status === 'pending' &&
        match.createdBy.id !== profile.id &&
        match.participants.some((participant) => participant.player.id === profile.id && participant.status === 'invited'),
    )
  }, [matches, profile])

  const displayedMatch = activeMatch
  const isRoomMaster = Boolean(profile && (!displayedMatch || displayedMatch.createdBy.id === profile.id))
  const displayedMatchId = displayedMatch?.id ?? null
  const displayedMatchHostId = displayedMatch?.createdBy.id ?? null
  const myParticipant = useMemo(() => {
    if (!displayedMatch || !profile) {
      return null
    }

    return displayedMatch.participants.find((participant) => participant.player.id === profile.id) ?? null
  }, [displayedMatch, profile])
  const opponentParticipant = useMemo(() => {
    if (!displayedMatch || !profile) {
      return null
    }

    return displayedMatch.participants.find((participant) => participant.player.id !== profile.id && isVisibleRoomParticipant(participant.status)) ?? null
  }, [displayedMatch, profile])
  const inactiveOpponentParticipant = useMemo(() => {
    if (!displayedMatch || !profile || opponentParticipant) {
      return null
    }

    return displayedMatch.participants.find((participant) => participant.player.id !== profile.id && participant.status !== 'disconnected' && !isVisibleRoomParticipant(participant.status)) ?? null
  }, [displayedMatch, opponentParticipant, profile])
  const opponent = displayedMatch ? opponentParticipant?.player ?? null : selectedOpponent
  const roomStatus = displayedMatch?.status ?? 'draft'
  const opponentInRoom = isParticipantInRoom(opponentParticipant?.status)
  const canPropose = Boolean(displayedMatch && isRoomMaster && displayedMatch.status === 'accepted' && opponentInRoom && isCompleteConfig(config))
  const canTransferRoomMaster = Boolean(
    displayedMatch &&
    isRoomMaster &&
    (displayedMatch.status === 'accepted' || displayedMatch.status === 'ready') &&
    opponentInRoom,
  )
  const canSendInvitation = Boolean(!displayedMatch && isRoomMaster && selectedOpponent)
  const sendingDraftInvitation = Boolean(selectedOpponent && action === `invite:${selectedOpponent.id}`)
  const proposalPending = displayedMatch?.status === 'ready'
  const editableConfig = config
  const authoritativeConfig = config
  const controlsDisabled = Boolean(
    !isRoomMaster
    || proposalPending
    || displayedMatch?.status === 'in_progress'
    || (displayedMatch && action === `propose:${displayedMatch.id}`),
  )
  const leaveRoomLabel = displayedMatch
    ? isRoomMaster
      ? displayedMatch.status === 'pending'
        ? "Annuler l'invitation"
        : 'Fermer le salon'
      : displayedMatch.status === 'pending'
        ? 'Refuser le defi'
        : 'Quitter le salon'
    : ''
  const opponentIsRoomMaster = Boolean(displayedMatch && displayedMatch.createdBy.id === opponent?.id)
  const opponentLabel = opponentIsRoomMaster ? 'Maitre du salon' : 'Adversaire'
  const opponentStatus = displayedMatch
    ? opponentParticipant
      ? participantStatusLabel(opponentParticipant)
      : inactiveOpponentParticipant
        ? participantStatusLabel(inactiveOpponentParticipant)
        : 'Aucun adversaire'
    : selectedOpponent
      ? 'Defi non envoye'
      : ''
  const myResult = myParticipant?.status === 'completed' ? myParticipant : null
  const opponentResult = opponentParticipant?.status === 'completed' ? opponentParticipant : null
  const tempoQuestionTotal = config.challengeMode === 'tempo' ? (displayedMatch?.questionCount ?? config.questionCount) : 0
  const localTempoRunComplete = Boolean(
    displayedMatch?.status === 'in_progress' &&
    config.challengeMode === 'tempo' &&
    tempoQuestionTotal > 0 &&
    matchAnswers.length >= tempoQuestionTotal &&
    !error,
  )
  const myActiveMatchFinished = Boolean(
    displayedMatch?.status === 'in_progress' &&
    (
      myParticipant?.status === 'submitting' ||
      myParticipant?.status === 'completed' ||
      action === `result:${displayedMatch.id}` ||
      localTempoRunComplete
    ),
  )
  const myRematchRequested = Boolean(myParticipant?.rematchRequestedAt)
  const opponentRematchRequested = Boolean(opponentParticipant?.rematchRequestedAt)
  const myProfileStatus = myRematchRequested ? 'Relance demandee' : undefined
  const opponentProfileStatus = opponentRematchRequested ? 'Relance demandee' : opponentStatus
  const opponentDismissedResult = Boolean(opponentParticipant?.resultDismissedAt)
  const myForfeited = Boolean(myParticipant?.forfeitedAt)
  const opponentForfeited = Boolean(opponentParticipant?.forfeitedAt)
  const matchWinnerPlayerId = displayedMatch?.winnerPlayerId ?? null
  const myResultOutcome = matchWinnerPlayerId && myParticipant?.player.id
    ? matchWinnerPlayerId === myParticipant.player.id
      ? 'winner'
      : 'loser'
    : 'neutral'
  const opponentResultOutcome = matchWinnerPlayerId && opponentParticipant?.player.id
    ? matchWinnerPlayerId === opponentParticipant.player.id
      ? 'winner'
      : 'loser'
    : 'neutral'
  const multiplayerScorePoints = config.level ? calculateSessionScorePoints(config.level, matchAnswers) : 0
  const multiplayerCurrentStreak = computeCurrentStreak(matchAnswers)
  const multiplayerLastAnswer = matchAnswers.at(-1)
  const sprintDurationSeconds = displayedMatch?.durationSeconds ?? config.durationSeconds
  const tempoQuestionDurationSeconds = displayedMatch?.perQuestionTimeLimitSeconds ?? config.perQuestionTimeLimitSeconds
  const activeTimerSeconds =
    displayedMatch?.status === 'in_progress'
      ? config.challengeMode === 'sprint'
        ? sprintRemainingSeconds
        : config.challengeMode === 'tempo'
          ? tempoRemainingSeconds
          : null
      : null
  const activeTimerTotalSeconds = config.challengeMode === 'sprint' ? sprintDurationSeconds : tempoQuestionDurationSeconds
  const activeTimerElapsedSeconds = activeTimerSeconds === null ? 0 : Math.max(0, activeTimerTotalSeconds - activeTimerSeconds)
  const activeTimerProgress = activeTimerTotalSeconds > 0 ? (activeTimerElapsedSeconds / activeTimerTotalSeconds) * 100 : 0
  const tempoQuestionProgressLabel = tempoQuestionTotal > 0
    ? `Question ${Math.min(tempoActiveQuestionIndex + 1, tempoQuestionTotal)}/${tempoQuestionTotal}`
    : undefined
  const multiplayerAccuracy = localScore.total ? Math.round((localScore.correct / localScore.total) * 100) : 0
  const multiplayerMetrics: ChallengeMetric[] = [
    { label: 'Score', value: multiplayerScorePoints },
    { label: 'Serie', value: multiplayerCurrentStreak },
    { label: 'Precision', value: `${multiplayerAccuracy}%` },
  ]
  const roomStatusText = displayedMatch?.status === 'accepted' && isRoomMaster && !opponent
    ? "En attente d'un adversaire"
    : roomStatusLabel(displayedMatch, Boolean(selectedOpponent))
  const primaryRoomActionDisabled = displayedMatch
    ? !isRoomMaster || Boolean(opponent && (!canPropose || action === `propose:${displayedMatch.id}`))
    : sendingDraftInvitation
  const primaryRoomActionLabel = displayedMatch
    ? !isRoomMaster
      ? 'En attente du maitre du salon'
      : displayedMatch.status === 'pending'
        ? "En attente de l'adversaire"
        : displayedMatch.status === 'ready'
          ? 'En attente de validation'
          : !opponent
            ? 'Choisir un ami'
            : canPropose
              ? 'Proposer le defi'
              : 'Choisissez le mode et le niveau'
    : sendingDraftInvitation
      ? 'Envoi...'
      : canSendInvitation
        ? "Envoyer l'invitation"
        : 'Choisir un ami'
  const primaryRoomActionIntent = displayedMatch
    ? !isRoomMaster
      ? 'wait'
      : !opponent
        ? 'invite'
        : canPropose
          ? 'propose'
          : 'configure'
    : selectedOpponent
      ? 'send'
      : 'invite'

  const showToast = useCallback((title: string) => {
    window.dispatchEvent(new CustomEvent('mayele:toast', { detail: { title, variant: 'success' } }))
  }, [])

  const beginRoomAction = useCallback((actionKey: string) => {
    if (roomActionInFlightRef.current) {
      return false
    }

    roomActionInFlightRef.current = actionKey
    setAction(actionKey)
    setError('')
    return true
  }, [])

  const finishRoomAction = useCallback((actionKey: string) => {
    if (roomActionInFlightRef.current !== actionKey) {
      return
    }

    roomActionInFlightRef.current = null
    setAction('')
  }, [])

  const clearSupersededRoomAction = useCallback((match: MatchData) => {
    const actionKey = roomActionInFlightRef.current

    if (!actionKey) {
      return
    }

    const separatorIndex = actionKey.lastIndexOf(':')
    const actionName = separatorIndex > 0 ? actionKey.slice(0, separatorIndex) : actionKey
    const actionMatchId = separatorIndex > 0 ? actionKey.slice(separatorIndex + 1) : ''

    if (actionMatchId !== match.id) {
      return
    }

    const participant = profile?.id
      ? match.participants.find((item) => item.player.id === profile.id)
      : null
    const superseded =
      (actionName === 'accept' && (match.status !== 'pending' || participant?.status !== 'invited')) ||
      (actionName === 'propose' && match.status !== 'accepted') ||
      (actionName === 'accept-proposal' && match.status !== 'ready') ||
      (actionName === 'stop' && match.status !== 'in_progress') ||
      (actionName === 'rematch' && (match.status !== 'completed' || Boolean(participant?.rematchRequestedAt)))

    if (!superseded) {
      return
    }

    roomActionInFlightRef.current = null
    setAction('')
  }, [profile?.id])

  const applyConfig = useCallback((nextConfig: RoomConfig) => {
    const normalizedConfig = normalizeRoomConfig(nextConfig)
    configRef.current = normalizedConfig
    setConfig(normalizedConfig)
  }, [])

  const serverNowMs = useCallback(() => Date.now() + serverTimeOffsetMsRef.current, [])

  const focusAnswerInput = useCallback(() => {
    answerInputRef.current?.focus({ preventScroll: true })
  }, [])

  const setTempoQuestionIndex = useCallback((questionIndex: number) => {
    const nextQuestionIndex = Math.max(0, questionIndex)
    tempoActiveQuestionIndexRef.current = nextQuestionIndex
    setTempoActiveQuestionIndex(nextQuestionIndex)
  }, [])

  const applyMatchSnapshot = useCallback((match: MatchData): MatchData => {
    const current = activeMatchRef.current

    if (isOlderMatchSnapshot(current, match)) {
      return current ?? match
    }

    const mergedMatch = mergeMonotonicMatchFields(current, match)

    serverTimeOffsetMsRef.current = new Date(mergedMatch.serverNow).getTime() - Date.now()
    clearSupersededRoomAction(mergedMatch)
    if (mergedMatch.status === 'in_progress' && mergedMatch.challengeMode === 'sprint') {
      const serverNow = new Date(mergedMatch.serverNow).getTime()
      const startedAt = mergedMatch.startedAt ? new Date(mergedMatch.startedAt).getTime() : serverNow
      const durationSeconds = Math.max(1, mergedMatch.durationSeconds || DEFAULT_ROOM_CONFIG.durationSeconds)
      const endsAt = mergedMatch.endsAt ? new Date(mergedMatch.endsAt).getTime() : startedAt + durationSeconds * 1000

      setSprintRemainingSeconds(calculateRemainingSessionSeconds(endsAt, serverNow))
    }
    if (
      mergedMatch.status === 'in_progress' &&
      mergedMatch.challengeMode === 'tempo' &&
      typeof mergedMatch.tempoQuestionIndex === 'number' &&
      mergedMatch.tempoQuestionIndex >= tempoActiveQuestionIndexRef.current
    ) {
      setTempoQuestionIndex(mergedMatch.tempoQuestionIndex)

      if (mergedMatch.tempoQuestionStartedAt) {
        tempoQuestionStartedAtByIndexRef.current.set(mergedMatch.tempoQuestionIndex, new Date(mergedMatch.tempoQuestionStartedAt).getTime())
      }
    }
    activeMatchRef.current = mergedMatch
    setActiveMatch(mergedMatch)
    return mergedMatch
  }, [clearSupersededRoomAction, setTempoQuestionIndex])

  const localPendingConfig = useCallback((matchId: string) => {
    if (configDraftRef.current?.matchId === matchId) {
      return configDraftRef.current.config
    }

    if (submittedConfigRef.current?.matchId === matchId) {
      return submittedConfigRef.current.config
    }

    return null
  }, [])

  const cancelQueuedConfigFlush = useCallback(() => {
    configFlushTokenRef.current += 1
  }, [])

  const resetToMultiplayerHome = useCallback(() => {
    cancelQueuedConfigFlush()
    configDraftRef.current = null
    submittedConfigRef.current = null
    configSyncInFlightRef.current = false
    roomActionInFlightRef.current = null
    matchAnswersRef.current = []
    tempoQuestionStartedAtByIndexRef.current.clear()
    completedTempoQuestionIndexesRef.current.clear()
    tempoActiveQuestionIndexRef.current = 0
    activeRunKeyRef.current = null
    tempoPendingAnswerRef.current = null
    leavingCompletedMatchRef.current = null
    resultSubmittedRef.current = null
    preferredMatchIdRef.current = null
    selectedMatchIdRef.current = null
    activeMatchRef.current = null
    setActiveMatch(null)
    applyConfig(DEFAULT_ROOM_CONFIG)
    setSelectedOpponent(null)
    setRoomDraftOpen(false)
    setFriendPickerOpen(false)
    setSearchParams({})
    setError('')
    setRoomSyncError('')
    setAction('')
    setAnswer('')
    setLocalScore({ correct: 0, total: 0 })
    setMatchAnswers([])
    setTempoActiveQuestionIndex(0)
    setTempoPendingAnswer(null)
    setTempoRemainingSeconds(DEFAULT_ROOM_CONFIG.perQuestionTimeLimitSeconds)
    setSprintRemainingSeconds(DEFAULT_ROOM_CONFIG.durationSeconds)
  }, [applyConfig, cancelQueuedConfigFlush, setSearchParams])

  const queueConfigFlush = useCallback(() => {
    const token = configFlushTokenRef.current + 1
    configFlushTokenRef.current = token
    window.queueMicrotask(() => {
      if (configFlushTokenRef.current !== token) {
        return
      }

      flushConfigSyncRef.current()
    })
  }, [])

  const reportBackgroundRoomError = useCallback((caughtError: unknown, fallback: string) => {
    if (isTransientAuthError(caughtError)) {
      return
    }

    if (isStaleRoomError(caughtError)) {
      resetToMultiplayerHome()
      return
    }

    const message = caughtError instanceof ApiRequestError && caughtError.code === 'internal_error'
      ? fallback
      : errorMessage(caughtError, fallback)
    setRoomSyncError(message)
  }, [resetToMultiplayerHome])

  const loadRoomOverview = useCallback(() => {
    if (roomOverviewRequestRef.current) {
      return roomOverviewRequestRef.current
    }

    const request = api.getMatchRoomOverview(getToken)
    roomOverviewRequestRef.current = request
    const clearRequest = () => {
      if (roomOverviewRequestRef.current === request) {
        roomOverviewRequestRef.current = null
      }
    }
    void request.then(clearRequest, clearRequest)

    return request
  }, [getToken])

  const refreshMatchSnapshot = useCallback(async (matchId: string, syncConfig: boolean) => {
    const overview = await loadRoomOverview()
    const refreshedMatch = overview.matches.find((item) => item.id === matchId) ?? null

    if (!refreshedMatch) {
      resetToMultiplayerHome()
      return null
    }

    const appliedMatch = applyMatchSnapshot(refreshedMatch)
    const pendingConfig = localPendingConfig(appliedMatch.id)

    if (syncConfig && !pendingConfig) {
      applyConfig(matchToConfig(appliedMatch))
    }

    return appliedMatch
  }, [applyConfig, applyMatchSnapshot, loadRoomOverview, localPendingConfig, resetToMultiplayerHome])

  const flushConfigSync = useCallback(() => {
    cancelQueuedConfigFlush()

    if (configSyncInFlightRef.current) {
      return
    }

    const draft = configDraftRef.current
    const match = activeMatchRef.current

    if (!draft || !match || match.id !== draft.matchId) {
      return
    }

    configDraftRef.current = null
    submittedConfigRef.current = draft
    configSyncInFlightRef.current = true
    const configPayload = {
      ...roomConfigPayload(draft.config),
      expectedConfigVersion: match.configVersion,
    }
    const updateMatchConfig = updateMatchConfigRealtimeRef.current

    if (!updateMatchConfig) {
      configSyncInFlightRef.current = false
      configDraftRef.current = draft
      setError('Connexion temps reel du salon indisponible.')
      return
    }

    const syncPromise = updateMatchConfig(match.id, configPayload)
      .then((payload) => {
        if (submittedConfigRef.current?.matchId === payload.match.id) {
          submittedConfigRef.current = null
        }
        applyMatchSnapshot(payload.match)

        setError((current) => (current === CONFIG_SYNC_ERROR ? '' : current))
      })
      .catch((caughtError) => {
        if (isStaleRoomError(caughtError)) {
          resetToMultiplayerHome()
          return
        }

        if (caughtError instanceof ApiRequestError && caughtError.code === 'match_version_conflict') {
          configDraftRef.current ??= draft
          submittedConfigRef.current = null
          return refreshMatchSnapshot(match.id, false)
            .then(() => undefined)
            .catch((refreshError) => {
              reportBackgroundRoomError(refreshError, CONFIG_SYNC_ERROR)
            })
        }

        if (isTransientAuthError(caughtError)) {
          configDraftRef.current ??= draft
          submittedConfigRef.current = null
          return
        }

        setError(errorMessage(caughtError, 'Configuration impossible.'))
        configDraftRef.current = null
        submittedConfigRef.current = null
        void refreshMatchSnapshot(match.id, true).catch((refreshError) => {
          reportBackgroundRoomError(refreshError, CONFIG_SYNC_ERROR)
        })
      })
      .finally(() => {
        if (configSyncPromiseRef.current === syncPromise) {
          configSyncPromiseRef.current = null
        }
        configSyncInFlightRef.current = false
        if (configDraftRef.current) {
          queueConfigFlush()
        }
      })
    configSyncPromiseRef.current = syncPromise
  }, [applyMatchSnapshot, cancelQueuedConfigFlush, refreshMatchSnapshot, reportBackgroundRoomError, resetToMultiplayerHome, queueConfigFlush])

  useEffect(() => {
    flushConfigSyncRef.current = flushConfigSync
  }, [flushConfigSync])

  useEffect(() => {
    orderedRoomStateRef.current = orderedRoomState
  }, [orderedRoomState])

  useEffect(() => {
    activeMatchRef.current = activeMatch
  }, [activeMatch])

  useEffect(() => {
    selectedMatchIdRef.current = selectedMatchId
  }, [selectedMatchId])

  useEffect(() => {
    matchAnswersRef.current = matchAnswers
  }, [matchAnswers])

  useEffect(() => {
    questionRef.current = question
  }, [question])

  const syncRoomConfig = useCallback((match: MatchData, nextConfig: RoomConfig) => {
    activeMatchRef.current = activeMatchRef.current?.id === match.id ? activeMatchRef.current : match
    configDraftRef.current = { matchId: match.id, config: nextConfig }
    queueConfigFlush()
  }, [queueConfigFlush])

  const applyDisplayedMatch = useCallback((match: MatchData) => {
    const appliedMatch = applyMatchSnapshot(match)
    preferredMatchIdRef.current = appliedMatch.id
    const pendingMasterDraft = localPendingConfig(appliedMatch.id)

    if (!pendingMasterDraft) {
      applyConfig(matchToConfig(appliedMatch))
    }

    setRoomDraftOpen(true)
    setSelectedOpponent(appliedMatch.participants.find((participant) => participant.player.id !== profile?.id && isVisibleRoomParticipant(participant.status))?.player ?? null)

    if (appliedMatch.id !== selectedMatchIdRef.current) {
      selectedMatchIdRef.current = appliedMatch.id
      setSearchParams({ match: appliedMatch.id })
    }

    return appliedMatch
  }, [applyConfig, applyMatchSnapshot, localPendingConfig, profile?.id, setSearchParams])

  const applyRoomOverview = useCallback((overview: { friends: PublicPlayer[]; matches: MatchData[] }) => {
    const visibleMatches = overview.matches.filter((match) => !dismissedMatchIdsRef.current.has(match.id))
    const targetMatchId = selectedMatchId ?? selectedMatchIdRef.current ?? preferredMatchIdRef.current
    const nextDisplayed = selectRoomMatch(visibleMatches, profile?.id, targetMatchId)

    dispatchOrderedRoomState({ type: 'bootstrap', matches: visibleMatches, selectedMatchId: targetMatchId })
    setFriends(overview.friends)
    setMatches(visibleMatches)

    if (nextDisplayed) {
      applyDisplayedMatch(nextDisplayed)
      return nextDisplayed
    }

    return null
  }, [applyDisplayedMatch, profile?.id, selectedMatchId])

  const hydrateSelectedMatch = useCallback(async (matchId: string) => {
    for (const delayMs of MATCH_HYDRATION_RETRY_DELAYS_MS) {
      try {
        const { match } = await api.getMatch(getToken, matchId)

        if (dismissedMatchIdsRef.current.has(match.id)) {
          return false
        }

        dispatchOrderedRoomState({ type: 'match-upsert', match, selectedMatchId: matchId })
        setMatches((currentMatches) => {
          const currentSnapshot = currentMatches.find((item) => item.id === match.id)

          if (isOlderMatchSnapshot(currentSnapshot, match)) {
            return currentMatches
          }

          return [match, ...currentMatches.filter((item) => item.id !== match.id)]
        })
        applyDisplayedMatch(match)
        return true
      } catch (caughtError) {
        if (!(caughtError instanceof ApiRequestError) || caughtError.code !== 'match_not_found') {
          throw caughtError
        }
      }

      await waitForMatchHydrationRetry(delayMs)
    }

    return false
  }, [applyDisplayedMatch, getToken])

  useEffect(() => {
    if (!profile?.id) {
      return
    }

    const targetMatchId = selectedMatchId ?? selectedMatchIdRef.current ?? preferredMatchIdRef.current
    const nextDisplayed = selectRoomMatch(matches, profile.id, targetMatchId)

    if (!nextDisplayed) {
      return
    }

    if (activeMatchRef.current?.id !== nextDisplayed.id || activeMatchRef.current.configVersion < nextDisplayed.configVersion) {
      applyDisplayedMatch(nextDisplayed)
    }
  }, [applyDisplayedMatch, matches, profile?.id, selectedMatchId])

  const refreshRoomData = useCallback(async () => {
    if (!roomRealtimeAuthenticated) {
      return
    }

    const overview = await loadRoomOverview()
    setRoomSyncError('')
    const nextDisplayed = applyRoomOverview(overview)

    if (!nextDisplayed && (activeMatchRef.current || selectedMatchIdRef.current || preferredMatchIdRef.current)) {
      const requestedMatchId = selectedMatchIdRef.current ?? preferredMatchIdRef.current

      if (requestedMatchId && await hydrateSelectedMatch(requestedMatchId)) {
        return
      }

      const currentMatch = activeMatchRef.current

      if (currentMatch && (currentMatch.status === 'in_progress' || currentMatch.status === 'completed')) {
        return
      }

      resetToMultiplayerHome()
    }
  }, [applyRoomOverview, hydrateSelectedMatch, loadRoomOverview, roomRealtimeAuthenticated, resetToMultiplayerHome])

  const applyRealtimeMatchSnapshot = useCallback((match: MatchData, options: { recordLegacyEvent?: boolean } = {}) => {
    const currentMatch = activeMatchRef.current

    if (options.recordLegacyEvent !== false) {
      dispatchOrderedRoomState({ type: 'match-upsert', match, selectedMatchId: selectedMatchIdRef.current ?? preferredMatchIdRef.current })
    }

    if (isOlderMatchSnapshot(currentMatch, match)) {
      return true
    }

    if (dismissedMatchIdsRef.current.has(match.id)) {
      setMatches((currentMatches) => currentMatches.filter((item) => item.id !== match.id))

      if (currentMatch?.id === match.id || selectedMatchIdRef.current === match.id) {
        resetToMultiplayerHome()
      }

      return true
    }

    const isDisplayable = isDisplayableRoomMatch(match, profile?.id)
    const myRealtimeParticipant = profile?.id
      ? match.participants.find((participant) => participant.player.id === profile.id)
      : null

    if (
      profile?.id &&
      match.status === 'pending' &&
      match.createdBy.id !== profile.id &&
      myRealtimeParticipant?.status === 'invited' &&
      !notifiedInviteMatchIdsRef.current.has(match.id)
    ) {
      notifiedInviteMatchIdsRef.current.add(match.id)
      showToast(`${match.createdBy.name} vous a defie.`)
    }

    setMatches((currentMatches) => {
      const currentSnapshot = currentMatches.find((item) => item.id === match.id)

      if (isOlderMatchSnapshot(currentSnapshot, match)) {
        return currentMatches
      }

      const remainingMatches = currentMatches.filter((item) => item.id !== match.id)

      return [match, ...remainingMatches]
    })

    if (!profile?.id) {
      return true
    }

    const affectsDisplayedMatch =
      currentMatch?.id === match.id ||
      selectedMatchIdRef.current === match.id ||
      preferredMatchIdRef.current === match.id
    const shouldPromoteNewOutgoingRoom =
      isDisplayable &&
      match.status === 'pending' &&
      match.createdBy.id === profile?.id &&
      currentMatch?.id !== match.id &&
      currentMatch?.status !== 'in_progress'
    const shouldPromoteNewMatch =
      isDisplayable &&
      (
        (currentMatch?.status === 'completed' && match.status !== 'pending') ||
        shouldPromoteNewOutgoingRoom
      )

    if (!affectsDisplayedMatch && !shouldPromoteNewMatch) {
      return true
    }

    if (!isDisplayable) {
      if (leavingCompletedMatchRef.current === match.id && currentMatch?.id === match.id && match.status === 'completed') {
        return true
      }

      dismissedMatchIdsRef.current.add(match.id)
      resetToMultiplayerHome()

      return true
    }

    applyDisplayedMatch(match)
    return true
  }, [applyDisplayedMatch, profile?.id, resetToMultiplayerHome, showToast])

  const applyRoomRuntimeEvent = useCallback((event: RoomRealtimeEvent) => {
    const currentRevision = roomRevisionRef.current[event.roomId] ?? 0

    if (event.revision <= currentRevision) {
      return
    }

    roomRevisionRef.current = {
      ...roomRevisionRef.current,
      [event.roomId]: event.revision,
    }

    const closesCurrentRoom = event.reason === 'match_declined' || event.reason === 'match_left'

    if (closesCurrentRoom) {
      dismissedMatchIdsRef.current.add(event.match.id)
      dispatchOrderedRoomState({ type: 'dismiss-match', matchId: event.match.id })
      setMatches((currentMatches) => currentMatches.filter((item) => item.id !== event.match.id))

      resetToMultiplayerHome()

      return
    }

    dispatchOrderedRoomState({ type: 'room-event', event, selectedMatchId: selectedMatchIdRef.current ?? preferredMatchIdRef.current })
    applyRealtimeMatchSnapshot(event.match, { recordLegacyEvent: false })
  }, [applyRealtimeMatchSnapshot, resetToMultiplayerHome])

  const applyRoomRuntimeSnapshot = useCallback((snapshot: RoomSnapshotPayload) => {
    const currentRevision = roomRevisionRef.current[snapshot.roomId] ?? 0

    if (snapshot.revision < currentRevision) {
      return
    }

    roomRevisionRef.current = {
      ...roomRevisionRef.current,
      [snapshot.roomId]: snapshot.revision,
    }
    dispatchOrderedRoomState({ type: 'room-snapshot', snapshot, selectedMatchId: selectedMatchIdRef.current ?? preferredMatchIdRef.current })
    applyRealtimeMatchSnapshot(snapshot.match, { recordLegacyEvent: false })
  }, [applyRealtimeMatchSnapshot])

  const refreshRoomDataFromRealtime = useCallback(() => {
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current)
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null
      void refreshRoomData().catch((caughtError) => {
        reportBackgroundRoomError(caughtError, 'Impossible de synchroniser le salon multijoueur.')
      })
    }, 180)
  }, [refreshRoomData, reportBackgroundRoomError])

  const applyPresenceFromRealtime = useCallback((payload: PresenceRealtimePayload) => {
    const updatePlayer = (player: PublicPlayer) => {
      if (player.id !== payload.player.id) return player
      if (Date.parse(player.presenceUpdatedAt) > Date.parse(payload.player.presenceUpdatedAt)) return player
      return { ...player, ...payload.player }
    }
    const updateMatch = (match: MatchData) => {
      let changed = false
      const createdBy = updatePlayer(match.createdBy)
      if (createdBy !== match.createdBy) changed = true
      const participants = match.participants.map((participant) => {
        const player = updatePlayer(participant.player)
        if (player !== participant.player) changed = true
        return player === participant.player ? participant : { ...participant, player }
      })
      return changed ? { ...match, createdBy, participants } : match
    }

    setFriends((current) => {
      let changed = false
      const next = current.map((friend) => {
        const updated = updatePlayer(friend)
        if (updated !== friend) changed = true
        return updated
      })
      return changed ? next : current
    })
    setSelectedOpponent((current) => current ? updatePlayer(current) : current)
    setMatches((current) => {
      let changed = false
      const next = current.map((match) => {
        const updated = updateMatch(match)
        if (updated !== match) changed = true
        return updated
      })
      return changed ? next : current
    })
    setActiveMatch((current) => {
      if (!current) return current
      const updated = updateMatch(current)
      if (updated !== current) activeMatchRef.current = updated
      return updated
    })
  }, [])

  useEffect(() => () => {
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current)
    }
  }, [])

  const refreshMatchFromRealtime = useCallback((payload: MatchRealtimePayload) => {
    if (payload.roomEvent) {
      applyRoomRuntimeEvent(payload.roomEvent)
      return
    }

    if (payload?.match && applyRealtimeMatchSnapshot(payload.match)) {
      return
    }
  }, [applyRealtimeMatchSnapshot, applyRoomRuntimeEvent])

  const advanceTempoFromRealtime = useCallback((payload: { matchId: string; questionIndex: number; at: string }) => {
    const match = activeMatchRef.current

    if (!match || match.id !== payload.matchId || configRef.current.challengeMode !== 'tempo') {
      return
    }

    completeTempoQuestionRef.current(payload.questionIndex, new Date(payload.at).getTime())
  }, [])

  const applyTempoAnswerRecorded = useCallback((payload: MatchTempoAnswerRecordedPayload) => {
    const match = activeMatchRef.current

    if (!match || match.id !== payload.matchId || configRef.current.challengeMode !== 'tempo') {
      return
    }

    applyMatchSnapshot(payload.match)
  }, [applyMatchSnapshot])

  const realtimeCommands = useRealtimeEvents({
    isAuthenticated: roomRealtimeAuthenticated,
    getToken,
    connectionPriority: 'critical',
    onMatchChanged: refreshMatchFromRealtime,
    onRoomEvent: applyRoomRuntimeEvent,
    onRoomSnapshot: applyRoomRuntimeSnapshot,
    onMatchTempoAnswerRecorded: applyTempoAnswerRecorded,
    onMatchTempoProgress: advanceTempoFromRealtime,
    onSocialChanged: refreshRoomDataFromRealtime,
    onPresenceChanged: applyPresenceFromRealtime,
    onNotificationsChanged: refreshRoomDataFromRealtime,
    onConnectionError: (caughtError) => {
      reportBackgroundRoomError(caughtError, 'Connexion temps reel du salon impossible.')
    },
  })

  useEffect(() => {
    if (!realtimeCommands.isRealtimeReady) {
      joinedRealtimeRoomRef.current = null
      return
    }

    if (!displayedMatch) {
      return
    }

    const roomId = displayedMatch.roomId ?? displayedMatch.id

    if (joinedRealtimeRoomRef.current === roomId) {
      return
    }

    joinedRealtimeRoomRef.current = roomId
    const lastSeenEventId = lastSeenEventIdForMatch(orderedRoomStateRef.current, displayedMatch)

    void realtimeCommands.joinRoom(roomId, lastSeenEventId).catch((caughtError) => {
      joinedRealtimeRoomRef.current = null
      reportBackgroundRoomError(caughtError, 'Impossible de rejoindre le salon temps reel.')
    })
  }, [displayedMatch, realtimeCommands, reportBackgroundRoomError])

  useEffect(() => {
    acceptMatchInvitationRealtimeRef.current = realtimeCommands.acceptMatchInvitation
    acceptMatchProposalRealtimeRef.current = realtimeCommands.acceptMatchProposal
    createMatchInvitationRealtimeRef.current = realtimeCommands.createMatchInvitation
    declineMatchInvitationRealtimeRef.current = realtimeCommands.declineMatchInvitation
    declineMatchProposalRealtimeRef.current = realtimeCommands.declineMatchProposal
    proposeMatchRealtimeRef.current = realtimeCommands.proposeMatch
    updateMatchConfigRealtimeRef.current = realtimeCommands.updateMatchConfig
    forfeitMatchRealtimeRef.current = realtimeCommands.forfeitMatch
    leaveMatchRealtimeRef.current = realtimeCommands.leaveMatch
    requestMatchRematchRealtimeRef.current = realtimeCommands.requestMatchRematch
    submitMatchResultRealtimeRef.current = realtimeCommands.submitMatchResult
    submitTempoAnswerRealtimeRef.current = realtimeCommands.submitTempoAnswer
    submitSprintAnswerRealtimeRef.current = realtimeCommands.submitSprintAnswer
  }, [
    realtimeCommands.acceptMatchInvitation,
    realtimeCommands.acceptMatchProposal,
    realtimeCommands.createMatchInvitation,
    realtimeCommands.declineMatchInvitation,
    realtimeCommands.declineMatchProposal,
    realtimeCommands.forfeitMatch,
    realtimeCommands.leaveMatch,
    realtimeCommands.proposeMatch,
    realtimeCommands.requestMatchRematch,
    realtimeCommands.submitMatchResult,
    realtimeCommands.submitTempoAnswer,
    realtimeCommands.submitSprintAnswer,
    realtimeCommands.updateMatchConfig,
  ])

  useEffect(() => cancelQueuedConfigFlush, [cancelQueuedConfigFlush])

  useEffect(() => {
    void refreshRoomData().catch((caughtError) => {
      reportBackgroundRoomError(caughtError, 'Impossible de charger le salon multijoueur.')
    })
  }, [refreshRoomData, reportBackgroundRoomError])

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress' || !displayedMatch.questionSeed || !config.game || !config.level) {
      return
    }

    const questionIndex = config.challengeMode === 'tempo'
      ? Math.min(tempoActiveQuestionIndex, Math.max(0, (displayedMatch.questionCount ?? tempoActiveQuestionIndex + 1) - 1))
      : Math.min(matchAnswers.length, Math.max(0, (displayedMatch.questionCount ?? matchAnswers.length + 1) - 1))
    const nextQuestion = generateMatchQuestion(displayedMatch.questionSeed, questionIndex, config.game, config.level)
    questionRef.current = nextQuestion
    setQuestion(nextQuestion)
    questionStartedAtRef.current =
      config.challengeMode === 'tempo'
        ? tempoQuestionStartedAtByIndexRef.current.get(questionIndex) ?? matchStartedAtRef.current
        : Date.now()
  }, [config.challengeMode, config.game, config.level, displayedMatch?.questionCount, displayedMatch?.questionSeed, displayedMatch?.status, matchAnswers.length, tempoActiveQuestionIndex])

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress' || myParticipant?.status !== 'playing') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      focusAnswerInput()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [displayedMatch?.status, focusAnswerInput, matchAnswers.length, myParticipant?.status, question.prompt, tempoPendingAnswer])

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress') {
      return
    }

    const runKey = `${displayedMatch.id}:${displayedMatch.startedAt ?? 'pending'}`

    if (activeRunKeyRef.current === runKey) {
      return
    }

    activeRunKeyRef.current = runKey
    setMatchAnswers([])
    matchAnswersRef.current = []
    tempoQuestionStartedAtByIndexRef.current.clear()
    completedTempoQuestionIndexesRef.current.clear()
    setTempoQuestionIndex(0)
    setTempoPendingAnswer(null)
    tempoPendingAnswerRef.current = null
    resultSubmittedRef.current = null
    setLocalScore({ correct: 0, total: 0 })
    setAnswer('')
    const startedAtMs = displayedMatch.startedAt ? new Date(displayedMatch.startedAt).getTime() : serverNowMs()
    const endsAtMs = displayedMatch.endsAt ? new Date(displayedMatch.endsAt).getTime() : startedAtMs + Math.max(1, displayedMatch.durationSeconds || DEFAULT_ROOM_CONFIG.durationSeconds) * 1000

    matchStartedAtRef.current = startedAtMs
    tempoQuestionStartedAtByIndexRef.current.set(0, startedAtMs)
    setSprintRemainingSeconds(calculateRemainingSessionSeconds(endsAtMs, serverNowMs()))
    questionStartedAtRef.current = Date.now()
  }, [displayedMatch?.durationSeconds, displayedMatch?.endsAt, displayedMatch?.id, displayedMatch?.startedAt, displayedMatch?.status, serverNowMs, setTempoQuestionIndex])

  const heartbeatMatchId =
    displayedMatch &&
    displayedMatchId &&
    displayedMatchHostId === profile?.id &&
    isActiveRoomMatch(displayedMatch)
      ? displayedMatchId
      : null

  useEffect(() => {
    if (!heartbeatMatchId) {
      heartbeatTargetIdRef.current = null
      return
    }

    let active = true
    heartbeatTargetIdRef.current = heartbeatMatchId

    const heartbeat = async () => {
      if (
        !active ||
        heartbeatTargetIdRef.current !== heartbeatMatchId ||
        heartbeatInFlightMatchIdRef.current === heartbeatMatchId
      ) {
        return
      }

      heartbeatInFlightMatchIdRef.current = heartbeatMatchId

      try {
        await api.heartbeatMatch(getToken, heartbeatMatchId)
      } catch (caughtError) {
        if (!active || heartbeatTargetIdRef.current !== heartbeatMatchId) {
          return
        }

        if (isStaleRoomError(caughtError)) {
          resetToMultiplayerHome()
          return
        }

        reportBackgroundRoomError(caughtError, 'Synchronisation du salon interrompue.')
      } finally {
        if (heartbeatInFlightMatchIdRef.current === heartbeatMatchId) {
          heartbeatInFlightMatchIdRef.current = null
        }
      }
    }

    const firstHeartbeatTimeout = window.setTimeout(() => void heartbeat(), 750)
    const interval = window.setInterval(() => void heartbeat(), 5000)

    return () => {
      active = false
      window.clearTimeout(firstHeartbeatTimeout)
      window.clearInterval(interval)
      if (heartbeatTargetIdRef.current === heartbeatMatchId) {
        heartbeatTargetIdRef.current = null
      }
    }
  }, [heartbeatMatchId, getToken, reportBackgroundRoomError, resetToMultiplayerHome])

  function openInvitation(match: MatchData) {
    cancelQueuedConfigFlush()
    configDraftRef.current = null
    submittedConfigRef.current = null
    roomActionInFlightRef.current = null
    preferredMatchIdRef.current = match.id
    selectedMatchIdRef.current = match.id
    matchAnswersRef.current = []
    tempoQuestionStartedAtByIndexRef.current.clear()
    completedTempoQuestionIndexesRef.current.clear()
    activeRunKeyRef.current = null
    resultSubmittedRef.current = null
    applyMatchSnapshot(match)
    applyConfig(matchToConfig(match))
    setSelectedOpponent(match.createdBy)
    setRoomDraftOpen(true)
    setSearchParams({ match: match.id })
    setAction('')
  }

  function openDraft(friend?: PublicPlayer) {
    cancelQueuedConfigFlush()
    configDraftRef.current = null
    submittedConfigRef.current = null
    roomActionInFlightRef.current = null
    preferredMatchIdRef.current = null
    selectedMatchIdRef.current = null
    matchAnswersRef.current = []
    tempoQuestionStartedAtByIndexRef.current.clear()
    completedTempoQuestionIndexesRef.current.clear()
    activeRunKeyRef.current = null
    resultSubmittedRef.current = null
    activeMatchRef.current = null
    setActiveMatch(null)
    setSelectedOpponent(friend ?? null)
    setRoomDraftOpen(true)
    setFriendPickerOpen(false)
    setSearchParams({})
    setError('')
    setAction('')
  }

  function updateConfig(resolveNextConfig: (current: RoomConfig) => RoomConfig) {
    if (!isRoomMaster) {
      return
    }

    const nextConfig = normalizeRoomConfig(resolveNextConfig(configRef.current))
    applyConfig(nextConfig)

    const currentMatch = activeMatchRef.current ?? displayedMatch

    if (!currentMatch || currentMatch.status === 'in_progress') {
      return
    }

    syncRoomConfig(currentMatch, nextConfig)
  }

  async function handleInvite(friend: PublicPlayer) {
    const actionKey = `invite:${friend.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const configPayload = completeConfigPayload(configRef.current)
      const createMatchInvitation = createMatchInvitationRealtimeRef.current

      if (!createMatchInvitation) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await createMatchInvitation({
        opponentPlayerId: friend.id,
        ...(configPayload ?? {}),
      })
      preferredMatchIdRef.current = payload.match.id
      selectedMatchIdRef.current = payload.match.id
      applyMatchSnapshot(payload.match)
      setSelectedOpponent(friend)
      setRoomDraftOpen(true)
      setSearchParams({ match: payload.match.id })
      setFriendPickerOpen(false)
      showToast(`Invitation envoyee a ${friend.name}.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'inviter cet ami.")
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleAccept(match: MatchData) {
    const actionKey = `accept:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const acceptMatchInvitation = acceptMatchInvitationRealtimeRef.current

      if (!acceptMatchInvitation) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await acceptMatchInvitation(match.id)
      configDraftRef.current = null
      submittedConfigRef.current = null
      preferredMatchIdRef.current = payload.match.id
      selectedMatchIdRef.current = payload.match.id
      applyMatchSnapshot(payload.match)
      applyConfig(matchToConfig(payload.match))
      setSelectedOpponent(match.createdBy)
      setSearchParams({ match: payload.match.id })
      showToast('Invitation acceptee. En attente du lancement.')
    } catch (caughtError) {
      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'accepter ce defi.")
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleDecline(match: MatchData) {
    const actionKey = `decline:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    dismissedMatchIdsRef.current.add(match.id)

    try {
      const declineMatchInvitation = declineMatchInvitationRealtimeRef.current

      if (!declineMatchInvitation) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      await declineMatchInvitation(match.id)
      resetToMultiplayerHome()
      showToast('Invitation refusee.')
    } catch (caughtError) {
      dismissedMatchIdsRef.current.delete(match.id)

      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de refuser ce defi.')
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleLeave(match: MatchData) {
    const actionKey = `leave:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    dismissedMatchIdsRef.current.add(match.id)

    try {
      const leaveMatch = leaveMatchRealtimeRef.current

      if (!leaveMatch) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      await leaveMatch(match.id)
      resetToMultiplayerHome()
      showToast('Salon ferme.')
    } catch (caughtError) {
      dismissedMatchIdsRef.current.delete(match.id)

      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de fermer ce salon.')
    } finally {
      if (leavingCompletedMatchRef.current === match.id) {
        leavingCompletedMatchRef.current = null
      }
      finishRoomAction(actionKey)
    }
  }

  async function handleStopMatch(match: MatchData) {
    const actionKey = `stop:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      await Promise.allSettled(Array.from(sprintAnswerSyncPromisesRef.current))
      const forfeitMatch = forfeitMatchRealtimeRef.current

      if (!forfeitMatch) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await forfeitMatch(match.id)
      const nextMatch = applyMatchSnapshot(payload.match)
      preferredMatchIdRef.current = nextMatch.id
      selectedMatchIdRef.current = nextMatch.id
      setSelectedOpponent(nextMatch.participants.find((participant) => participant.player.id !== profile?.id)?.player ?? null)
      setRoomDraftOpen(true)
      setSearchParams({ match: nextMatch.id })
      clearCachePrefix(DASHBOARD_CACHE_PREFIX)
      showToast('Vous avez abandonne le defi.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de stopper ce defi.')
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleTransferRoomMaster(match: MatchData) {
    const actionKey = `transfer-host:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const payload = await api.transferMatchHost(getToken, match.id)
      const nextMatch = applyMatchSnapshot(payload.match)
      preferredMatchIdRef.current = nextMatch.id
      selectedMatchIdRef.current = nextMatch.id
      applyConfig(matchToConfig(nextMatch))
      setSelectedOpponent(nextMatch.participants.find((participant) => participant.player.id !== profile?.id)?.player ?? null)
      setRoomDraftOpen(true)
      setSearchParams({ match: nextMatch.id })
      showToast('Maitre du salon change.')
    } catch (caughtError) {
      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de changer le maitre du salon.')
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleRematch(match: MatchData) {
    const actionKey = `rematch:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const requestMatchRematch = requestMatchRematchRealtimeRef.current

      if (!requestMatchRematch) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await requestMatchRematch(match.id)
      const nextMatch = applyMatchSnapshot(payload.match)
      preferredMatchIdRef.current = nextMatch.id
      selectedMatchIdRef.current = nextMatch.id
      applyConfig(matchToConfig(nextMatch))
      setSelectedOpponent(nextMatch.participants.find((participant) => participant.player.id !== profile?.id)?.player ?? null)
      setRoomDraftOpen(true)
      setFriendPickerOpen(false)
      setSearchParams({ match: nextMatch.id })
      showToast(nextMatch.id === match.id ? "Relance demandee. En attente de l'adversaire." : 'Nouveau defi pret.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Relance impossible.')
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleStart() {
    if (!displayedMatch) {
      return
    }

    const actionKey = `propose:${displayedMatch.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const currentConfig = configRef.current
      const proposalConfig = completeConfigPayload(currentConfig)

      if (!proposalConfig) {
        throw new ApiRequestError('Configuration de defi incomplete.', 400, 'match_config_incomplete')
      }

      cancelQueuedConfigFlush()
      configDraftRef.current = null
      const pendingConfigSync = configSyncPromiseRef.current

      if (pendingConfigSync) {
        await pendingConfigSync
      }

      const currentMatch = activeMatchRef.current

      if (!currentMatch || currentMatch.id !== displayedMatch.id) {
        throw new ApiRequestError('Salon indisponible.', 409, 'match_not_found')
      }

      submittedConfigRef.current = { matchId: displayedMatch.id, config: currentConfig }

      const proposeMatch = proposeMatchRealtimeRef.current

      if (!proposeMatch) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await proposeMatch(displayedMatch.id, {
        ...proposalConfig,
        expectedConfigVersion: currentMatch.configVersion,
      })
      submittedConfigRef.current = null
      applyMatchSnapshot(payload.match)
      showToast('Configuration proposee.')
    } catch (caughtError) {
      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Proposition impossible.')
    } finally {
      if (submittedConfigRef.current?.matchId === displayedMatch.id) {
        submittedConfigRef.current = null
      }
      finishRoomAction(actionKey)
    }
  }

  async function handleAcceptProposal(match: MatchData) {
    const actionKey = `accept-proposal:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const acceptMatchProposal = acceptMatchProposalRealtimeRef.current

      if (!acceptMatchProposal) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await acceptMatchProposal(match.id)
      applyMatchSnapshot(payload.match)
      applyConfig(matchToConfig(payload.match))
      showToast('Defi lance.')
    } catch (caughtError) {
      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'accepter cette configuration.")
    } finally {
      finishRoomAction(actionKey)
    }
  }

  async function handleDeclineProposal(match: MatchData) {
    const actionKey = `decline-proposal:${match.id}`

    if (!beginRoomAction(actionKey)) {
      return
    }

    try {
      const declineMatchProposal = declineMatchProposalRealtimeRef.current

      if (!declineMatchProposal) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await declineMatchProposal(match.id)
      applyMatchSnapshot(payload.match)
      applyConfig(matchToConfig(payload.match))
      showToast('Configuration refusee.')
    } catch (caughtError) {
      if (isStaleRoomError(caughtError)) {
        resetToMultiplayerHome()
        return
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de refuser cette configuration.')
    } finally {
      finishRoomAction(actionKey)
    }
  }

  function handlePrimaryRoomAction() {
    if (!displayedMatch) {
      if (selectedOpponent) {
        void handleInvite(selectedOpponent)
      } else {
        setFriendPickerOpen(true)
      }
      return
    }

    if (isRoomMaster && !opponent) {
      setFriendPickerOpen(true)
      return
    }

    void handleStart()
  }

  const submitMatchResult = useCallback(async (finalAnswers: AnswerResult[]) => {
    if (!displayedMatch) {
      return
    }

    const submissionKey = `${displayedMatch.id}:${profile?.id ?? 'current'}`

    if (resultSubmittedRef.current === submissionKey) {
      return
    }

    resultSubmittedRef.current = submissionKey
    const durationSeconds = calculateElapsedSessionSeconds(matchStartedAtRef.current, serverNowMs())

    setAction(`result:${displayedMatch.id}`)
    setError('')

    try {
      const submitMatchResultRealtime = submitMatchResultRealtimeRef.current

      if (!submitMatchResultRealtime) {
        throw new ApiRequestError('Connexion temps reel du salon indisponible.', 0, 'realtime_unavailable')
      }

      const payload = await submitMatchResultRealtime(displayedMatch.id, {
        durationSeconds,
        bestStreak: computeBestStreak(finalAnswers),
        answers: finalAnswers.map((item) => ({
          prompt: item.prompt,
          correctAnswer: item.correctAnswer,
          userAnswer: item.userAnswer,
          responseTimeMs: item.responseTimeMs,
          skill: item.skill,
        })),
      })
      clearCachePrefix(DASHBOARD_CACHE_PREFIX)
      applyMatchSnapshot(payload.match)
      showToast(payload.match.status === 'completed' ? 'Defi termine.' : 'Resultat enregistre.')
    } catch (caughtError) {
      if (caughtError instanceof ApiRequestError && caughtError.code === 'match_already_completed') {
        await refreshRoomData()
        return
      }

      resultSubmittedRef.current = null
      setError(caughtError instanceof Error ? caughtError.message : 'Resultat impossible a enregistrer.')
    } finally {
      setAction('')
    }
  }, [applyMatchSnapshot, displayedMatch, profile?.id, refreshRoomData, serverNowMs, showToast])

  const appendMatchAnswer = useCallback((userAnswer: number | null, responseTimeMs: number, forcedQuestionIndex?: number) => {
    const currentMatch = activeMatchRef.current
    const currentConfig = configRef.current
    const currentAnswers = matchAnswersRef.current

    if (!currentMatch?.questionSeed || !currentConfig.game || !currentConfig.level) {
      setError('Configuration de defi incomplete.')
      return null
    }

    const questionIndex = forcedQuestionIndex ?? currentAnswers.length
    const existingAnswer = currentAnswers.find((item) => item.questionIndex === questionIndex)

    if (existingAnswer) {
      return currentAnswers
    }

    const currentQuestion = currentConfig.challengeMode === 'tempo'
      ? generateMatchQuestion(currentMatch.questionSeed, questionIndex, currentConfig.game, currentConfig.level)
      : questionRef.current
    const isCorrect = userAnswer !== null && userAnswer === currentQuestion.answer
    const answerResult: AnswerResult = {
      questionIndex,
      prompt: currentQuestion.prompt,
      correctAnswer: currentQuestion.answer,
      userAnswer,
      responseTimeMs,
      isCorrect,
      game: currentConfig.game,
      level: currentConfig.level,
      skill: currentQuestion.skill,
    }
    const nextAnswers = [...currentAnswers, answerResult].sort((left, right) => (left.questionIndex ?? 0) - (right.questionIndex ?? 0))

    matchAnswersRef.current = nextAnswers
    setMatchAnswers(nextAnswers)
    setLocalScore({
      correct: nextAnswers.filter((item) => item.isCorrect).length,
      total: nextAnswers.length,
    })
    setAnswer('')

    if (currentConfig.challengeMode !== 'tempo') {
      const submitSprintAnswerRealtime = submitSprintAnswerRealtimeRef.current

      if (!submitSprintAnswerRealtime) {
        setError('Temps reel indisponible.')
        return nextAnswers
      }

      const submission = submitSprintAnswerRealtime(currentMatch.id, {
        questionIndex,
        prompt: currentQuestion.prompt,
        correctAnswer: currentQuestion.answer,
        userAnswer,
        responseTimeMs,
        skill: currentQuestion.skill,
        source: 'manual',
      }).then((payload) => {
        applyMatchSnapshot(payload.match)
      }).catch((caughtError) => {
        if (!isTransientAuthError(caughtError) && !isStaleRoomError(caughtError)) {
          setError(caughtError instanceof Error ? caughtError.message : 'Reponse sprint impossible.')
        }
      }).finally(() => {
        sprintAnswerSyncPromisesRef.current.delete(submission)
      })

      sprintAnswerSyncPromisesRef.current.add(submission)
    }

    return nextAnswers
  }, [applyMatchSnapshot])

  const removeTempoAnswer = useCallback((questionIndex: number) => {
    const nextAnswers = matchAnswersRef.current.filter((item) => item.questionIndex !== questionIndex)

    matchAnswersRef.current = nextAnswers
    setMatchAnswers(nextAnswers)
    setLocalScore({
      correct: nextAnswers.filter((item) => item.isCorrect).length,
      total: nextAnswers.length,
    })
  }, [])

  const advanceTempoQuestion = useCallback((questionIndex: number, nextQuestionStartedAtMs = serverNowMs()) => {
    if (
      configRef.current.challengeMode !== 'tempo' ||
      tempoActiveQuestionIndexRef.current !== questionIndex ||
      completedTempoQuestionIndexesRef.current.has(questionIndex)
    ) {
      return
    }

    completedTempoQuestionIndexesRef.current.add(questionIndex)

    if (questionIndex + 1 < (activeMatchRef.current?.questionCount ?? 0)) {
      tempoQuestionStartedAtByIndexRef.current.set(questionIndex + 1, nextQuestionStartedAtMs)
      setTempoQuestionIndex(questionIndex + 1)
    }

    tempoPendingAnswerRef.current = null
    setTempoPendingAnswer(null)
    setAnswer('')
  }, [serverNowMs, setTempoQuestionIndex])

  useEffect(() => {
    completeTempoQuestionRef.current = advanceTempoQuestion
  }, [advanceTempoQuestion])

  const submitTempoAnswer = useCallback((userAnswer: number | null, source: 'manual' | 'timeout') => {
    if (!displayedMatch?.questionSeed || !config.game || !config.level) {
      return
    }

    const currentQuestionIndex = tempoActiveQuestionIndexRef.current
    const pendingAnswer = tempoPendingAnswerRef.current

    if (pendingAnswer?.questionIndex === currentQuestionIndex) {
      return
    }

    const submitTempoAnswerRealtime = submitTempoAnswerRealtimeRef.current

    if (!submitTempoAnswerRealtime) {
      setError('Temps reel indisponible.')
      window.requestAnimationFrame(focusAnswerInput)
      return
    }

    const tempoLimitMs = Math.max(1, activeMatchRef.current?.perQuestionTimeLimitSeconds ?? configRef.current.perQuestionTimeLimitSeconds) * 1000
    const responseTimeMs = Math.max(0, Math.min(tempoLimitMs, serverNowMs() - questionStartedAtRef.current))
    const nextPendingAnswer = { questionIndex: currentQuestionIndex, userAnswer, responseTimeMs }
    const questionForAnswer = generateMatchQuestion(displayedMatch.questionSeed, currentQuestionIndex, config.game, config.level)

    appendMatchAnswer(userAnswer, responseTimeMs, currentQuestionIndex)
    tempoPendingAnswerRef.current = nextPendingAnswer
    setTempoPendingAnswer(nextPendingAnswer)
    setAnswer('')

    void submitTempoAnswerRealtime(displayedMatch.id, {
      questionIndex: currentQuestionIndex,
      prompt: questionForAnswer.prompt,
      correctAnswer: questionForAnswer.answer,
      userAnswer,
      responseTimeMs,
      skill: questionForAnswer.skill,
      source,
    }).then((payload) => {
      applyMatchSnapshot(payload.match)

      if (payload.progress.complete) {
        completeTempoQuestionRef.current(payload.progress.questionIndex, new Date(payload.match.serverNow).getTime())
      }
    }).catch((caughtError) => {
      if (isStaleRoomError(caughtError)) {
        void refreshRoomData().catch((refreshError) => {
          reportBackgroundRoomError(refreshError, 'Impossible de resynchroniser la fin du tempo.')
        })
        return
      }

      if (tempoPendingAnswerRef.current?.questionIndex === currentQuestionIndex) {
        tempoPendingAnswerRef.current = null
        setTempoPendingAnswer(null)
      }

      removeTempoAnswer(currentQuestionIndex)

      if (userAnswer !== null) {
        setAnswer(String(userAnswer))
      }

      window.requestAnimationFrame(focusAnswerInput)

      if (!isTransientAuthError(caughtError)) {
        setError(caughtError instanceof Error ? caughtError.message : 'Reponse tempo impossible.')
      }
    })
  }, [appendMatchAnswer, applyMatchSnapshot, config.game, config.level, displayedMatch, focusAnswerInput, refreshRoomData, removeTempoAnswer, reportBackgroundRoomError, serverNowMs])

  const recordMatchAnswer = useCallback((userAnswer: number) => {
    if (config.challengeMode === 'tempo') {
      submitTempoAnswer(userAnswer, 'manual')
      return
    }

    appendMatchAnswer(userAnswer, Math.max(0, serverNowMs() - questionStartedAtRef.current))
  }, [appendMatchAnswer, config.challengeMode, serverNowMs, submitTempoAnswer])

  function handleAnswerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAnswer = parseAnswerInput(answer)

    if (numericAnswer === null) {
      setError('Entrez un nombre valide.')
      return
    }

    recordMatchAnswer(numericAnswer)
  }

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress' || config.challengeMode !== 'tempo') {
      return
    }

    if (action === `result:${displayedMatch.id}` || tempoActiveQuestionIndex >= (displayedMatch.questionCount ?? 0)) {
      return
    }

    const questionIndex = tempoActiveQuestionIndex
    const questionStartMs = tempoQuestionStartedAtByIndexRef.current.get(questionIndex) ?? (
      questionIndex === 0 ? matchStartedAtRef.current : serverNowMs()
    )
    const tempoQuestionSeconds = Math.max(1, displayedMatch.perQuestionTimeLimitSeconds ?? config.perQuestionTimeLimitSeconds)
    const endsAt = questionStartMs + tempoQuestionSeconds * 1000
    questionStartedAtRef.current = questionStartMs

    const interval = window.setInterval(() => {
      const remainingSeconds = Math.max(0, Math.ceil((endsAt - serverNowMs()) / 1000))
      setTempoRemainingSeconds(remainingSeconds)

      if (remainingSeconds <= 0) {
        window.clearInterval(interval)
        const timedAnswer = parseAnswerInput(answer)
        submitTempoAnswer(timedAnswer, 'timeout')
      }
    }, 250)

    const initialRemainingSeconds = Math.max(0, Math.ceil((endsAt - serverNowMs()) / 1000))
    setTempoRemainingSeconds(initialRemainingSeconds)

    return () => window.clearInterval(interval)
  }, [action, answer, config.challengeMode, config.perQuestionTimeLimitSeconds, displayedMatch?.id, displayedMatch?.perQuestionTimeLimitSeconds, displayedMatch?.questionCount, displayedMatch?.status, serverNowMs, submitTempoAnswer, tempoActiveQuestionIndex])

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress' || config.challengeMode !== 'sprint' || myParticipant?.status !== 'playing') {
      return
    }

    if (action === `result:${displayedMatch.id}`) {
      return
    }

    const durationSeconds = Math.max(1, displayedMatch.durationSeconds || config.durationSeconds || DEFAULT_ROOM_CONFIG.durationSeconds)
    const endsAt = displayedMatch.endsAt ? new Date(displayedMatch.endsAt).getTime() : matchStartedAtRef.current + durationSeconds * 1000
    let submitted = false

    const updateRemaining = () => {
      const remainingSeconds = calculateRemainingSessionSeconds(endsAt, serverNowMs())
      setSprintRemainingSeconds(remainingSeconds)

      if (remainingSeconds <= 0 && !submitted) {
        submitted = true
        void submitMatchResult(matchAnswersRef.current)
      }
    }

    updateRemaining()
    const interval = window.setInterval(updateRemaining, 250)

    return () => window.clearInterval(interval)
  }, [action, config.challengeMode, config.durationSeconds, displayedMatch?.durationSeconds, displayedMatch?.endsAt, displayedMatch?.id, displayedMatch?.status, myParticipant?.status, serverNowMs, submitMatchResult])

  useEffect(() => {
    if (displayedMatch?.status !== 'in_progress') {
      setPendingModePath(null)
    }
  }, [displayedMatch?.status])

  function goToModeHome(path: PlayModePath) {
    setPendingModePath(null)

    if (path === '/jeu/multijoueur') {
      resetToMultiplayerHome()
      navigate('/jeu/multijoueur', { replace: true })
      window.scrollTo({ top: 0 })
      return
    }

    navigate(path)
  }

  function handleSelectPlayMode(path: PlayModePath) {
    if (displayedMatch?.status === 'in_progress') {
      setPendingModePath(path)
      return false
    }

    goToModeHome(path)
    return false
  }

  function confirmPendingModeChange() {
    if (!pendingModePath) {
      return
    }

    goToModeHome(pendingModePath)
  }

  function openFriendPicker() {
    setFriendPickerOpen(true)
  }

  function closeFriendPicker() {
    setFriendPickerOpen(false)
  }

  const mobileChallengeModeLabel = authoritativeConfig.challengeMode === 'tempo'
    ? 'Tempo'
    : authoritativeConfig.challengeMode === 'sprint'
      ? 'Sprint'
      : 'Mode a choisir'
  const mobileLevelLabel = authoritativeConfig.level ? LEVEL_LABELS[authoritativeConfig.level] : 'Niveau à choisir'
  const mobileOpponentLabel = opponent?.name ?? selectedOpponent?.name ?? ''
  const mobileRoomStatusLabel = displayedMatch?.status === 'completed'
    ? roomStatusText
    : isRoomMaster
      ? 'Vous avez la main'
      : 'En attente du maitre'
  const mobilePrimarySectionLabel = displayedMatch?.status === 'in_progress'
    ? 'Defi'
    : displayedMatch?.status === 'completed'
      ? 'Resultats'
      : 'Defi'
  const canUseMobileInviteShortcut = Boolean(isRoomMaster && roomDraftOpen && !displayedMatch && !selectedOpponent)
  const showMobileInviteAction = Boolean(isRoomMaster && roomDraftOpen && !mobileOpponentLabel)
  const displayedMatchStatus = displayedMatch?.status ?? null
  const hasOpenRoom = Boolean(displayedMatch) || roomDraftOpen

  useEffect(() => {
    if (!hasOpenRoom) {
      setMobileRoomView('primary')
      return
    }

    if (displayedMatchStatus === 'in_progress' || displayedMatchStatus === 'completed') {
      setMobileRoomView('primary')
    }
  }, [displayedMatchStatus, hasOpenRoom])

  return (
    <section className={`page multiplayer-page multiplayer-status-${roomStatus} ${!displayedMatch && !roomDraftOpen ? 'multiplayer-view-lobby' : 'multiplayer-view-room'}`}>
      <PlayModeTabs onSelectMode={handleSelectPlayMode} />
      {pendingModePath ? (
        <PlayModeNavigationDialog
          targetPath={pendingModePath}
          onCancel={() => setPendingModePath(null)}
          onConfirm={confirmPendingModeChange}
        />
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}
      {roomSyncError ? (
        <div className="form-error multiplayer-sync-error" role="alert">
          <span>{roomSyncError}</span>
          <button
            type="button"
            onClick={() => {
              setRoomSyncError('')
              void refreshRoomData().catch((caughtError) => {
                reportBackgroundRoomError(caughtError, 'Impossible de charger le salon multijoueur.')
              })
            }}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {displayedMatch || roomDraftOpen ? (
        <div className="multiplayer-mobile-room-nav" aria-label="Navigation du salon">
          <div className="multiplayer-mobile-room-summary">
            <span>{mobileRoomStatusLabel}</span>
            <strong>{mobileChallengeModeLabel} - {mobileLevelLabel}</strong>
            {showMobileInviteAction ? (
              <button
                className="multiplayer-mobile-invite-button"
                type="button"
                disabled={!canUseMobileInviteShortcut}
                onClick={() => {
                  if (!canUseMobileInviteShortcut) {
                    return
                  }

                  setMobileRoomView('players')
                  openFriendPicker()
                }}
              >
                Inviter
              </button>
            ) : mobileOpponentLabel ? (
              <small>{mobileOpponentLabel}</small>
            ) : null}
          </div>
          <div className="multiplayer-mobile-room-jump">
            <button type="button" aria-pressed={mobileRoomView === 'primary'} onClick={() => setMobileRoomView('primary')}>
              {mobilePrimarySectionLabel}
            </button>
            <button type="button" aria-pressed={mobileRoomView === 'players'} onClick={() => setMobileRoomView('players')}>
              Joueurs
            </button>
          </div>
        </div>
      ) : null}

      {!displayedMatch && !roomDraftOpen ? (
        <MultiplayerLobby
          action={action}
          friends={friends}
          invitations={incomingInvitations}
          onDeclineInvitation={(match) => void handleDecline(match)}
          onInvite={(friend) => void handleInvite(friend)}
          onNewChallenge={openDraft}
          onOpenInvitation={openInvitation}
        />
      ) : (
      <div className="multiplayer-room-grid" id="multiplayer-room-content" data-mobile-room-view={mobileRoomView}>
        {playerCard(currentPlayer, isRoomMaster ? 'Maitre du salon' : 'Vous', isRoomMaster, myProfileStatus, myParticipant, { id: 'multiplayer-room-players' })}

        <article className="card multiplayer-control-card" id="multiplayer-room-controls">
          <div className="multiplayer-room-state">
            <span className="eyebrow">{isRoomMaster ? 'Vous avez la main' : 'En attente du maitre du salon'}</span>
            {!displayedMatch && roomDraftOpen ? (
              <div className="multiplayer-room-actions">
                <button className="secondary-button multiplayer-danger-button" type="button" onClick={resetToMultiplayerHome}>
                  Fermer le salon
                </button>
              </div>
            ) : displayedMatch && displayedMatch.status !== 'completed' ? (
              <div className="multiplayer-room-actions">
                <button className="secondary-button multiplayer-danger-button" type="button" disabled={action === `leave:${displayedMatch.id}`} onClick={() => void handleLeave(displayedMatch)}>
                  {leaveRoomLabel}
                </button>
                {displayedMatch.status === 'in_progress' && !myActiveMatchFinished ? (
                  <button
                    className="multiplayer-stop-button multiplayer-stop-button-inline"
                    type="button"
                    disabled={action === `stop:${displayedMatch.id}`}
                    onClick={() => void handleStopMatch(displayedMatch)}
                  >
                    Stop
                  </button>
                ) : null}
                {canTransferRoomMaster ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={action === `transfer-host:${displayedMatch.id}`}
                    onClick={() => void handleTransferRoomMaster(displayedMatch)}
                  >
                    Changer de maitre
                  </button>
                ) : null}
              </div>
            ) : (
              <strong>{roomStatusText}</strong>
            )}
          </div>

          {displayedMatch?.status === 'completed' ? (
            <MatchResultStage
              self={myResult}
              opponent={opponentResult}
              opponentName={opponent?.name ?? 'Adversaire'}
              selfOutcome={myResultOutcome}
              opponentOutcome={opponentResultOutcome}
              selfForfeited={myForfeited}
              opponentForfeited={opponentForfeited}
              opponentDismissed={opponentDismissedResult}
              rematchRequested={myRematchRequested}
              opponentRematchRequested={opponentRematchRequested}
              rematchPending={action === `rematch:${displayedMatch.id}`}
              onRematch={() => void handleRematch(displayedMatch)}
              onLeave={() => void handleLeave(displayedMatch)}
            />
          ) : displayedMatch?.status === 'in_progress' && myActiveMatchFinished ? (
            <div className="multiplayer-waiting-panel" data-testid="multiplayer-waiting-for-opponent">
              <strong>{myParticipant?.status === 'submitting' ? 'Validation du resultat' : 'Resultat envoye'}</strong>
              <p>{opponentParticipant?.status === 'completed' ? 'Finalisation du defi.' : "En attente de l'adversaire."}</p>
              <div className="multiplayer-waiting-stats" aria-label="Resultat provisoire">
                <span>
                  <strong>{myParticipant?.scorePoints ?? multiplayerScorePoints}</strong>
                  <small>pts</small>
                </span>
                <span>
                  <strong>{myParticipant?.totalQuestions ?? localScore.total}</strong>
                  <small>questions</small>
                </span>
                <span>
                  <strong>{myParticipant?.bestStreak ?? multiplayerCurrentStreak}</strong>
                  <small>serie</small>
                </span>
              </div>
            </div>
          ) : displayedMatch?.status === 'in_progress' ? (
            <>
            <ChallengeArenaScreen
              answer={answer}
              answerDisabled={Boolean(tempoPendingAnswer)}
              answerInputRef={answerInputRef}
              answerPulse={multiplayerLastAnswer ? (multiplayerLastAnswer.isCorrect ? 'correct' : 'wrong') : ''}
              answerPulseKey={multiplayerLastAnswer
                ? `${displayedMatch.id}:${multiplayerLastAnswer.questionIndex ?? matchAnswers.length - 1}`
                : undefined}
              contextLabel={`${config.challengeMode === 'tempo' ? 'Tempo' : 'Sprint'} - ${config.level ? LEVEL_LABELS[config.level] : 'Salon'}`}
              elapsedLabel={`${activeTimerElapsedSeconds}/${activeTimerTotalSeconds}`}
              exitDisabled={action === `stop:${displayedMatch.id}`}
              exitLabel="Stop"
              metrics={multiplayerMetrics}
              modeLabel="Multi"
              onAnswerChange={setAnswer}
              onExit={() => void handleStopMatch(displayedMatch)}
              onSubmit={handleAnswerSubmit}
              progressPercent={activeTimerProgress}
              question={question.prompt}
              questionKey={config.challengeMode === 'tempo' ? tempoActiveQuestionIndex : matchAnswers.length}
              questionProgressLabel={tempoQuestionProgressLabel}
              criticalRemainingSeconds={criticalRemainingSeconds(activeTimerTotalSeconds)}
              remainingSeconds={activeTimerSeconds ?? 0}
            />
            </>
          ) : (
            <>
              <MultiplayerRoomConfigurator
                authoritativeConfig={authoritativeConfig}
                controlsDisabled={controlsDisabled}
                editableConfig={editableConfig}
                onChange={updateConfig}
              />

              {displayedMatch && !isRoomMaster && displayedMatch.status === 'pending' ? (
                <div className="multiplayer-invite-actions">
                  <button className="primary-button" type="button" disabled={action === `accept:${displayedMatch.id}`} onClick={() => void handleAccept(displayedMatch)}>
                    Entrer dans le salon
                  </button>
                  <button className="secondary-button" type="button" disabled={action === `decline:${displayedMatch.id}`} onClick={() => void handleDecline(displayedMatch)}>
                    Refuser
                  </button>
                </div>
              ) : displayedMatch && !isRoomMaster && displayedMatch.status === 'ready' ? (
                <div className="multiplayer-invite-actions">
                  <LaunchActionButton
                    className="primary-button multiplayer-launch-action"
                    disabled={action === `accept-proposal:${displayedMatch.id}`}
                    label="Accepter le defi"
                    onLaunch={() => handleAcceptProposal(displayedMatch)}
                  />
                  <button className="secondary-button" type="button" disabled={action === `decline-proposal:${displayedMatch.id}`} onClick={() => void handleDeclineProposal(displayedMatch)}>
                    Refuser
                  </button>
                </div>
              ) : (
                primaryRoomActionIntent === 'propose' ? (
                  <LaunchActionButton
                    className="primary-button full-width primary-room-action"
                    data-room-action={primaryRoomActionIntent}
                    disabled={primaryRoomActionDisabled}
                    label={primaryRoomActionLabel}
                    onLaunch={handleStart}
                  />
                ) : (
                  <button
                    className="primary-button full-width primary-room-action"
                    data-room-action={primaryRoomActionIntent}
                    type="button"
                    disabled={primaryRoomActionDisabled}
                    onClick={handlePrimaryRoomAction}
                  >
                    {primaryRoomActionLabel}
                  </button>
                )
              )}
            </>
          )}
        </article>

        <article className="multiplayer-opponent-column">
          {playerCard(opponent, opponentLabel, opponentIsRoomMaster, opponentProfileStatus, opponentParticipant)}
          {isRoomMaster && (!displayedMatch || (!opponent && displayedMatch.status !== 'in_progress')) ? (
            <button className="primary-button full-width" type="button" onClick={openFriendPicker}>
              {selectedOpponent ? 'Changer d\'ami' : 'Choisir un ami'}
            </button>
          ) : null}
          {friendPickerOpen ? (
            <>
              <button className="friend-picker-backdrop" type="button" aria-label="Fermer la liste d'amis" onClick={closeFriendPicker} />
              <div className="card friend-picker-panel" role="dialog" aria-label="Choisir un ami">
                <div className="friend-picker-header">
                  <strong>Inviter un ami</strong>
                  <button type="button" aria-label="Fermer" onClick={closeFriendPicker}>x</button>
                </div>
                {friends.length ? (
                  friends.map((friend) => (
                    <button key={friend.id} type="button" disabled={action === `invite:${friend.id}`} onClick={() => void handleInvite(friend)}>
                      {friend.name}
                      <span>{friend.username ? `@${friend.username}` : 'ami Mayele'}</span>
                    </button>
                  ))
                ) : (
                  <p className="muted">Ajoutez d'abord un ami depuis la page Amis.</p>
                )}
              </div>
            </>
          ) : null}
        </article>
      </div>
      )}
    </section>
  )
}
