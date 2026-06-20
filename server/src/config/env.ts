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
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? '',
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
}

export function assertProductionEnv() {
  if (!env.isProduction) {
    return
  }

  const missing = [
    ['DATABASE_URL', env.databaseUrl],
    ['CLERK_SECRET_KEY', env.clerkSecretKey],
    ['CLERK_PUBLISHABLE_KEY', env.clerkPublishableKey],
    ['CORS_ORIGINS', env.corsOrigins.length ? 'set' : ''],
  ].filter(([, value]) => !value)

  if (missing.length) {
    throw new Error(`Variables d'environnement production manquantes: ${missing.map(([key]) => key).join(', ')}`)
  }
}
