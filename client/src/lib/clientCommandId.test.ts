import { describe, expect, it, vi } from 'vitest'
import { createClientCommandId } from './clientCommandId'

describe('createClientCommandId', () => {
  it('utilise randomUUID quand le navigateur le fournit', () => {
    const randomUUID = vi.fn(() => 'cmd-native')

    expect(createClientCommandId({ randomUUID })).toBe('cmd-native')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it("cree un UUID v4 avec getRandomValues quand randomUUID n'est pas disponible", () => {
    const cryptoSource = {
      getRandomValues: vi.fn((array: ArrayBufferView) => {
        const bytes = array as Uint8Array
        bytes.forEach((_, index) => {
          bytes[index] = index
        })
        return array
      }),
    }

    expect(createClientCommandId(cryptoSource)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(cryptoSource.getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('refuse de creer un identifiant sans Web Crypto fiable', () => {
    expect(() => createClientCommandId({})).toThrow('Web Crypto indisponible')
  })
})
