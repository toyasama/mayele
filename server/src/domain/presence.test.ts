import { describe, expect, it } from 'vitest'
import { presenceStatusForSockets } from './presence.js'

describe('presenceStatusForSockets', () => {
  it('considere un joueur hors ligne sans connexion', () => {
    expect(presenceStatusForSockets(0, 0)).toBe('offline')
  })

  it('considere un joueur en ligne des qu un onglet actif est connecte', () => {
    expect(presenceStatusForSockets(2, 1)).toBe('online')
  })

  it('considere un joueur absent lorsque tous ses onglets sont masques', () => {
    expect(presenceStatusForSockets(2, 0)).toBe('away')
  })
})
