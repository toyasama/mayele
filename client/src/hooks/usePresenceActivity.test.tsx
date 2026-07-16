import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePresenceActivity } from './usePresenceActivity'

let visibilityState: DocumentVisibilityState = 'visible'

Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibilityState,
})

afterEach(() => {
  visibilityState = 'visible'
  vi.useRealTimers()
})

describe('usePresenceActivity', () => {
  it('signale immediatement un onglet visible et maintient un heartbeat borne', () => {
    vi.useFakeTimers()
    const setPresenceActivity = vi.fn()

    renderHook(() => usePresenceActivity({ enabled: true, isRealtimeReady: true, setPresenceActivity }))

    expect(setPresenceActivity).toHaveBeenLastCalledWith(true)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(setPresenceActivity).toHaveBeenLastCalledWith(true)
    expect(setPresenceActivity).toHaveBeenCalledTimes(2)
  })

  it('passe absent quand la page est masquee ou quittee', () => {
    const setPresenceActivity = vi.fn()
    renderHook(() => usePresenceActivity({ enabled: true, isRealtimeReady: true, setPresenceActivity }))

    visibilityState = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(setPresenceActivity).toHaveBeenLastCalledWith(false)
    expect(setPresenceActivity).toHaveBeenCalledWith(true)
  })

  it('borne les signaux d activite repetes avant l envoi Socket.IO', () => {
    vi.useFakeTimers()
    const setPresenceActivity = vi.fn()
    renderHook(() => usePresenceActivity({ enabled: true, isRealtimeReady: true, setPresenceActivity }))

    act(() => {
      window.dispatchEvent(new Event('keydown'))
      window.dispatchEvent(new Event('pointerdown'))
    })

    expect(setPresenceActivity).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(10_000)
      window.dispatchEvent(new Event('keydown'))
    })

    expect(setPresenceActivity).toHaveBeenCalledTimes(2)
  })

  it('ne demarre aucun suivi sans session temps reel prete', () => {
    const setPresenceActivity = vi.fn()
    renderHook(() => usePresenceActivity({ enabled: true, isRealtimeReady: false, setPresenceActivity }))

    expect(setPresenceActivity).not.toHaveBeenCalled()
  })
})
