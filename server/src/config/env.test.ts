import { describe, expect, it, vi } from 'vitest'
import { productionEnvProblems } from './env.js'

function validProductionEnv() {
  return {
    nodeEnv: 'production',
    isProduction: true,
    port: 4000,
    databaseUrl: 'postgresql://user:password@db.example/mayele?sslmode=verify-full',
    directUrl: 'postgresql://user:password@db.example/mayele?sslmode=verify-full',
    clerkSecretKey: 'sk_live_1234567890abcdefghij',
    clerkPublishableKey: 'pk_live_1234567890abcdefghij',
    corsOrigins: ['https://mayele-learning.com'],
    e2eAuthBypass: false,
    sentryDsn: 'https://public@example.ingest.sentry.io/1',
  }
}

describe('productionEnvProblems', () => {
  it('accepte une configuration live complete', () => {
    expect(productionEnvProblems(validProductionEnv())).toEqual([])
  })

  it('normalise une origine HTTPS avec un slash final', async () => {
    vi.resetModules()
    vi.stubEnv('CORS_ORIGINS', 'https://mayele-learning.com/')

    const { env } = await import('./env.js')

    expect(env.corsOrigins).toEqual(['https://mayele-learning.com'])

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('ecarte les origines non sures et utilise le domaine de production connu', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CORS_ORIGINS', 'http://localhost:5173,not-a-url')

    const { env } = await import('./env.js')

    expect(env.corsOrigins).toEqual(['https://mayele-learning.com'])

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('bloque les identifiants de test, les origines locales et le bypass E2E', () => {
    expect(productionEnvProblems({
      ...validProductionEnv(),
      clerkSecretKey: 'sk_test_1234567890abcdefghij',
      clerkPublishableKey: 'pk_test_1234567890abcdefghij',
      corsOrigins: ['http://localhost:5173'],
      e2eAuthBypass: true,
    })).toEqual(expect.arrayContaining([
      'CLERK_PUBLISHABLE_KEY doit etre une cle live',
      'CLERK_SECRET_KEY doit etre une cle live',
      'CORS_ORIGINS doit contenir uniquement des origines HTTPS exactes',
      'E2E_AUTH_BYPASS doit etre desactive',
    ]))
  })

  it('exige la connexion de migration, mais laisse Sentry optionnel', () => {
    expect(productionEnvProblems({ ...validProductionEnv(), directUrl: '', sentryDsn: '' })).toEqual([
      'DIRECT_URL manquante',
    ])
  })

  it('exige la verification du certificat PostgreSQL en production', () => {
    expect(productionEnvProblems({
      ...validProductionEnv(),
      databaseUrl: 'postgresql://user:password@db.example/mayele?sslmode=require',
      directUrl: 'postgresql://user:password@db.example/mayele',
    })).toEqual(expect.arrayContaining([
      'DATABASE_URL doit utiliser sslmode=verify-full',
      'DIRECT_URL doit utiliser sslmode=verify-full',
    ]))
  })
})
