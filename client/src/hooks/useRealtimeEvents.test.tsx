import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realtimeCommandTimeoutMs, useRealtimeEvents } from './useRealtimeEvents'

type Handler = (...args: unknown[]) => void

const socketMocks = vi.hoisted(() => {
  const handlers = new Map<string, Handler[]>()
  const commandEmit = vi.fn()
  const fakeSocket = {
    auth: {},
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return fakeSocket
    }),
    timeout: vi.fn(() => ({
      emit: commandEmit,
    })),
  }

  return {
    commandEmit,
    fakeSocket,
    handlers,
    io: vi.fn(() => fakeSocket),
  }
})

vi.mock('socket.io-client', () => ({
  io: socketMocks.io,
}))

function emitSocketEvent(event: string, ...args: unknown[]) {
  for (const handler of socketMocks.handlers.get(event) ?? []) {
    handler(...args)
  }
}

describe('useRealtimeEvents', () => {
  beforeEach(() => {
    socketMocks.handlers.clear()
    socketMocks.commandEmit.mockReset()
    socketMocks.commandEmit.mockImplementation((_eventName, _payload, ack) => {
      ack(null, { ok: true, data: { joined: true } })
    })
    socketMocks.fakeSocket.auth = {}
    socketMocks.fakeSocket.connected = false
    socketMocks.fakeSocket.connect.mockReset()
    socketMocks.fakeSocket.disconnect.mockReset()
    socketMocks.fakeSocket.on.mockClear()
    socketMocks.fakeSocket.timeout.mockClear()
    socketMocks.io.mockClear()
  })

  afterEach(cleanup)

  it('attend le prochain realtime:ready apres une premiere erreur de connexion', async () => {
    const { result } = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalled()
      expect(socketMocks.handlers.get('realtime:ready')).toHaveLength(1)
    })

    const joinPromise = result.current.joinRoom('room_1')

    act(() => {
      emitSocketEvent('connect_error', new Error('unauthorized'))
    })

    expect(socketMocks.commandEmit).not.toHaveBeenCalled()

    await act(async () => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
      await expect(joinPromise).resolves.toEqual({ joined: true })
    })

    expect(socketMocks.commandEmit).toHaveBeenCalledWith(
      'room:join',
      expect.objectContaining({
        roomId: 'room_1',
        lastSeenEventId: null,
        clientCommandId: expect.any(String),
      }),
      expect.any(Function),
    )
  })

  it('renouvelle le jeton apres un refus de connexion temps reel', async () => {
    const getToken = vi.fn()
      .mockResolvedValueOnce('token_expire')
      .mockResolvedValueOnce('token_renouvele')

    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken,
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.auth).toEqual({ token: 'token_expire' })
    })

    act(() => {
      emitSocketEvent('connect_error', new Error('unauthorized'))
    })

    await waitFor(() => {
      expect(socketMocks.fakeSocket.auth).toEqual({ token: 'token_renouvele' })
      expect(socketMocks.fakeSocket.disconnect).toHaveBeenCalled()
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(2)
    })
  })

  it('partage une seule socket entre plusieurs consommateurs realtime', async () => {
    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
      }),
    )
    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalled()
    })

    expect(socketMocks.io).toHaveBeenCalledTimes(1)
  })

  it('differe le transport global jusqu a une periode inactive du navigateur', async () => {
    let runWhenIdle: IdleRequestCallback | null = null
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      runWhenIdle = callback
      return 42
    })
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)

    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        connectionPriority: 'background',
      }),
    )

    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(socketMocks.io).not.toHaveBeenCalled()

    runWhenIdle?.({ didTimeout: false, timeRemaining: () => 20 })

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    })

    vi.unstubAllGlobals()
  })

  it('court-circuite l attente inactive des qu une commande critique est emise', async () => {
    const requestIdleCallback = vi.fn(() => 42)
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)

    const { result } = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        connectionPriority: 'background',
      }),
    )

    const command = result.current.joinRoom('room_urgent')

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    })
    expect(cancelIdleCallback).toHaveBeenCalledWith(42)

    await act(async () => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
      await expect(command).resolves.toEqual({ joined: true })
    })

    vi.unstubAllGlobals()
  })

  it('donne la priorite a une page multijoueur montee apres le bootstrap global', async () => {
    const requestIdleCallback = vi.fn(() => 42)
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)

    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        connectionPriority: 'background',
      }),
    )
    expect(socketMocks.io).not.toHaveBeenCalled()

    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    })
    expect(cancelIdleCallback).toHaveBeenCalledWith(42)
    expect(socketMocks.io).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('propage les reponses tempo enregistrees au consommateur courant', async () => {
    const onMatchTempoAnswerRecorded = vi.fn()

    renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        onMatchTempoAnswerRecorded,
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalled()
    })

    const payload = {
      matchId: 'match_1',
      questionIndex: 2,
      playerId: 'player_1',
      reason: 'match_tempo_answer_recorded',
      at: '2026-07-10T10:00:00.000Z',
      match: { id: 'match_1', status: 'in_progress' },
    }

    act(() => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
      emitSocketEvent('match:tempo-answer-recorded', payload)
    })

    expect(onMatchTempoAnswerRecorded).toHaveBeenCalledWith(payload)
  })

  it('diffuse la preference de visibilite et envoie une commande Socket.IO validee', async () => {
    const onPresenceVisibilityChanged = vi.fn()
    const getToken = async () => 'token_1'
    const { result } = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken,
        onPresenceVisibilityChanged,
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalled()
    })

    await act(async () => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
      emitSocketEvent('presence:visibility', { hidden: true })
    })

    expect(onPresenceVisibilityChanged).toHaveBeenCalledWith({ hidden: true })

    await act(async () => {
      await expect(result.current.setPresenceVisibility(false)).resolves.toEqual({ joined: true })
    })

    expect(socketMocks.commandEmit).toHaveBeenCalledWith(
      'presence:visibility',
      expect.objectContaining({ visible: false, clientCommandId: expect.any(String) }),
      expect.any(Function),
    )
  })

  it('utilise un timeout plus long pour les commandes persistantes', () => {
    expect(realtimeCommandTimeoutMs('match:create-invitation')).toBe(12_000)
    expect(realtimeCommandTimeoutMs('match:propose')).toBe(12_000)
  })

  it('garde un timeout court pour les commandes purement runtime', () => {
    expect(realtimeCommandTimeoutMs('room:join')).toBe(4_000)
    expect(realtimeCommandTimeoutMs('match:update-progress')).toBe(4_000)
  })

  it('fan-outs a notification burst while dropping handlers from an unmounted page', async () => {
    const onFirstPageNotificationsChanged = vi.fn()
    const onSecondPageNotificationsChanged = vi.fn()
    const firstPage = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        onNotificationsChanged: onFirstPageNotificationsChanged,
      }),
    )
    const secondPage = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken: async () => 'token_1',
        onNotificationsChanged: onSecondPageNotificationsChanged,
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    })

    act(() => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
      for (let index = 0; index < 100; index += 1) {
        emitSocketEvent('notifications:changed', {
          reason: 'notification_created',
          at: `2026-07-19T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
          notification: { id: `notification-${index}` },
        })
      }
    })

    expect(onFirstPageNotificationsChanged).toHaveBeenCalledTimes(100)
    expect(onSecondPageNotificationsChanged).toHaveBeenCalledTimes(100)

    firstPage.unmount()
    act(() => {
      emitSocketEvent('notifications:changed', {
        reason: 'notification_created',
        at: '2026-07-19T12:02:00.000Z',
        notification: { id: 'notification-after-navigation' },
      })
    })

    expect(onFirstPageNotificationsChanged).toHaveBeenCalledTimes(100)
    expect(onSecondPageNotificationsChanged).toHaveBeenCalledTimes(101)
    expect(socketMocks.fakeSocket.disconnect).not.toHaveBeenCalled()

    secondPage.unmount()
    expect(socketMocks.fakeSocket.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps one transport through disconnect and reconnect signals', async () => {
    const getToken = async () => 'token_1'
    const { result } = renderHook(() =>
      useRealtimeEvents({
        isAuthenticated: true,
        getToken,
      }),
    )

    await waitFor(() => {
      expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    })

    act(() => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
    })
    await waitFor(() => expect(result.current.isRealtimeReady).toBe(true))

    act(() => {
      socketMocks.fakeSocket.connected = false
      emitSocketEvent('disconnect', 'transport close')
    })
    expect(result.current.isRealtimeReady).toBe(false)

    act(() => {
      socketMocks.fakeSocket.connected = true
      emitSocketEvent('realtime:ready')
    })
    await waitFor(() => expect(result.current.isRealtimeReady).toBe(true))
    expect(socketMocks.io).toHaveBeenCalledTimes(1)
    expect(socketMocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
  })

})
