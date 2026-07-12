import { describe, expect, it } from 'vitest'
import { resolveRealtimeBase } from './runtimeConfig'

describe('resolveRealtimeBase', () => {
  it('uses an explicit realtime URL first', () => {
    expect(
      resolveRealtimeBase({
        configuredRealtimeBase: 'https://realtime.mayele-learning.com/',
        configuredApiBase: 'https://api.mayele-learning.com/api',
        pageHostname: 'mayele-learning.com',
        pageOrigin: 'https://mayele-learning.com',
      }),
    ).toBe('https://realtime.mayele-learning.com')
  })

  it('derives the websocket origin from the production API URL', () => {
    expect(
      resolveRealtimeBase({
        configuredApiBase: 'https://api.mayele-learning.com/api',
        pageHostname: 'mayele-learning.com',
        pageOrigin: 'https://mayele-learning.com',
        isProduction: true,
      }),
    ).toBe('https://api.mayele-learning.com')
  })

  it('fails in production when neither realtime nor API URL is configured', () => {
    expect(() =>
      resolveRealtimeBase({
        pageHostname: 'mayele-learning.com',
        pageOrigin: 'https://mayele-learning.com',
        isProduction: true,
      }),
    ).toThrow('VITE_API_URL doit etre defini')
  })

  it('fails in production when the derived websocket would use HTTP', () => {
    expect(() =>
      resolveRealtimeBase({
        configuredApiBase: 'http://api.mayele-learning.com/api',
        pageHostname: 'mayele-learning.com',
        pageOrigin: 'https://mayele-learning.com',
        isProduction: true,
      }),
    ).toThrow('HTTPS')
  })

  it('keeps a proxied realtime path when a local API is opened from another device', () => {
    expect(
      resolveRealtimeBase({
        configuredApiBase: 'http://localhost:4000/api',
        pageHostname: '192.168.1.14',
        pageOrigin: 'http://192.168.1.14:5173',
      }),
    ).toBe('http://192.168.1.14:5173')
  })

  it('falls back to the page origin when no API URL is configured', () => {
    expect(
      resolveRealtimeBase({
        pageHostname: 'localhost',
        pageOrigin: 'http://localhost:5173',
      }),
    ).toBe('http://localhost:5173')
  })
})
