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

  it('utilise un timeout plus long pour les commandes persistantes', () => {
    expect(realtimeCommandTimeoutMs('match:create-invitation')).toBe(12_000)
    expect(realtimeCommandTimeoutMs('match:propose')).toBe(12_000)
  })

  it('garde un timeout court pour les commandes purement runtime', () => {
    expect(realtimeCommandTimeoutMs('room:join')).toBe(4_000)
    expect(realtimeCommandTimeoutMs('match:update-progress')).toBe(4_000)
  })

})
