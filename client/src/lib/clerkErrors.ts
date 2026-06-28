import { isClerkAPIResponseError } from '@clerk/react/errors'

export function clerkErrorMessage(error: unknown, fallback = 'Impossible de terminer l’opération.') {
  if (isClerkAPIResponseError(error)) {
    return error.errors[0]?.longMessage ?? error.errors[0]?.message ?? fallback
  }

  if (typeof error === 'object' && error) {
    const clerkError = error as { longMessage?: string; message?: string }
    return clerkError.longMessage ?? clerkError.message ?? fallback
  }

  return fallback
}
