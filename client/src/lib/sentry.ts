import * as Sentry from '@sentry/react'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN

export function initSentry() {
  if (!sentryDsn) {
    return
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1,
  })
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!sentryDsn) {
    return
  }

  Sentry.captureException(error, { extra: context })
}
