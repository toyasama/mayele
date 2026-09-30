import { describe, expect, it, vi } from 'vitest'
import {
  receiveBackgroundWorkSignals,
  registerBackgroundWorkSignalTransport,
  signalBackgroundWork,
  subscribeToBackgroundWork,
} from './backgroundWorkSignals.js'

describe('background work signals', () => {
  it('réveille localement puis groupe la diffusion inter-instance', async () => {
    const listener = vi.fn()
    const transport = vi.fn()
    const unsubscribe = subscribeToBackgroundWork('bot-match', listener)
    const unregisterTransport = registerBackgroundWorkSignalTransport(transport)

    signalBackgroundWork('bot-match')
    signalBackgroundWork('outbox')

    expect(listener).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(transport).toHaveBeenCalledWith(['bot-match', 'outbox']))
    unsubscribe()
    unregisterTransport()
  })

  it('réveille ce processus pour les seuls types de travaux reconnus', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToBackgroundWork('matchmaking', listener)

    receiveBackgroundWorkSignals(['unknown', 'matchmaking', 42])

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
