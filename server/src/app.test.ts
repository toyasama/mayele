import type { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const noopClerk: RequestHandler = (_req, _res, next) => next()
const rejectAuth: RequestHandler = (_req, res) => res.status(401).json({ message: 'Authentification requise.' })

describe('app', () => {
  it('exposes a public health endpoint', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: rejectAuth })

    await request(app).get('/api/health').expect(200, { status: 'ok' })
  })

  it('rejects private endpoints without an authenticated user', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: rejectAuth })

    await request(app).get('/api/dashboard').expect(401)
  })
})
