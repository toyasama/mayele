const sentryDsn = import.meta.env.VITE_SENTRY_DSN
type SentryModule = typeof import('@sentry/react')
let sentryPromise: Promise<SentryModule> | null = null

function ensureSentry() {
  if (!sentryDsn) {
    return null
  }

  if (!sentryPromise) {
    sentryPromise = import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1,
      })
      return Sentry
    })
  }

  return sentryPromise
}

export function initSentry() {
  void ensureSentry()
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  void ensureSentry()?.then((Sentry) => {
    Sentry.captureException(error, { extra: context })
  })
}
