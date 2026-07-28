import * as Sentry from '@sentry/node'
import { env } from '../config/env.js'

let initialized = false

export function initSentry() {
  if (!env.sentryDsn || initialized) {
    return
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: env.isProduction ? 0.1 : 1,
  })
  initialized = true
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) {
    return
  }

  Sentry.captureException(error, { extra: context })
}

export async function closeSentry(timeoutMs = 2_000) {
  if (!initialized) {
    return true
  }

  return Sentry.close(timeoutMs)
}
