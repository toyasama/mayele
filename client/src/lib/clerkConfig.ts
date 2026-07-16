const CLERK_PUBLISHABLE_KEY_PATTERN = /^pk_(?:test|live)_[A-Za-z0-9_-]{20,}$/

export function isClerkPublishableKey(value: string | undefined) {
  return Boolean(value && CLERK_PUBLISHABLE_KEY_PATTERN.test(value.trim()))
}
