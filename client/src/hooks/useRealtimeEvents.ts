import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Socket } from 'socket.io-client'
import { ApiRequestError, type ChallengeMode, type MatchData, type NotificationData, type PresenceStatus, type TempoProgressData } from '../lib/api'
import { waitForAuthToken } from '../lib/authToken'
import { createClientCommandId } from '../lib/clientCommandId'
import type { SkillTag } from '../lib/game'
import { resolveRealtimeBase } from '../lib/runtimeConfig'

type TokenProvider = () => Promise<string | null>

export type RealtimePayload = {
  reason: string
  at: string
}

export type MatchRealtimePayload = RealtimePayload & {
  matchId: string
  status: string
  match?: MatchData
  roomEvent?: RoomRealtimeEvent
}

export type RoomRealtimeEvent = {
  roomId: string
  matchId: string
  eventId: string
  revision: number
  type: string
  reason: string
  serverTime: string
  match: MatchData
}

export type RoomSnapshotPayload = {
  roomId: string
  matchId: string
  revision: number
  serverTime: string
  match: MatchData
}

export type MatchTempoProgressPayload = RealtimePayload & {
  matchId: string
  questionIndex: number
  nextQuestionIndex: number
}

export type MatchTempoAnswerRecordedPayload = RealtimePayload & {
  matchId: string
  questionIndex: number
  playerId: string
  match: MatchData
}

export type NotificationsRealtimePayload = RealtimePayload & {
  notification?: NotificationData
}

export type PresenceRealtimePayload = RealtimePayload & {
  player: {
    id: string
    presenceStatus: PresenceStatus
    presenceUpdatedAt: string
  }
}

export type RealtimeConfigPayload = {
  game?: string | null
  level?: string | null
  practiceSkill?: SkillTag | null
  challengeMode?: ChallengeMode | null
  durationSeconds?: number
  questionCount?: number
  perQuestionTimeLimitSeconds?: number
  expectedConfigVersion?: number
}

export type RealtimeTempoAnswerPayload = {
  questionIndex: number
  prompt: string
  correctAnswer: number
  userAnswer: number | null
  responseTimeMs: number
  skill: SkillTag
  source: 'manual' | 'timeout'
}

export type RealtimeMatchResultPayload = {
  durationSeconds: number
  bestStreak: number
  answers: Array<{
    prompt: string
    correctAnswer: number
    userAnswer: number | null
    responseTimeMs: number
    skill: SkillTag
  }>
}

export type RealtimeMatchProgressPayload = {
  score: number
  scorePoints: number
  correctAnswers: number
  totalQuestions: number
  totalResponseTimeMs: number
  bestStreak: number
}

type RealtimeCommandResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; status: number; code: string | null } }

const REALTIME_CONNECT_GRACE_MS = 5_000
const REALTIME_FAST_COMMAND_TIMEOUT_MS = 4_000
const REALTIME_DEFAULT_COMMAND_TIMEOUT_MS = 12_000
const REALTIME_LONG_COMMAND_TIMEOUT_MS = 20_000

export function realtimeCommandTimeoutMs(eventName: string) {
  switch (eventName) {
    case 'room:join':
    case 'match:update-config':
    case 'match:update-progress':
    case 'match:submit-tempo-answer':
      return REALTIME_FAST_COMMAND_TIMEOUT_MS
    case 'match:submit-result':
      return REALTIME_LONG_COMMAND_TIMEOUT_MS
    default:
      return REALTIME_DEFAULT_COMMAND_TIMEOUT_MS
  }
}

type RealtimeHandlers = {
  onSocialChanged?: (payload: RealtimePayload) => void
  onPresenceChanged?: (payload: PresenceRealtimePayload) => void
  onMatchChanged?: (payload: MatchRealtimePayload) => void
  onRoomEvent?: (payload: RoomRealtimeEvent) => void
  onRoomSnapshot?: (payload: RoomSnapshotPayload) => void
  onMatchTempoProgress?: (payload: MatchTempoProgressPayload) => void
  onMatchTempoAnswerRecorded?: (payload: MatchTempoAnswerRecordedPayload) => void
  onNotificationsChanged?: (payload: NotificationsRealtimePayload) => void
  onConnectionError?: (error: unknown) => void
}

type UseRealtimeEventsOptions = RealtimeHandlers & {
  isAuthenticated: boolean
  getToken: TokenProvider
}

type ReadyWaiter = {
  resolve: (socket: Socket) => void
  reject: (error: unknown) => void
}

type RealtimeSubscriber = {
  handlersRef: { current: RealtimeHandlers }
  setIsRealtimeReady: (ready: boolean) => void
}

const realtimeSubscribers = new Set<RealtimeSubscriber>()
const realtimePresenceByPlayerId = new Map<string, PresenceRealtimePayload['player']>()
let sharedSocket: Socket | null = null
let sharedSocketReady = false
let sharedSocketConnecting = false
let sharedConnectionAttempt = 0
let sharedReadyWaiters: ReadyWaiter[] = []

function realtimeUrl() {
  return resolveRealtimeBase({
    configuredRealtimeBase: import.meta.env.VITE_REALTIME_URL,
    configuredApiBase: import.meta.env.VITE_API_URL,
    isProduction: import.meta.env.PROD,
  })
}

function realtimeUnavailableError() {
  return new ApiRequestError('Temps reel indisponible.', 0, 'realtime_unavailable')
}

function commitRealtimeUpdate(update: () => void) {
  flushSync(update)
}

function notifyRealtimeReady(ready: boolean) {
  sharedSocketReady = ready
  realtimeSubscribers.forEach((subscriber) => subscriber.setIsRealtimeReady(ready))
}

function resolveReadyWaiters(socket: Socket) {
  const waiters = sharedReadyWaiters
  sharedReadyWaiters = []
  waiters.forEach((waiter) => waiter.resolve(socket))
}

function rejectReadyWaiters(error: unknown) {
  const waiters = sharedReadyWaiters
  sharedReadyWaiters = []
  waiters.forEach((waiter) => waiter.reject(error))
}

function reportConnectionError(error: unknown) {
  realtimeSubscribers.forEach((subscriber) => subscriber.handlersRef.current.onConnectionError?.(error))
}

function dispatchRealtimeEvent<K extends keyof RealtimeHandlers>(
  handlerName: K,
  payload: Parameters<NonNullable<RealtimeHandlers[K]>>[0],
) {
  commitRealtimeUpdate(() => {
    realtimeSubscribers.forEach((subscriber) => {
      const handler = subscriber.handlersRef.current[handlerName] as ((value: typeof payload) => void) | undefined
      handler?.(payload)
    })
  })
}

function recordRealtimePresence(payload: PresenceRealtimePayload) {
  const current = realtimePresenceByPlayerId.get(payload.player.id)

  if (!current || Date.parse(current.presenceUpdatedAt) <= Date.parse(payload.player.presenceUpdatedAt)) {
    realtimePresenceByPlayerId.set(payload.player.id, payload.player)
  }

  dispatchRealtimeEvent('onPresenceChanged', payload)
}

export function getRealtimePresence(playerId: string) {
  return realtimePresenceByPlayerId.get(playerId) ?? null
}

function waitForReadySocket() {
  if (sharedSocket?.connected) {
    return Promise.resolve(sharedSocket)
  }

  return new Promise<Socket>((resolve, reject) => {
    const waiter: ReadyWaiter = {
      resolve: (readySocket) => {
        window.clearTimeout(timeout)
        resolve(readySocket)
      },
      reject: (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    }
    const timeout = window.setTimeout(() => {
      sharedReadyWaiters = sharedReadyWaiters.filter((item) => item !== waiter)
      reject(realtimeUnavailableError())
    }, REALTIME_CONNECT_GRACE_MS)

    sharedReadyWaiters = [...sharedReadyWaiters, waiter]
  })
}

function disconnectSharedSocket() {
  sharedConnectionAttempt += 1
  sharedSocketConnecting = false

  if (sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
  }

  notifyRealtimeReady(false)
  realtimePresenceByPlayerId.clear()
  rejectReadyWaiters(realtimeUnavailableError())
}

async function ensureRealtimeSocket(getToken: TokenProvider) {
  if (sharedSocket || sharedSocketConnecting) {
    return
  }

  sharedSocketConnecting = true
  const attempt = ++sharedConnectionAttempt

  try {
    const [module, token] = await Promise.all([import('socket.io-client'), waitForAuthToken(getToken)])

    if (attempt !== sharedConnectionAttempt) {
      return
    }

    if (!token) {
      const error = realtimeUnavailableError()
      rejectReadyWaiters(error)
      reportConnectionError(error)
      return
    }

    const socket = module.io(realtimeUrl(), {
      autoConnect: false,
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    })

    sharedSocket = socket
    socket.on('realtime:ready', () => {
      notifyRealtimeReady(true)
      ;(window as typeof window & { __mayeleRealtimeReadyAt?: number }).__mayeleRealtimeReadyAt = Date.now()
      window.dispatchEvent(new CustomEvent('mayele:realtime-ready'))
      resolveReadyWaiters(socket)
    })
    socket.on('connect_error', (error) => {
      notifyRealtimeReady(false)
      reportConnectionError(error)
    })
    socket.on('disconnect', () => {
      notifyRealtimeReady(false)
    })
    socket.on('social:changed', (payload: RealtimePayload) => dispatchRealtimeEvent('onSocialChanged', payload))
    socket.on('presence:changed', recordRealtimePresence)
    socket.on('match:changed', (payload: MatchRealtimePayload) => dispatchRealtimeEvent('onMatchChanged', payload))
    socket.on('room:event', (payload: RoomRealtimeEvent) => dispatchRealtimeEvent('onRoomEvent', payload))
    socket.on('room:snapshot', (payload: RoomSnapshotPayload) => dispatchRealtimeEvent('onRoomSnapshot', payload))
    socket.on('match:tempo-answer-recorded', (payload: MatchTempoAnswerRecordedPayload) => dispatchRealtimeEvent('onMatchTempoAnswerRecorded', payload))
    socket.on('match:tempo-progress', (payload: MatchTempoProgressPayload) => dispatchRealtimeEvent('onMatchTempoProgress', payload))
    socket.on('notifications:changed', (payload: NotificationsRealtimePayload) => dispatchRealtimeEvent('onNotificationsChanged', payload))
    socket.auth = { token }
    socket.connect()
  } catch (error) {
    if (attempt === sharedConnectionAttempt) {
      rejectReadyWaiters(error)
      reportConnectionError(error)
    }
  } finally {
    if (attempt === sharedConnectionAttempt) {
      sharedSocketConnecting = false
    }
  }
}

export function useRealtimeEvents({
  isAuthenticated,
  getToken,
  onSocialChanged,
  onPresenceChanged,
  onMatchChanged,
  onRoomEvent,
  onRoomSnapshot,
  onMatchTempoProgress,
  onMatchTempoAnswerRecorded,
  onNotificationsChanged,
  onConnectionError,
}: UseRealtimeEventsOptions) {
  const handlersRef = useRef<RealtimeHandlers>({})
  const subscriberRef = useRef<RealtimeSubscriber | null>(null)
  const [isRealtimeReady, setIsRealtimeReady] = useState(false)

  if (!subscriberRef.current) {
    subscriberRef.current = {
      handlersRef,
      setIsRealtimeReady,
    }
  }

  useEffect(() => {
    handlersRef.current = {
      onSocialChanged,
      onPresenceChanged,
      onMatchChanged,
      onRoomEvent,
      onRoomSnapshot,
      onMatchTempoProgress,
      onMatchTempoAnswerRecorded,
      onNotificationsChanged,
      onConnectionError,
    }
  }, [
    onConnectionError,
    onMatchTempoAnswerRecorded,
    onMatchTempoProgress,
    onMatchChanged,
    onNotificationsChanged,
    onPresenceChanged,
    onRoomEvent,
    onRoomSnapshot,
    onSocialChanged,
  ])

  useEffect(() => {
    if (!isAuthenticated) {
      if (subscriberRef.current) {
        realtimeSubscribers.delete(subscriberRef.current)
      }
      setIsRealtimeReady(false)
      return
    }

    const subscriber = subscriberRef.current!
    realtimeSubscribers.add(subscriber)
    setIsRealtimeReady(sharedSocketReady && Boolean(sharedSocket?.connected))
    void ensureRealtimeSocket(getToken)

    return () => {
      realtimeSubscribers.delete(subscriber)
      setIsRealtimeReady(false)

      if (realtimeSubscribers.size === 0) {
        disconnectSharedSocket()
      }
    }
  }, [getToken, isAuthenticated])

  const emitRealtimeCommand = useCallback(async <T,>(eventName: string, payload: unknown) => {
    let socket = sharedSocket

    if (!socket?.connected) {
      try {
        socket = await waitForReadySocket()
      } catch {
        throw realtimeUnavailableError()
      }
    }

    if (!socket.connected) {
      throw realtimeUnavailableError()
    }

    const commandPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload) && !('clientCommandId' in payload)
        ? { ...(payload as Record<string, unknown>), clientCommandId: createClientCommandId() }
        : payload

    return new Promise<T>((resolve, reject) => {
      socket.timeout(realtimeCommandTimeoutMs(eventName)).emit(
        eventName,
        commandPayload,
        (timeoutError: Error | null, response?: RealtimeCommandResponse<T>) => {
          if (timeoutError) {
            reject(new ApiRequestError('Commande temps reel expiree.', 0, 'realtime_timeout'))
            return
          }

          if (!response) {
            reject(new ApiRequestError('Reponse temps reel invalide.', 0, 'realtime_invalid_response'))
            return
          }

          if (!response.ok) {
            reject(new ApiRequestError(response.error.message, response.error.status, response.error.code))
            return
          }

          resolve(response.data)
        },
      )
    })
  }, [])

  const setPresenceActivity = useCallback((active: boolean) => {
    if (sharedSocket?.connected) {
      sharedSocket.emit('presence:activity', { active })
    }
  }, [])

  const updateMatchConfig = useCallback((matchId: string, config: RealtimeConfigPayload) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:update-config', { matchId, config })
  }, [emitRealtimeCommand])

  const createMatchInvitation = useCallback((payload: {
    opponentPlayerId: string
    game?: string
    level?: string
    practiceSkill?: SkillTag | null
    challengeMode?: ChallengeMode
    durationSeconds?: number
    questionCount?: number
    perQuestionTimeLimitSeconds?: number
  }) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:create-invitation', payload)
  }, [emitRealtimeCommand])

  const acceptMatchInvitation = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:accept-invitation', { matchId })
  }, [emitRealtimeCommand])

  const declineMatchInvitation = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:decline-invitation', { matchId })
  }, [emitRealtimeCommand])

  const proposeMatch = useCallback((matchId: string, config?: RealtimeConfigPayload) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:propose', config ? { matchId, config } : { matchId })
  }, [emitRealtimeCommand])

  const acceptMatchProposal = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:accept-proposal', { matchId })
  }, [emitRealtimeCommand])

  const declineMatchProposal = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:decline-proposal', { matchId })
  }, [emitRealtimeCommand])

  const requestMatchRematch = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:request-rematch', { matchId })
  }, [emitRealtimeCommand])

  const forfeitMatch = useCallback((matchId: string, progress?: RealtimeMatchProgressPayload) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:forfeit', progress ? { matchId, progress } : { matchId })
  }, [emitRealtimeCommand])

  const leaveMatch = useCallback((matchId: string) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:leave', { matchId })
  }, [emitRealtimeCommand])

  const submitTempoAnswer = useCallback((matchId: string, answer: RealtimeTempoAnswerPayload) => {
    return emitRealtimeCommand<{ match: MatchData; progress: TempoProgressData }>('match:submit-tempo-answer', { matchId, answer })
  }, [emitRealtimeCommand])

  const submitMatchResult = useCallback((matchId: string, result: RealtimeMatchResultPayload) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:submit-result', { matchId, result })
  }, [emitRealtimeCommand])

  const updateMatchProgress = useCallback((matchId: string, progress: RealtimeMatchProgressPayload) => {
    return emitRealtimeCommand<{ match: MatchData }>('match:update-progress', { matchId, progress })
  }, [emitRealtimeCommand])

  const joinRoom = useCallback((roomId: string, lastSeenEventId?: string | null) => {
    return emitRealtimeCommand<{ joined: true }>('room:join', { roomId, lastSeenEventId: lastSeenEventId ?? null })
  }, [emitRealtimeCommand])

  return {
    acceptMatchInvitation,
    acceptMatchProposal,
    createMatchInvitation,
    declineMatchInvitation,
    declineMatchProposal,
    forfeitMatch,
    isRealtimeReady,
    joinRoom,
    leaveMatch,
    proposeMatch,
    requestMatchRematch,
    submitMatchResult,
    submitTempoAnswer,
    setPresenceActivity,
    updateMatchProgress,
    updateMatchConfig,
  }
}
