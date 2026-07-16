import { describe, expect, it } from 'vitest'
import { PRESENCE_HEARTBEAT_PERSIST_INTERVAL_MS, PresenceRuntime } from './presenceRuntime.js'

const player = {
  id: 'player_1',
  name: 'Awa',
  username: 'awa',
  avatarUrl: null,
  totalXp: 120,
  presenceStatus: 'offline',
  presenceUpdatedAt: '2026-07-16T10:00:00.000Z',
}

describe('PresenceRuntime', () => {
  it('passe en ligne a la connexion et expose les joueurs connectes', () => {
    const runtime = new PresenceRuntime()
    const transition = runtime.connect(player.id, 'socket_1', player, 1_000)

    expect(transition).toMatchObject({ status: 'online', shouldBroadcast: true, shouldPersist: true })
    expect(runtime.getConnectedPlayer(player.id)).toMatchObject({ id: player.id, presenceStatus: 'online' })
    expect(runtime.onlinePlayerCount).toBe(1)
  })

  it('reste en ligne lorsqu un autre onglet est actif', () => {
    const runtime = new PresenceRuntime()
    runtime.connect(player.id, 'socket_1', player, 1_000)
    runtime.connect(player.id, 'socket_2', player, 1_001)

    const transition = runtime.setActivity(player.id, 'socket_1', false, 2_000)

    expect(transition).toBeNull()
    expect(runtime.getConnectedPlayer(player.id)).toMatchObject({ presenceStatus: 'online' })
  })

  it('passe absent lorsque tous les onglets sont masques, puis hors ligne a la derniere deconnexion', () => {
    const runtime = new PresenceRuntime()
    runtime.connect(player.id, 'socket_1', player, 1_000)

    expect(runtime.setActivity(player.id, 'socket_1', false, 2_000)).toMatchObject({ status: 'away', shouldBroadcast: true })
    expect(runtime.getConnectedPlayer(player.id)).toMatchObject({ presenceStatus: 'away' })
    expect(runtime.disconnect(player.id, 'socket_1', 3_000)).toMatchObject({ status: 'offline', shouldBroadcast: true })
    expect(runtime.getConnectedPlayer(player.id)).toBeNull()
    expect(runtime.onlinePlayerCount).toBe(0)
  })

  it('masque volontairement un joueur sans couper sa connexion puis redevient visible a la prochaine session', () => {
    const runtime = new PresenceRuntime()
    runtime.connect(player.id, 'socket_1', player, 1_000)

    expect(runtime.setVisibility(player.id, false, 2_000)).toMatchObject({
      status: 'offline',
      shouldBroadcast: true,
      shouldPersist: true,
    })
    expect(runtime.isManuallyOffline(player.id)).toBe(true)
    expect(runtime.getConnectedPlayer(player.id)).toBeNull()
    expect(runtime.onlinePlayerCount).toBe(0)

    expect(runtime.setVisibility(player.id, true, 3_000)).toMatchObject({ status: 'online', shouldBroadcast: true })
    expect(runtime.isManuallyOffline(player.id)).toBe(false)
    expect(runtime.getConnectedPlayer(player.id)).toMatchObject({ presenceStatus: 'online' })

    runtime.setVisibility(player.id, false, 4_000)
    runtime.disconnect(player.id, 'socket_1', 5_000)
    expect(runtime.connect(player.id, 'socket_2', player, 6_000)).toMatchObject({ status: 'online', shouldBroadcast: true })
    expect(runtime.isManuallyOffline(player.id)).toBe(false)
  })

  it('ignore les heartbeats rapproches et persiste periodiquement une activite durable', () => {
    const runtime = new PresenceRuntime()
    runtime.connect(player.id, 'socket_1', player, 1_000)

    expect(runtime.setActivity(player.id, 'socket_1', true, 2_000)).toBeNull()
    const transition = runtime.setActivity(player.id, 'socket_1', true, 1_000 + PRESENCE_HEARTBEAT_PERSIST_INTERVAL_MS)

    expect(transition).toMatchObject({
      status: 'online',
      shouldBroadcast: false,
      shouldPersist: true,
    })
    expect(transition?.player.presenceUpdatedAt).toBe(new Date(1_000 + PRESENCE_HEARTBEAT_PERSIST_INTERVAL_MS).toISOString())
  })
})
