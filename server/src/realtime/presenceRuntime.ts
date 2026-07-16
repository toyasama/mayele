import { presenceStatusForSockets, type PresenceStatus } from '../domain/presence.js'
import type { RealtimePublicPlayer } from './matchDrafts.js'

export const PRESENCE_ACTIVITY_MIN_INTERVAL_MS = 10_000
export const PRESENCE_HEARTBEAT_PERSIST_INTERVAL_MS = 60_000

export type PresenceTransition = {
  playerId: string
  player: RealtimePublicPlayer
  status: PresenceStatus
  shouldBroadcast: boolean
  shouldPersist: boolean
}

type ConnectedPlayer = {
  player: RealtimePublicPlayer
  socketIds: Set<string>
  activeSocketIds: Set<string>
  manuallyOffline: boolean
  lastActivityAtMs: number
  lastPersistedAtMs: number
}

function withPresence(player: RealtimePublicPlayer, status: PresenceStatus, now: number): RealtimePublicPlayer {
  return {
    ...player,
    presenceStatus: status,
    presenceUpdatedAt: new Date(now).toISOString(),
  }
}

export class PresenceRuntime {
  private readonly players = new Map<string, ConnectedPlayer>()

  connect(playerId: string, socketId: string, player: RealtimePublicPlayer, now = Date.now()) {
    const current = this.players.get(playerId) ?? {
      player,
      socketIds: new Set<string>(),
      activeSocketIds: new Set<string>(),
      manuallyOffline: false,
      lastActivityAtMs: 0,
      lastPersistedAtMs: 0,
    }

    current.socketIds.add(socketId)
    current.activeSocketIds.add(socketId)
    current.lastActivityAtMs = now
    this.players.set(playerId, current)

    return this.transition(playerId, current, now, true)
  }

  setActivity(playerId: string, socketId: string, active: boolean, now = Date.now()) {
    const current = this.players.get(playerId)

    if (!current || !current.socketIds.has(socketId)) {
      return null
    }

    const wasActive = current.activeSocketIds.has(socketId)

    if (active) {
      current.activeSocketIds.add(socketId)
    } else {
      current.activeSocketIds.delete(socketId)
    }

    const activityChanged = wasActive !== active
    if (active && !activityChanged && now - current.lastActivityAtMs < PRESENCE_ACTIVITY_MIN_INTERVAL_MS) {
      return null
    }

    if (active) {
      current.lastActivityAtMs = now
    }

    return this.transition(playerId, current, now, activityChanged)
  }

  setVisibility(playerId: string, visible: boolean, now = Date.now()) {
    const current = this.players.get(playerId)

    if (!current) {
      return null
    }

    const manuallyOffline = !visible
    if (current.manuallyOffline === manuallyOffline) {
      return null
    }

    current.manuallyOffline = manuallyOffline
    return this.transition(playerId, current, now, true)
  }

  disconnect(playerId: string, socketId: string, now = Date.now()) {
    const current = this.players.get(playerId)

    if (!current) {
      return null
    }

    current.socketIds.delete(socketId)
    current.activeSocketIds.delete(socketId)
    const transition = this.transition(playerId, current, now, true)

    if (current.socketIds.size === 0) {
      this.players.delete(playerId)
    }

    return transition
  }

  getConnectedPlayer(playerId: string) {
    const player = this.players.get(playerId)?.player
    return player && player.presenceStatus !== 'offline' ? player : null
  }

  isManuallyOffline(playerId: string) {
    return this.players.get(playerId)?.manuallyOffline ?? false
  }

  get onlinePlayerCount() {
    return [...this.players.values()].filter((player) => player.player.presenceStatus === 'online').length
  }

  clear() {
    this.players.clear()
  }

  private transition(playerId: string, current: ConnectedPlayer, now: number, activityChanged: boolean): PresenceTransition | null {
    const status = current.manuallyOffline
      ? 'offline'
      : presenceStatusForSockets(current.socketIds.size, current.activeSocketIds.size)
    const statusChanged = current.player.presenceStatus !== status
    const heartbeatDue = status === 'online' && now - current.lastPersistedAtMs >= PRESENCE_HEARTBEAT_PERSIST_INTERVAL_MS

    if (!statusChanged && !heartbeatDue) {
      return null
    }

    if (statusChanged || activityChanged || heartbeatDue) {
      current.player = withPresence(current.player, status, now)
    }

    if (statusChanged || heartbeatDue) {
      current.lastPersistedAtMs = now
    }

    return {
      playerId,
      player: current.player,
      status,
      shouldBroadcast: statusChanged,
      shouldPersist: statusChanged || heartbeatDue,
    }
  }
}
