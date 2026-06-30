import { describe, expect, it } from 'vitest'
import { resolveApiBase } from './api'

describe('resolveApiBase', () => {
  it('uses the Vite proxy when a local API URL is opened from another device', () => {
    expect(resolveApiBase('http://localhost:4000/api', '192.168.1.14')).toBe('/api')
  })

  it('keeps the local API URL when the app runs on the same machine', () => {
    expect(resolveApiBase('http://localhost:4000/api', 'localhost')).toBe('http://localhost:4000/api')
  })

  it('keeps production API URLs', () => {
    expect(resolveApiBase('https://api.mayele-learning.com/api', 'mayele-learning.com')).toBe(
      'https://api.mayele-learning.com/api',
    )
  })
})
