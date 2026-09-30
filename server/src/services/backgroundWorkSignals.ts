export type BackgroundWorkKind =
  | 'bot-match'
  | 'match-expiration'
  | 'matchmaking'
  | 'outbox'
  | 'solo-run-expiration'
  | 'tempo-match'

type Listener = () => void
type SignalTransport = (kinds: BackgroundWorkKind[]) => void

const PUBLISH_DEBOUNCE_MS = 10
const BACKGROUND_WORK_KINDS = new Set<BackgroundWorkKind>([
  'bot-match',
  'match-expiration',
  'matchmaking',
  'outbox',
  'solo-run-expiration',
  'tempo-match',
])
const listeners = new Map<BackgroundWorkKind, Set<Listener>>()
const pendingPublications = new Set<BackgroundWorkKind>()
let transport: SignalTransport | null = null
let publishTimer: NodeJS.Timeout | null = null

function emitLocal(kind: BackgroundWorkKind) {
  for (const listener of listeners.get(kind) ?? []) listener()
}

function flushPublications() {
  if (!transport || pendingPublications.size === 0) return
  const kinds = [...pendingPublications]
  pendingPublications.clear()
  transport(kinds)
}

function schedulePublication() {
  if (!transport || publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    flushPublications()
  }, PUBLISH_DEBOUNCE_MS)
  publishTimer.unref()
}

export function subscribeToBackgroundWork(kind: BackgroundWorkKind, listener: Listener) {
  const kindListeners = listeners.get(kind) ?? new Set<Listener>()
  kindListeners.add(listener)
  listeners.set(kind, kindListeners)

  return () => {
    kindListeners.delete(listener)
    if (kindListeners.size === 0) listeners.delete(kind)
  }
}

export function signalBackgroundWork(kind: BackgroundWorkKind) {
  emitLocal(kind)
  publishBackgroundWork(kind)
}

export function publishBackgroundWork(kind: BackgroundWorkKind) {
  if (!transport) return
  pendingPublications.add(kind)
  schedulePublication()
}

export function receiveBackgroundWorkSignals(kinds: unknown) {
  if (!Array.isArray(kinds)) return
  for (const kind of kinds) {
    if (typeof kind === 'string' && BACKGROUND_WORK_KINDS.has(kind as BackgroundWorkKind)) {
      emitLocal(kind as BackgroundWorkKind)
    }
  }
}

export function registerBackgroundWorkSignalTransport(nextTransport: SignalTransport) {
  transport = nextTransport
  if (pendingPublications.size > 0) schedulePublication()
  return () => {
    if (transport !== nextTransport) return
    transport = null
    pendingPublications.clear()
    if (publishTimer) clearTimeout(publishTimer)
    publishTimer = null
  }
}

export function getBackgroundWorkSignalBridgeHealth() {
  return {
    started: Boolean(transport),
    connected: Boolean(transport),
    pendingKinds: pendingPublications.size,
  }
}
