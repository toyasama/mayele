import { describe, expect, it } from 'vitest'
import { isClerkPublishableKey } from './clerkConfig'

describe('isClerkPublishableKey', () => {
  it('accepts valid Clerk publishable keys', () => {
    expect(isClerkPublishableKey('pk_test_1234567890abcdefghij')).toBe(true)
    expect(isClerkPublishableKey('pk_live_1234567890abcdefghij')).toBe(true)
  })

  it('rejects missing, placeholder, and malformed keys', () => {
    expect(isClerkPublishableKey(undefined)).toBe(false)
    expect(isClerkPublishableKey('')).toBe(false)
    expect(isClerkPublishableKey('pk_test_placeholder')).toBe(false)
    expect(isClerkPublishableKey('sk_live_1234567890abcdefghij')).toBe(false)
  })
})
