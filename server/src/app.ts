import { clerkMiddleware } from '@clerk/express'
import cors from 'cors'
import express, { type RequestHandler } from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { isAllowedCorsOrigin } from './config/origin.js'
import { errorHandler, ApiError } from './errors.js'
import { requireClerkUser } from './middleware/auth.js'
import {
  adminMutationRateLimit,
  matchHeartbeatRateLimit,
  matchMutationRateLimit,
  notificationMutationRateLimit,
  profileMutationRateLimit,
  searchRateLimit,
  sessionRateLimit,
  soloRunRateLimit,
  socialMutationRateLimit,
} from './middleware/rateLimits.js'
import { requestContext } from './middleware/requestContext.js'
import { dashboardRoutes } from './routes/dashboardRoutes.js'
import { adminRoutes } from './routes/adminRoutes.js'
import { e2eRoutes } from './routes/e2eRoutes.js'
import { friendRoutes } from './routes/friendRoutes.js'
import { healthRoutes } from './routes/healthRoutes.js'
import { matchRoutes } from './routes/matchRoutes.js'
import { notificationRoutes } from './routes/notificationRoutes.js'
import { profileRoutes } from './routes/profileRoutes.js'
import { sessionRoutes } from './routes/sessionRoutes.js'

type CreateAppOptions = {
  clerkMiddlewareOverride?: RequestHandler
  authMiddlewareOverride?: RequestHandler
}

const bypassClerkMiddleware: RequestHandler = (_req, _res, next) => next()

export function shouldMountClerkMiddleware(options: { isProduction: boolean; e2eAuthBypass: boolean }) {
  return options.isProduction || !options.e2eAuthBypass
}

function resolveClerkMiddleware(override: RequestHandler | undefined) {
  if (override) {
    return override
  }

  return shouldMountClerkMiddleware(env) ? clerkMiddleware() : bypassClerkMiddleware
}

function corsOrigin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) {
  if (isAllowedCorsOrigin(origin, { isProduction: env.isProduction, allowedOrigins: env.corsOrigins })) {
    callback(null, true)
    return
  }

  callback(new ApiError(403, 'Origin non autorisée.', 'cors_origin_denied'))
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const authMiddleware = options.authMiddlewareOverride ?? requireClerkUser

  app.disable('x-powered-by')
  app.use(helmet({ crossOriginResourcePolicy: false }))
  app.use(requestContext)
  app.use(
    cors({
      origin: corsOrigin,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  )
  app.use(express.json({ limit: '512kb' }))

  app.use('/api', healthRoutes())
  if (!env.isProduction && env.e2eAuthBypass) {
    app.use('/api', e2eRoutes())
  }
  app.use(resolveClerkMiddleware(options.clerkMiddlewareOverride))
  app.use('/api/players/search', authMiddleware, searchRateLimit)
  app.use('/api/me', authMiddleware, profileMutationRateLimit)
  app.use('/api/friends', authMiddleware, socialMutationRateLimit)
  app.use('/api/matches/:matchId/heartbeat', authMiddleware, matchHeartbeatRateLimit)
  app.use('/api/matches', authMiddleware, matchMutationRateLimit)
  app.use('/api/notifications', authMiddleware, notificationMutationRateLimit)
  app.use('/api/admin/users', authMiddleware, adminMutationRateLimit)
  app.use('/api', authMiddleware, adminRoutes())
  app.use('/api', authMiddleware, profileRoutes())
  app.use('/api', authMiddleware, friendRoutes())
  app.use('/api', authMiddleware, matchRoutes())
  app.use('/api', authMiddleware, notificationRoutes())
  app.use('/api', authMiddleware, dashboardRoutes())
  app.use('/api/sessions', authMiddleware, sessionRateLimit)
  app.use('/api/solo-runs', authMiddleware, soloRunRateLimit)
  app.use('/api', sessionRoutes())
  app.use(errorHandler)

  return app
}
