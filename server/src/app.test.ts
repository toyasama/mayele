import type { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp, shouldMountClerkMiddleware } from './app.js'

const noopClerk: RequestHandler = (_req, _res, next) => next()
const rejectAuth: RequestHandler = (_req, res) => res.status(401).json({ message: 'Authentification requise.' })

describe('app', () => {
  it('mounts Clerk except for the non-production E2E auth bypass', () => {
    expect(shouldMountClerkMiddleware({ isProduction: false, e2eAuthBypass: true })).toBe(false)
    expect(shouldMountClerkMiddleware({ isProduction: false, e2eAuthBypass: false })).toBe(true)
    expect(shouldMountClerkMiddleware({ isProduction: true, e2eAuthBypass: true })).toBe(true)
  })

  it('exposes a public health endpoint', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: rejectAuth })

    await request(app).get('/api/health').expect(200, { status: 'ok' })
  })

  it('rejects private endpoints without an authenticated user', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: rejectAuth })

    await request(app).get('/api/dashboard').expect(401)
  })

  it('allows private network origins in local development', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: rejectAuth })

    const response = await request(app).get('/api/health').set('Origin', 'http://192.168.1.14:5173').expect(200)

    expect(response.headers['access-control-allow-origin']).toBe('http://192.168.1.14:5173')
  })
})
