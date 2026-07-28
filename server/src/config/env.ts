import { config } from 'dotenv'

config({ path: '.env.local' })
config()

function parsePort(value: string | undefined) {
  const port = Number(value ?? 4000)
  return Number.isInteger(port) && port > 0 ? port : 4000
}

function parseOrigins(value: string | undefined) {
  return String(value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: parsePort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL ?? '',
  directUrl: process.env.DIRECT_URL ?? '',
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? '',
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  e2eAuthBypass: process.env.E2E_AUTH_BYPASS === 'true',
  sentryDsn: process.env.SENTRY_DSN ?? '',
}

type ProductionEnv = typeof env

function isPostgresUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'postgresql:' || url.protocol === 'postgres:'
  } catch {
    return false
  }
}

function usesVerifiedTls(value: string) {
  try {
    return new URL(value).searchParams.get('sslmode') === 'verify-full'
  } catch {
    return false
  }
}

function isHttpsOrigin(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function productionEnvProblems(candidate: ProductionEnv) {
  const problems: string[] = []
  const required = [
    ['DATABASE_URL', candidate.databaseUrl],
    ['DIRECT_URL', candidate.directUrl],
    ['CLERK_SECRET_KEY', candidate.clerkSecretKey],
    ['CLERK_PUBLISHABLE_KEY', candidate.clerkPublishableKey],
    ['CORS_ORIGINS', candidate.corsOrigins.length ? 'set' : ''],
    ['SENTRY_DSN', candidate.sentryDsn],
  ] as const

  for (const [key, value] of required) {
    if (!value) problems.push(`${key} manquante`)
  }
  if (candidate.databaseUrl && !isPostgresUrl(candidate.databaseUrl)) problems.push('DATABASE_URL invalide')
  if (candidate.directUrl && !isPostgresUrl(candidate.directUrl)) problems.push('DIRECT_URL invalide')
  if (candidate.databaseUrl && isPostgresUrl(candidate.databaseUrl) && !usesVerifiedTls(candidate.databaseUrl)) {
    problems.push('DATABASE_URL doit utiliser sslmode=verify-full')
  }
  if (candidate.directUrl && isPostgresUrl(candidate.directUrl) && !usesVerifiedTls(candidate.directUrl)) {
    problems.push('DIRECT_URL doit utiliser sslmode=verify-full')
  }
  if (candidate.clerkPublishableKey && !candidate.clerkPublishableKey.startsWith('pk_live_')) {
    problems.push('CLERK_PUBLISHABLE_KEY doit etre une cle live')
  }
  if (candidate.clerkSecretKey && !candidate.clerkSecretKey.startsWith('sk_live_')) {
    problems.push('CLERK_SECRET_KEY doit etre une cle live')
  }
  if (candidate.corsOrigins.some((origin) => !isHttpsOrigin(origin))) {
    problems.push('CORS_ORIGINS doit contenir uniquement des origines HTTPS exactes')
  }
  if (candidate.e2eAuthBypass) problems.push('E2E_AUTH_BYPASS doit etre desactive')
  if (candidate.sentryDsn && !isHttpsUrl(candidate.sentryDsn)) problems.push('SENTRY_DSN invalide')

  return problems
}

export function assertProductionEnv() {
  if (!env.isProduction) {
    return
  }

  const problems = productionEnvProblems(env)
  if (problems.length) {
    throw new Error(`Configuration production invalide: ${problems.join(', ')}`)
  }
}
