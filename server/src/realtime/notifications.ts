import { verifyToken } from '@clerk/backend'
import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { env } from '../config/env.js'
import { isAllowedCorsOrigin } from '../config/origin.js'
import { ApiError } from '../errors.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { captureException } from '../lib/sentry.js'
import {
  parseRealtimeTempoAnswerCommand,
  type TempoAnswerPayload,
} from '../schemas/matchSchema.js'
import type { SerializedNotification } from '../services/notificationPresenter.js'
import {
  broadcastRoomEvent,
  clearRoomRuntimeState,
  findRoomEventByCommandId,
  joinSocketToRoom,
  observeRoomSnapshot,
  recordRoomEvent,
  type RoomRuntimeEvent,
} from './roomRuntime.js'
import {
  completeChallengeResult,
  MatchServiceError,
  persistTempoQuestionAnswer,
  type MatchView,
} from '../services/matchService.js'
import { serializeMatch, type SerializedMatch } from '../services/matchPresenter.js'
import {
  applyTempoAnswerProgressDraft,
  applyTempoFinalDraft,
  assertExpectedTempoAnswer,
  tempoExpectedPlayerIds,
  tempoProgressFromAnswers,
  tempoResultPayload,
  tempoTimeoutAnswer,
  type RealtimePublicPlayer,
} from './matchDrafts.js'
import { registerMatchCommandHandlers } from './matchCommandHandlers.js'

type RealtimeIdentity = {
  clerkUserId: string
  playerId: string
  player?: RealtimePublicPlayer
}

type RealtimeEventPayload = {
  reason: string
  at: string
}

type NotificationsChangedPayload = RealtimeEventPayload & {
  notification?: SerializedNotification
}

type MatchChangedPayload = RealtimeEventPayload & {
  matchId: string
  status: string
  match?: unknown
  roomEvent?: RoomRuntimeEvent
}

type MatchTempoProgressPayload = RealtimeEventPayload & {
  matchId: string
  questionIndex: number
  nextQuestionIndex: number
}
type MatchTempoAnswerRecordedPayload = RealtimeEventPayload & {
  matchId: string
  questionIndex: number
  playerId: string
  match: SerializedMatch
}

type RealtimeCommandAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; status: number; code: string | null } }

type MatchConfigCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchCreateInvitationCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchActionCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type MatchRematchCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
}>
type TempoAnswerProgress = {
  questionIndex: number
  answeredCount: number
  expectedAnswerCount: number
  complete: boolean
  nextQuestionIndex: number
}
type TempoQuestionRuntime = {
  questionIndex: number
  startedAtMs: number
  deadlineMs: number
  answers: Map<string, TempoAnswerPayload>
  resolved: boolean
  timeoutId: ReturnType<typeof setTimeout> | null
}
type TempoMatchRuntime = {
  matchId: string
  currentQuestionIndex: number
  questionCount: number
  perQuestionMs: number
  expectedPlayerIds: string[]
  questions: Map<number, TempoQuestionRuntime>
}
type MatchTempoAnswerCommandAck = RealtimeCommandAck<{
  match: SerializedMatch
  progress: TempoAnswerProgress
}>
type RealtimeCommandErrorPayload = Extract<RealtimeCommandAck<unknown>, { ok: false }>['error']

type InitRealtimeOptions = {
  authenticateToken?: (token: string) => Promise<RealtimeIdentity | null>
}

let io: Server | null = null
const matchSnapshotCache = new Map<string, SerializedMatch>()
const matchPersistenceQueue = new Map<string, Promise<unknown>>()
const tempoMatchRuntimes = new Map<string, TempoMatchRuntime>()
const onlinePlayers = new Map<string, { player: RealtimePublicPlayer; socketIds: Set<string> }>()
const MATCH_STATUS_ORDER: Record<string, number> = {
  pending: 10,
  accepted: 20,
  ready: 30,
  in_progress: 40,
  completed: 50,
  cancelled: 50,
  expired: 50,
}
const ACTIVE_REALTIME_HEARTBEAT_STATUSES = new Set(['pending', 'accepted', 'ready', 'in_progress'])
const TEMPO_TIMEOUT_GRACE_MS = 250
const REALTIME_RATE_WINDOW_MS = 60 * 1000
const REALTIME_DEFAULT_COMMAND_LIMIT = 180
const REALTIME_COMMAND_ACK_WARN_MS = 5_000
const REALTIME_COMMAND_EVENTS = new Set([
  'room:join',
  'match:update-config',
  'match:create-invitation',
  'match:accept-invitation',
  'match:decline-invitation',
  'match:propose',
  'match:decline-proposal',
  'match:accept-proposal',
  'match:forfeit',
  'match:request-rematch',
  'match:leave',
  'match:update-progress',
  'match:submit-result',
  'match:submit-tempo-answer',
])
const REALTIME_COMMAND_LIMITS: Record<string, number> = {
  'room:join': 120,
  'match:update-config': 120,
  'match:create-invitation': 30,
  'match:accept-invitation': 60,
  'match:decline-invitation': 60,
  'match:propose': 60,
  'match:decline-proposal': 60,
  'match:accept-proposal': 60,
  'match:forfeit': 30,
  'match:request-rematch': 30,
  'match:leave': 60,
  'match:update-progress': 240,
  'match:submit-result': 60,
  'match:submit-tempo-answer': 240,
}
const realtimeRateBuckets = new Map<string, { startedAtMs: number; count: number }>()

export function getRealtimeHealth() {
  return {
    initialized: Boolean(io),
    connectedSockets: io?.sockets.sockets.size ?? 0,
    onlinePlayers: onlinePlayers.size,
  }
}

function playerRoom(playerId: string) {
  return `player:${playerId}`
}

function isRealtimeCommandAllowed(playerId: string, eventName: string, now = Date.now()) {
  const limit = REALTIME_COMMAND_LIMITS[eventName] ?? REALTIME_DEFAULT_COMMAND_LIMIT
  const key = `${playerId}:${eventName}`
  const bucket = realtimeRateBuckets.get(key)

  if (!bucket || now - bucket.startedAtMs >= REALTIME_RATE_WINDOW_MS) {
    realtimeRateBuckets.set(key, { startedAtMs: now, count: 1 })
    return true
  }

  bucket.count += 1
  return bucket.count <= limit
}

function commandIdFromValue(value: unknown) {
  if (!value || typeof value !== 'object' || !('clientCommandId' in value)) {
    return null
  }

  const clientCommandId = (value as { clientCommandId?: unknown }).clientCommandId
  return typeof clientCommandId === 'string' && clientCommandId.trim() ? clientCommandId : null
}

function realtimeCommandError(message: string, status: number, code: string): RealtimeCommandAck<unknown> {
  return { ok: false, error: { message, status, code } }
}

function ackFromPacket(packet: unknown[]) {
  const maybeAck = packet.at(-1)
  return typeof maybeAck === 'function' ? maybeAck as (response: RealtimeCommandAck<unknown>) => void : null
}

function wrapRealtimeCommandAck(packet: unknown[], context: {
  playerId: string
  eventName: string
  commandId: string | null
  startedAtMs: number
}) {
  const ackIndex = packet.length - 1
  const originalAck = packet[ackIndex]

  if (typeof originalAck !== 'function') {
    return
  }

  let acked = false
  const warnTimeout = setTimeout(() => {
    if (acked) {
      return
    }

    logger.warn('realtime_command_ack_slow', {
      playerId: context.playerId,
      eventName: context.eventName,
      commandId: context.commandId,
      durationMs: Date.now() - context.startedAtMs,
    })
  }, REALTIME_COMMAND_ACK_WARN_MS)
  warnTimeout.unref()

  packet[ackIndex] = (response: RealtimeCommandAck<unknown>) => {
    if (acked) {
      return
    }

    acked = true
    clearTimeout(warnTimeout)
    const durationMs = Date.now() - context.startedAtMs
    const ok = Boolean(response?.ok)
    const error = ok ? null : (response as Extract<RealtimeCommandAck<unknown>, { ok: false }> | undefined)?.error

    logger[ok ? 'info' : 'warn']('realtime_command_ack', {
      playerId: context.playerId,
      eventName: context.eventName,
      commandId: context.commandId,
      durationMs,
      ok,
      status: error?.status,
      code: error?.code,
    })

    ;(originalAck as (response: RealtimeCommandAck<unknown>) => void)(response)
  }
}

function ackDuplicateMatchCommand(
  commandId: string | null,
  ack?: (response: RealtimeCommandAck<{ match: SerializedMatch }>) => void,
) {
  const event = findRoomEventByCommandId(commandId)

  if (!event) {
    return false
  }

  emitMatchChanged(event.match, event.reason, event.match, event)
  ack?.({ ok: true, data: { match: event.match } })
  return true
}

function serializeRealtimePlayer(player: {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  totalXp: number
  presenceStatus: string
  presenceUpdatedAt: Date
}): RealtimePublicPlayer {
  return {
    id: player.id,
    name: player.name,
    username: player.username,
    avatarUrl: player.avatarUrl,
    totalXp: player.totalXp,
    presenceStatus: player.presenceStatus,
    presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
  }
}

function rememberOnlinePlayer(playerId: string, socketId: string, player: RealtimePublicPlayer) {
  const current = onlinePlayers.get(playerId) ?? { player, socketIds: new Set<string>() }
  current.player = player
  current.socketIds.add(socketId)
  onlinePlayers.set(playerId, current)
}

function forgetOnlinePlayer(playerId: string, socketId: string) {
  const current = onlinePlayers.get(playerId)

  if (!current) {
    return
  }

  current.socketIds.delete(socketId)

  if (current.socketIds.size === 0) {
    onlinePlayers.delete(playerId)
  }
}

function isSerializedMatch(value: unknown): value is SerializedMatch {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'status' in value &&
    'participants' in value &&
    Array.isArray((value as { participants?: unknown }).participants),
  )
}

function tempoSnapshotIndex(snapshot: SerializedMatch) {
  return typeof snapshot.tempoQuestionIndex === 'number' ? snapshot.tempoQuestionIndex : null
}

function isOlderSerializedMatchSnapshot(current: SerializedMatch | null | undefined, next: SerializedMatch) {
  if (!current || current.id !== next.id) {
    return false
  }

  const currentStatusOrder = MATCH_STATUS_ORDER[current.status] ?? 0
  const nextStatusOrder = MATCH_STATUS_ORDER[next.status] ?? 0

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

  if (nextStatusOrder !== currentStatusOrder) {
    return false
  }

  if (current.status === 'in_progress' && next.status === 'in_progress' && current.challengeMode === 'tempo' && next.challengeMode === 'tempo') {
    const currentTempoIndex = tempoSnapshotIndex(current)
    const nextTempoIndex = tempoSnapshotIndex(next)

    if (currentTempoIndex !== null && nextTempoIndex !== null && nextTempoIndex < currentTempoIndex) {
      return true
    }
  }

  return false
}

function cacheMatchSnapshot(snapshot: unknown) {
  if (!isSerializedMatch(snapshot)) {
    return false
  }

  const current = matchSnapshotCache.get(snapshot.id)

  if (isOlderSerializedMatchSnapshot(current, snapshot)) {
    return false
  }

  matchSnapshotCache.set(snapshot.id, snapshot)
  observeRoomSnapshot(snapshot)

  if (snapshot.status === 'in_progress' && snapshot.challengeMode === 'tempo') {
    ensureTempoRuntime(snapshot)
  } else {
    clearTempoAnswerState(snapshot.id)
  }

  return true
}

function materializeRealtimeSnapshot(snapshot: SerializedMatch) {
  const firstPassSnapshot = snapshotWithTempoRuntime(snapshotWithFreshServerNow(snapshot))

  if (!cacheMatchSnapshot(firstPassSnapshot)) {
    return null
  }

  const cachedSnapshot = matchSnapshotCache.get(snapshot.id) ?? firstPassSnapshot
  const realtimeSnapshot = snapshotWithTempoRuntime(snapshotWithFreshServerNow(cachedSnapshot))

  if (!cacheMatchSnapshot(realtimeSnapshot)) {
    return null
  }

  return realtimeSnapshot
}

function publishMatchSnapshot(snapshot: SerializedMatch, reason: string) {
  const realtimeSnapshot = materializeRealtimeSnapshot(snapshot)

  if (!realtimeSnapshot) {
    return
  }

  emitMatchChanged(realtimeSnapshot, reason, realtimeSnapshot)
}

function publishMatchRuntimeEvent(snapshot: SerializedMatch, reason: string, commandId?: string | null) {
  const realtimeSnapshot = materializeRealtimeSnapshot(snapshot)

  if (!realtimeSnapshot) {
    return null
  }

  const event = recordRoomEvent(realtimeSnapshot, reason, commandId)
  emitMatchChanged(event.match, event.reason, event.match, event)
  return event
}

function snapshotWithFreshServerNow(snapshot: SerializedMatch): SerializedMatch {
  return { ...snapshot, serverNow: new Date().toISOString() }
}

function snapshotWithTempoRuntime(snapshot: SerializedMatch): SerializedMatch {
  const runtime = tempoMatchRuntimes.get(snapshot.id)

  if (!runtime || snapshot.status !== 'in_progress' || snapshot.challengeMode !== 'tempo') {
    return snapshot
  }

  const question = runtime.questions.get(runtime.currentQuestionIndex)

  return {
    ...snapshot,
    tempoQuestionIndex: runtime.currentQuestionIndex,
    tempoQuestionStartedAt: question ? new Date(question.startedAtMs).toISOString() : null,
  }
}

function clearTempoAnswerState(matchId: string) {
  const runtime = tempoMatchRuntimes.get(matchId)

  if (!runtime) {
    return
  }

  for (const question of runtime.questions.values()) {
    if (question.timeoutId) {
      clearTimeout(question.timeoutId)
    }
  }

  tempoMatchRuntimes.delete(matchId)
}

function ensureTempoRuntime(snapshot: SerializedMatch) {
  const existing = tempoMatchRuntimes.get(snapshot.id)

  if (existing) {
    return existing
  }

  if (
    snapshot.status !== 'in_progress' ||
    snapshot.challengeMode !== 'tempo' ||
    !snapshot.questionSeed ||
    !snapshot.questionCount ||
    !snapshot.perQuestionTimeLimitSeconds ||
    !snapshot.startedAt
  ) {
    throw new MatchServiceError('match_not_in_progress')
  }

  const runtime: TempoMatchRuntime = {
    matchId: snapshot.id,
    currentQuestionIndex: 0,
    questionCount: snapshot.questionCount,
    perQuestionMs: snapshot.perQuestionTimeLimitSeconds * 1000,
    expectedPlayerIds: tempoExpectedPlayerIds(snapshot),
    questions: new Map(),
  }

  tempoMatchRuntimes.set(snapshot.id, runtime)
  ensureTempoQuestionRuntime(runtime, 0, new Date(snapshot.startedAt).getTime(), snapshot)
  return runtime
}

function ensureTempoQuestionRuntime(
  runtime: TempoMatchRuntime,
  questionIndex: number,
  startedAtMs: number,
  snapshot: SerializedMatch,
) {
  const existing = runtime.questions.get(questionIndex)

  if (existing) {
    return existing
  }

  const question: TempoQuestionRuntime = {
    questionIndex,
    startedAtMs,
    deadlineMs: startedAtMs + runtime.perQuestionMs,
    answers: new Map(),
    resolved: false,
    timeoutId: null,
  }

  runtime.questions.set(questionIndex, question)
  scheduleTempoTimeout(runtime, question, snapshot)
  return question
}

function tempoQuestionProgress(runtime: TempoMatchRuntime, question: TempoQuestionRuntime): TempoAnswerProgress {
  const answeredCount = question.answers.size
  const expectedAnswerCount = runtime.expectedPlayerIds.length

  return {
    questionIndex: question.questionIndex,
    answeredCount,
    expectedAnswerCount,
    complete: expectedAnswerCount > 0 && answeredCount >= expectedAnswerCount,
    nextQuestionIndex: question.questionIndex + 1,
  }
}

function persistTempoQuestionAnswerInBackground(matchId: string, playerId: string, answer: TempoAnswerPayload) {
  void enqueueMatchPersistence(matchId, () =>
    persistTempoQuestionAnswer(playerId, matchId, answer),
  ).catch((error) => {
    logger.error('Persistance reponse tempo impossible.', {
      matchId,
      playerId,
      questionIndex: answer.questionIndex,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

function persistTempoFinalResultsInBackground(snapshot: SerializedMatch, runtime: TempoMatchRuntime) {
  void enqueueMatchPersistence(snapshot.id, async () => {
    let latest: MatchView | null = null

    for (const playerId of runtime.expectedPlayerIds) {
      latest = await completeChallengeResult(playerId, snapshot.id, tempoResultPayload(snapshot, runtime, playerId))
    }

    if (!latest) {
      throw new MatchServiceError('match_not_found')
    }

    return latest
  }).then((match) => {
    const persistedSnapshot = serializeMatch(match as MatchView)

    if (persistedSnapshot.status === 'completed') {
      publishMatchRuntimeEvent(persistedSnapshot, 'match_completed_persisted')
    }
  }).catch((error) => {
    logger.error('Persistance resultat tempo impossible.', {
      matchId: snapshot.id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

function resolveTempoQuestion(runtime: TempoMatchRuntime, snapshot: SerializedMatch, question: TempoQuestionRuntime, reason: string) {
  if (question.resolved) {
    return snapshot
  }

  question.resolved = true

  if (question.timeoutId) {
    clearTimeout(question.timeoutId)
    question.timeoutId = null
  }

  const progress = tempoQuestionProgress(runtime, question)
  emitMatchTempoProgress(snapshot, progress, reason)

  if (question.questionIndex + 1 >= runtime.questionCount) {
    const finalSnapshot = applyTempoFinalDraft(snapshot, runtime)

    publishMatchRuntimeEvent(finalSnapshot, 'match_completed')
    clearTempoAnswerState(runtime.matchId)
    persistTempoFinalResultsInBackground(finalSnapshot, runtime)
    return finalSnapshot
  }

  runtime.currentQuestionIndex = question.questionIndex + 1
  ensureTempoQuestionRuntime(runtime, runtime.currentQuestionIndex, Date.now(), snapshot)
  return snapshotWithFreshServerNow(snapshot)
}

function scheduleTempoTimeout(runtime: TempoMatchRuntime, question: TempoQuestionRuntime, snapshot: SerializedMatch) {
  if (question.timeoutId || question.resolved) {
    return
  }

  const delayMs = Math.max(0, question.deadlineMs + TEMPO_TIMEOUT_GRACE_MS - Date.now())

  question.timeoutId = setTimeout(() => {
    const latestSnapshot = matchSnapshotCache.get(runtime.matchId)

    if (!latestSnapshot || latestSnapshot.status !== 'in_progress' || latestSnapshot.challengeMode !== 'tempo') {
      return
    }

    const latestRuntime = tempoMatchRuntimes.get(runtime.matchId)
    const latestQuestion = latestRuntime?.questions.get(question.questionIndex)

    if (!latestRuntime || !latestQuestion || latestQuestion.resolved) {
      return
    }

    let draftSnapshot = latestSnapshot
    const timeoutResponseTimeMs = Math.min(latestRuntime.perQuestionMs, Math.max(0, Date.now() - latestQuestion.startedAtMs))

    for (const playerId of latestRuntime.expectedPlayerIds) {
      if (latestQuestion.answers.has(playerId)) {
        continue
      }

      const answer = tempoTimeoutAnswer(latestSnapshot, latestQuestion.questionIndex, timeoutResponseTimeMs)
      latestQuestion.answers.set(playerId, answer)
      draftSnapshot = applyTempoAnswerProgressDraft(draftSnapshot, latestRuntime, playerId)
      persistTempoQuestionAnswerInBackground(latestSnapshot.id, playerId, answer)
      emitMatchTempoAnswerRecorded(draftSnapshot, latestQuestion.questionIndex, playerId, 'match_tempo_timeout_recorded')
    }

    publishMatchRuntimeEvent(draftSnapshot, 'match_tempo_timeout_recorded')
    resolveTempoQuestion(latestRuntime, draftSnapshot, latestQuestion, 'match_tempo_question_timeout')
  }, delayMs)
}

function recordRealtimeTempoAnswer(snapshot: SerializedMatch, playerId: string, answer: TempoAnswerPayload) {
  assertExpectedTempoAnswer(snapshot, playerId, answer)
  const runtime = ensureTempoRuntime(snapshot)
  const currentQuestion = runtime.questions.get(runtime.currentQuestionIndex)
  const requestedQuestion = runtime.questions.get(answer.questionIndex)
  const existingAnswer = requestedQuestion?.answers.get(playerId)

  if (existingAnswer && requestedQuestion) {
    return {
      snapshot: snapshotWithFreshServerNow(snapshot),
      answer: existingAnswer,
      progress: tempoQuestionProgress(runtime, requestedQuestion),
      isDuplicate: true,
      shouldResolve: false,
      question: requestedQuestion,
    }
  }

  if (!currentQuestion || answer.questionIndex !== runtime.currentQuestionIndex) {
    throw new MatchServiceError('match_result_invalid')
  }

  currentQuestion.answers.set(playerId, answer)
  const draftSnapshot = applyTempoAnswerProgressDraft(snapshot, runtime, playerId)
  const progress = tempoQuestionProgress(runtime, currentQuestion)

  return {
    snapshot: draftSnapshot,
    answer,
    progress,
    isDuplicate: false,
    shouldResolve: progress.complete,
    question: currentQuestion,
  }
}

function enqueueMatchPersistence(matchId: string, persist: () => Promise<unknown>) {
  const previous = matchPersistenceQueue.get(matchId) ?? Promise.resolve()
  const next = previous.then(persist, persist).finally(() => {
    if (matchPersistenceQueue.get(matchId) === next) {
      matchPersistenceQueue.delete(matchId)
    }
  })

  matchPersistenceQueue.set(matchId, next)
  return next
}

function persistMatchSnapshotInBackground(
  matchId: string,
  persist: () => Promise<MatchView>,
  context: Record<string, unknown>,
  onPersisted?: (snapshot: SerializedMatch) => void,
) {
  const startedAtMs = Date.now()
  void enqueueMatchPersistence(matchId, persist)
    .then((match) => {
      const snapshot = serializeMatch(match as MatchView)
      cacheMatchSnapshot(snapshot)
      onPersisted?.(snapshot)
      logger.info('realtime_persistence_completed', {
        ...context,
        matchId,
        durationMs: Date.now() - startedAtMs,
        status: snapshot.status,
      })
    })
    .catch((error) => {
      logger.error('Persistance salon multijoueur impossible.', {
        ...context,
        matchId,
        durationMs: Date.now() - startedAtMs,
        message: error instanceof Error ? error.message : String(error),
      })
    })
}

export async function waitForRealtimePersistenceIdle() {
  while (matchPersistenceQueue.size > 0) {
    await Promise.allSettled(Array.from(matchPersistenceQueue.values()))
  }
}

export function getPendingRealtimeHeartbeatSnapshot(playerId: string, matchId: string) {
  const snapshot = matchSnapshotCache.get(matchId)

  if (!snapshot || !matchPersistenceQueue.has(matchId)) {
    return null
  }

  if (
    snapshot.createdBy.id !== playerId ||
    !ACTIVE_REALTIME_HEARTBEAT_STATUSES.has(snapshot.status) ||
    !snapshot.participants.some((participant) => participant.player.id === playerId)
  ) {
    return null
  }

  const heartbeatAt = new Date().toISOString()
  const refreshedSnapshot = snapshotWithTempoRuntime(snapshotWithFreshServerNow({
    ...snapshot,
    hostActiveAt: heartbeatAt,
  }))
  cacheMatchSnapshot(refreshedSnapshot)

  return refreshedSnapshot
}

export async function resetRealtimeStateForTests() {
  await waitForRealtimePersistenceIdle()
  matchSnapshotCache.clear()
  clearRoomRuntimeState()
  for (const runtime of tempoMatchRuntimes.values()) {
    for (const question of runtime.questions.values()) {
      if (question.timeoutId) {
        clearTimeout(question.timeoutId)
      }
    }
  }
  tempoMatchRuntimes.clear()
  onlinePlayers.clear()
  io?.sockets.sockets.forEach((socket) => {
    socket.disconnect(true)
  })
}

function isAllowedOrigin(origin: string | undefined) {
  return isAllowedCorsOrigin(origin, { isProduction: env.isProduction, allowedOrigins: env.corsOrigins })
}

function requestTransportName(requestUrl: string | undefined) {
  if (!requestUrl) {
    return null
  }

  try {
    return new URL(requestUrl, 'http://localhost').searchParams.get('transport')
  } catch {
    return null
  }
}

async function authenticateToken(token: string): Promise<RealtimeIdentity | null> {
  if (!env.isProduction && env.e2eAuthBypass && token.startsWith('e2e:')) {
    const clerkUserId = token.slice('e2e:'.length).trim()

    if (!/^e2e-[a-z0-9-]+$/i.test(clerkUserId)) {
      return null
    }

    const player = await prisma.player.findUnique({
      where: { clerkUserId },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        totalXp: true,
        presenceStatus: true,
        presenceUpdatedAt: true,
      },
    })

    return player ? { clerkUserId, playerId: player.id, player: serializeRealtimePlayer(player) } : null
  }

  const claims = await verifyToken(token, { secretKey: env.clerkSecretKey })
  const clerkUserId = claims.sub

  if (!clerkUserId) {
    return null
  }

  const player = await prisma.player.findUnique({
    where: { clerkUserId },
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      totalXp: true,
      presenceStatus: true,
      presenceUpdatedAt: true,
    },
  })

  if (!player) {
    return null
  }

  return { clerkUserId, playerId: player.id, player: serializeRealtimePlayer(player) }
}

function tokenFromSocket(socket: Socket) {
  const token = socket.handshake.auth?.token
  return typeof token === 'string' && token.trim() ? token : null
}

function matchServiceErrorToCommandError(error: MatchServiceError) {
  switch (error.code) {
    case 'match_not_found':
      return { message: 'Ressource introuvable.', status: 404, code: error.code }
    case 'match_not_participant':
    case 'match_not_owned':
      return { message: 'Action non autorisee pour ce salon.', status: 403, code: error.code }
    case 'match_version_conflict':
      return { message: 'La configuration du salon a change. Synchronisation en cours.', status: 409, code: error.code }
    default:
      return { message: "Ce defi n'est plus disponible.", status: 409, code: error.code }
  }
}

function commandError(error: unknown): RealtimeCommandErrorPayload {
  if (error instanceof MatchServiceError) {
    return matchServiceErrorToCommandError(error)
  }

  if (error instanceof ApiError) {
    return { message: error.message, status: error.statusCode, code: error.code }
  }

  logger.error('Erreur commande temps reel.', {
    message: error instanceof Error ? error.message : String(error),
  })
  captureException(error)

  return { message: 'Commande temps reel impossible.', status: 500, code: 'realtime_command_failed' }
}

function ackError<T>(ack: ((response: RealtimeCommandAck<T>) => void) | undefined, error: unknown) {
  ack?.({ ok: false, error: commandError(error) })
}

export function initRealtime(httpServer: HttpServer, options: InitRealtimeOptions = {}) {
  io?.close()
  matchSnapshotCache.clear()
  matchPersistenceQueue.clear()
  realtimeRateBuckets.clear()
  for (const runtime of tempoMatchRuntimes.values()) {
    for (const question of runtime.questions.values()) {
      if (question.timeoutId) {
        clearTimeout(question.timeoutId)
      }
    }
  }
  tempoMatchRuntimes.clear()
  onlinePlayers.clear()

  const socketServer = new Server(httpServer, {
    allowRequest: (request, callback) => {
      const origin = request.headers.origin
      const allowed = isAllowedOrigin(origin)

      if (!allowed) {
        logger.warn('realtime_origin_denied', {
          origin,
          transport: requestTransportName(request.url),
        })
      }

      callback(null, allowed)
    },
    cors: {
      origin: (origin, callback) => {
        const allowed = isAllowedOrigin(origin)

        if (!allowed) {
          logger.warn('realtime_cors_denied', { origin })
        }

        callback(null, allowed)
      },
      methods: ['GET', 'POST'],
    },
  })

  const resolveIdentity = options.authenticateToken ?? authenticateToken

  socketServer.use(async (socket, next) => {
    try {
      const token = tokenFromSocket(socket)

      if (!token) {
        logger.warn('realtime_auth_failed', {
          reason: 'missing_token',
          origin: socket.handshake.headers.origin,
          transport: socket.conn.transport.name,
        })
        next(new Error('unauthorized'))
        return
      }

      const identity = await resolveIdentity(token)

      if (!identity) {
        logger.warn('realtime_auth_failed', {
          reason: 'invalid_token_or_player',
          origin: socket.handshake.headers.origin,
          transport: socket.conn.transport.name,
        })
        next(new Error('unauthorized'))
        return
      }

      socket.data.clerkUserId = identity.clerkUserId
      socket.data.playerId = identity.playerId
      socket.data.publicPlayer = identity.player
      next()
    } catch (error) {
      logger.warn('realtime_auth_failed', {
        reason: 'auth_exception',
        origin: socket.handshake.headers.origin,
        transport: socket.conn.transport.name,
        message: error instanceof Error ? error.message : String(error),
      })
      next(new Error('unauthorized'))
    }
  })

  socketServer.on('connection', (socket) => {
    const playerId = socket.data.playerId as string | undefined

    if (!playerId) {
      socket.disconnect(true)
      return
    }

    if (socket.data.publicPlayer) {
      rememberOnlinePlayer(playerId, socket.id, socket.data.publicPlayer as RealtimePublicPlayer)
    }

    logger.info('realtime_connected', {
      playerId,
      socketId: socket.id,
      origin: socket.handshake.headers.origin,
      transport: socket.conn.transport.name,
    })

    socket.join(playerRoom(playerId))
    socket.emit('realtime:ready', { playerId, at: new Date().toISOString() })
    socket.use((packet, next) => {
      const eventName = packet[0]

      if (typeof eventName !== 'string' || !REALTIME_COMMAND_EVENTS.has(eventName)) {
        next()
        return
      }

      const commandId = commandIdFromValue(packet[1])
      const startedAtMs = Date.now()
      logger.info('realtime_command_received', {
        playerId,
        eventName,
        commandId,
      })

      if (isRealtimeCommandAllowed(playerId, eventName, startedAtMs)) {
        wrapRealtimeCommandAck(packet, { playerId, eventName, commandId, startedAtMs })
        next()
        return
      }

      logger.warn('realtime_rate_limited', { playerId, eventName, commandId })
      ackFromPacket(packet)?.(realtimeCommandError('Trop de commandes temps reel. Reessayez dans un instant.', 429, 'realtime_rate_limited'))
      next(new Error('rate_limit_exceeded'))
    })
    socket.on('disconnect', (reason) => {
      forgetOnlinePlayer(playerId, socket.id)
      logger.info('realtime_disconnected', {
        playerId,
        socketId: socket.id,
        reason,
      })
    })

    socket.on('room:join', (value: unknown, ack?: (response: RealtimeCommandAck<{ joined: true }>) => void) => {
      try {
        if (!value || typeof value !== 'object' || !('roomId' in value)) {
          throw new MatchServiceError('match_not_found')
        }

        const roomId = (value as { roomId?: unknown }).roomId
        const lastSeenEventId = (value as { lastSeenEventId?: unknown }).lastSeenEventId

        if (typeof roomId !== 'string' || !roomId) {
          throw new MatchServiceError('match_not_found')
        }

        joinSocketToRoom(socket, roomId, typeof lastSeenEventId === 'string' ? lastSeenEventId : null)
        ack?.({ ok: true, data: { joined: true } })
      } catch (error) {
        ackError(ack, error)
      }
    })

    registerMatchCommandHandlers(socket, {
      playerId,
      publicPlayer: socket.data.publicPlayer as RealtimePublicPlayer | undefined,
      getOnlinePlayer: (targetPlayerId) => onlinePlayers.get(targetPlayerId)?.player ?? null,
      getCachedMatch: (matchId) => matchSnapshotCache.get(matchId) ?? null,
      deleteCachedMatch: (matchId) => {
        matchSnapshotCache.delete(matchId)
      },
      commandIdFromValue,
      ackDuplicateMatchCommand,
      ackError,
      publishMatchRuntimeEvent,
      publishMatchSnapshot,
      persistMatchSnapshotInBackground,
      emitMatchChanged,
      emitNotificationsChanged,
      emitNotificationCreated,
    })
    socket.on('match:submit-tempo-answer', async (value: unknown, ack?: (response: MatchTempoAnswerCommandAck) => void) => {
      try {
        const command = parseRealtimeTempoAnswerCommand(value)
        const commandId = commandIdFromValue(value)
        const cachedMatch = matchSnapshotCache.get(command.matchId)

        if (!cachedMatch) {
          throw new MatchServiceError('match_not_found')
        }

        const result = recordRealtimeTempoAnswer(cachedMatch, playerId, command.answer)
        let ackSnapshot = result.snapshot

        if (!result.isDuplicate) {
          publishMatchRuntimeEvent(result.snapshot, 'match_tempo_answer_recorded', commandId)
          emitMatchTempoAnswerRecorded(result.snapshot, result.answer.questionIndex, playerId, 'match_tempo_answer_recorded')
          persistTempoQuestionAnswerInBackground(command.matchId, playerId, result.answer)

          if (result.shouldResolve && result.question) {
            ackSnapshot = resolveTempoQuestion(ensureTempoRuntime(result.snapshot), result.snapshot, result.question, 'match_tempo_question_completed')
          }
        }

        ack?.({ ok: true, data: { match: snapshotWithTempoRuntime(snapshotWithFreshServerNow(ackSnapshot)), progress: result.progress } })
      } catch (error) {
        ackError(ack, error)
      }
    })
  })

  io = socketServer
  logger.info('Realtime Socket.IO initialisé.')
  return socketServer
}

export function emitSocialChanged(playerIds: string[], reason: string) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const payload: RealtimeEventPayload = { reason, at: new Date().toISOString() }

  for (const playerId of new Set(playerIds)) {
    socketServer.to(playerRoom(playerId)).emit('social:changed', payload)
  }
}

export function emitPresenceChanged(playerIds: string[], reason: string) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const payload: RealtimeEventPayload = { reason, at: new Date().toISOString() }

  for (const playerId of new Set(playerIds)) {
    socketServer.to(playerRoom(playerId)).emit('presence:changed', payload)
  }
}

export function emitNotificationsChanged(playerIds: string[], reason: string) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const payload: RealtimeEventPayload = { reason, at: new Date().toISOString() }

  for (const playerId of new Set(playerIds)) {
    socketServer.to(playerRoom(playerId)).emit('notifications:changed', payload)
  }
}

export function emitNotificationCreated(playerId: string, reason: string, notification: SerializedNotification) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const payload: NotificationsChangedPayload = {
    reason,
    at: new Date().toISOString(),
    notification,
  }

  socketServer.to(playerRoom(playerId)).emit('notifications:changed', payload)
}

export function emitMatchChanged(
  match: { id: string; status: string; participants: Array<{ player: { id: string } }> },
  reason: string,
  snapshot?: unknown,
  roomEvent?: RoomRuntimeEvent,
) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  if (isSerializedMatch(snapshot) && !cacheMatchSnapshot(snapshot)) {
    return
  }

  const playerIds = match.participants.map((participant) => participant.player.id)

  if (roomEvent) {
    broadcastRoomEvent(socketServer, roomEvent, playerIds, playerRoom)
  }

  const payload: MatchChangedPayload = {
    matchId: match.id,
    status: match.status,
    match: snapshot,
    roomEvent,
    reason,
    at: new Date().toISOString(),
  }

  for (const playerId of playerIds) {
    socketServer.to(playerRoom(playerId)).emit('match:changed', payload)
  }
}

export function emitMatchSnapshot(match: MatchView, reason: string) {
  publishMatchRuntimeEvent(serializeMatch(match), reason)
}

export function emitMatchTempoProgress(
  match: { id: string; participants: Array<{ player: { id: string } }> },
  progress: Pick<MatchTempoProgressPayload, 'questionIndex' | 'nextQuestionIndex'>,
  reason: string,
) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const payload: MatchTempoProgressPayload = {
    matchId: match.id,
    questionIndex: progress.questionIndex,
    nextQuestionIndex: progress.nextQuestionIndex,
    reason,
    at: new Date().toISOString(),
  }

  for (const participant of match.participants) {
    socketServer.to(playerRoom(participant.player.id)).emit('match:tempo-progress', payload)
  }
}

export function emitMatchTempoAnswerRecorded(
  match: SerializedMatch,
  questionIndex: number,
  playerId: string,
  reason: string,
) {
  const socketServer = io

  if (!socketServer) {
    return
  }

  const realtimeMatch = snapshotWithTempoRuntime(snapshotWithFreshServerNow(match))
  const payload: MatchTempoAnswerRecordedPayload = {
    matchId: realtimeMatch.id,
    questionIndex,
    playerId,
    match: realtimeMatch,
    reason,
    at: new Date().toISOString(),
  }

  for (const participant of realtimeMatch.participants) {
    socketServer.to(playerRoom(participant.player.id)).emit('match:tempo-answer-recorded', payload)
  }
}

export function closeRealtime() {
  io?.close()
  io = null
  matchSnapshotCache.clear()
  matchPersistenceQueue.clear()
  for (const runtime of tempoMatchRuntimes.values()) {
    for (const question of runtime.questions.values()) {
      if (question.timeoutId) {
        clearTimeout(question.timeoutId)
      }
    }
  }
  tempoMatchRuntimes.clear()
  onlinePlayers.clear()
  realtimeRateBuckets.clear()
  clearRoomRuntimeState()
}
