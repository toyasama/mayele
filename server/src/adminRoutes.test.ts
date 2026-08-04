import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from './config/env.js'
import { errorHandler } from './errors.js'
import { mockAuth } from './middleware/auth.js'

const adminServiceMocks = vi.hoisted(() => ({
  deletePlayerAccount: vi.fn(),
  getAdminOverview: vi.fn(),
  listAdminUsers: vi.fn(),
  resetPlayerProgress: vi.fn(),
}))

vi.mock('./services/adminService.js', () => adminServiceMocks)
vi.mock('./services/outboxDispatcher.js', () => ({
  getOutboxDispatcherHealth: vi.fn(() => ({ started: true, running: false, lastSucceededAt: null, lastFailedAt: null })),
}))
vi.mock('./services/matchExpirationWorker.js', () => ({
  getMatchExpirationWorkerHealth: vi.fn(() => ({ started: true, running: false, lastSucceededAt: null, lastFailedAt: null })),
}))

const { adminRoutes } = await import('./routes/adminRoutes.js')

function app(clerkUserId: string, recentlyVerified = true) {
  const server = express()
  server.use(express.json())
  server.use('/api', mockAuth(clerkUserId, { recentlyVerified }), adminRoutes())
  server.use(errorHandler)
  return server
}

describe('admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.adminClerkUserIds.splice(0, env.adminClerkUserIds.length, 'user_admin123')
    adminServiceMocks.getAdminOverview.mockResolvedValue({ metrics: {}, operations: {}, recentAudit: [] })
    adminServiceMocks.listAdminUsers.mockResolvedValue({ users: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })
    adminServiceMocks.resetPlayerProgress.mockResolvedValue({ deletedSessions: 2, deletedSoloRuns: 1 })
    adminServiceMocks.deletePlayerAccount.mockResolvedValue(undefined)
  })

  it('revele seulement si le compte courant est administrateur', async () => {
    await request(app('user_admin123')).get('/api/admin/access').expect(200, { isAdmin: true })
    await request(app('user_regular123')).get('/api/admin/access').expect(200, { isAdmin: false })
  })

  it('refuse les donnees de pilotage a un utilisateur ordinaire', async () => {
    const response = await request(app('user_regular123')).get('/api/admin/overview').expect(403)
    expect(response.body.code).toBe('forbidden')
    expect(adminServiceMocks.getAdminOverview).not.toHaveBeenCalled()
  })

  it('retourne les metriques et les utilisateurs a un administrateur', async () => {
    await request(app('user_admin123')).get('/api/admin/overview').expect(200)
    await request(app('user_admin123')).get('/api/admin/users?page=2&pageSize=10&search=ada').expect(200)

    expect(adminServiceMocks.getAdminOverview).toHaveBeenCalledOnce()
    expect(adminServiceMocks.listAdminUsers).toHaveBeenCalledWith({ page: 2, pageSize: 10, search: 'ada' })
  })

  it('demande une reverification Clerk avant une action destructive', async () => {
    const response = await request(app('user_admin123', false))
      .post('/api/admin/users/cmh1234567890123456789012/reset-progress')
      .send({ confirmation: 'ada' })
      .expect(403)

    expect(response.body).toEqual({
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
        metadata: { reverification: 'strict' },
      },
    })
    expect(adminServiceMocks.resetPlayerProgress).not.toHaveBeenCalled()
  })

  it('execute les actions destructives apres reverification et validation', async () => {
    const playerId = 'cmh1234567890123456789012'

    await request(app('user_admin123'))
      .post(`/api/admin/users/${playerId}/reset-progress`)
      .send({ confirmation: 'ada' })
      .expect(200, { success: true, deletedSessions: 2, deletedSoloRuns: 1 })
    await request(app('user_admin123'))
      .delete(`/api/admin/users/${playerId}`)
      .send({ confirmation: 'ada' })
      .expect(200, { success: true })

    expect(adminServiceMocks.resetPlayerProgress).toHaveBeenCalledWith('user_admin123', playerId, 'ada')
    expect(adminServiceMocks.deletePlayerAccount).toHaveBeenCalledWith('user_admin123', playerId, 'ada')
  })
})
