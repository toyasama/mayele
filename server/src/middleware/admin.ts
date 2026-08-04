import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { forbidden } from '../errors.js'
import { getRequiredAuth } from './auth.js'

export function isAdminClerkUser(clerkUserId: string) {
  if (!env.isProduction && env.e2eAuthBypass && clerkUserId === 'e2e-host') {
    return true
  }

  return env.adminClerkUserIds.includes(clerkUserId)
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const { clerkUserId } = getRequiredAuth(req)

  if (!isAdminClerkUser(clerkUserId)) {
    return next(forbidden('Acces administrateur requis.'))
  }

  return next()
}

export function requireRecentVerification(req: Request, res: Response, next: NextFunction) {
  const auth = getRequiredAuth(req)

  if (!auth.recentlyVerified) {
    return res.status(403).json({
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
        metadata: { reverification: 'strict' },
      },
    })
  }

  return next()
}
