import { clerkMiddleware } from '@clerk/express'
import cors from 'cors'
import express, { type RequestHandler } from 'express'
import { env } from './config/env.js'
import { errorHandler, ApiError } from './errors.js'
import { requireClerkUser } from './middleware/auth.js'
import { dashboardRoutes } from './routes/dashboardRoutes.js'
import { healthRoutes } from './routes/healthRoutes.js'
import { profileRoutes } from './routes/profileRoutes.js'
import { sessionRoutes } from './routes/sessionRoutes.js'

type CreateAppOptions = {
  clerkMiddlewareOverride?: RequestHandler
  authMiddlewareOverride?: RequestHandler
}

function corsOrigin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) {
  if (!origin) {
    callback(null, true)
    return
  }

  if (!env.isProduction && isLocalDevOrigin(origin)) {
    callback(null, true)
    return
  }

  if (!env.isProduction && env.corsOrigins.length === 0) {
    callback(null, true)
    return
  }

  if (env.corsOrigins.includes(origin)) {
    callback(null, true)
    return
  }

  callback(new ApiError(403, 'Origin non autorisée.', 'cors_origin_denied'))
}

function isLocalDevOrigin(origin: string) {
  try {
    const { hostname, protocol } = new URL(origin)

    if (protocol !== 'http:' && protocol !== 'https:') {
      return false
    }

    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    )
  } catch {
    return false
  }
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const authMiddleware = options.authMiddlewareOverride ?? requireClerkUser

  app.disable('x-powered-by')
  app.use(
    cors({
      origin: corsOrigin,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  )
  app.use(express.json({ limit: '512kb' }))

  app.use('/api', healthRoutes())
  app.use(options.clerkMiddlewareOverride ?? clerkMiddleware())
  app.use('/api', authMiddleware, profileRoutes())
  app.use('/api', authMiddleware, dashboardRoutes())
  app.use('/api', authMiddleware, sessionRoutes())
  app.use(errorHandler)

  return app
}
