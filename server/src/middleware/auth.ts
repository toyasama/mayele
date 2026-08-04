import { clerkClient, getAuth } from '@clerk/express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { unauthorized } from '../errors.js'

export type AuthContext = {
  clerkUserId: string
  recentlyVerified: boolean
}

export function requireClerkUser(req: Request, _res: Response, next: NextFunction) {
  const e2eAuth = getE2EAuth(req)
  if (e2eAuth) {
    req.authContext = e2eAuth
    return next()
  }

  const auth = getAuth(req)

  if (!auth.isAuthenticated || !auth.userId) {
    return next(unauthorized())
  }

  req.authContext = {
    clerkUserId: auth.userId,
    recentlyVerified: auth.has({ reverification: 'strict' }),
  }
  return next()
}

function getE2EAuth(req: Request): AuthContext | null {
  if (env.isProduction || !env.e2eAuthBypass) {
    return null
  }

  const authorization = req.headers.authorization
  const token = authorization?.startsWith('Bearer e2e:') ? authorization.slice('Bearer e2e:'.length).trim() : ''

  if (!token || !/^e2e-[a-z0-9-]+$/i.test(token)) {
    return null
  }

  return { clerkUserId: token, recentlyVerified: true }
}

export function mockAuth(clerkUserId: string, options: { recentlyVerified?: boolean } = {}): RequestHandler {
  return (req, _res, next) => {
    req.authContext = { clerkUserId, recentlyVerified: options.recentlyVerified ?? true }
    next()
  }
}

export function getRequiredAuth(req: Request) {
  if (!req.authContext) {
    throw unauthorized()
  }

  return req.authContext
}

export async function getClerkUser(clerkUserId: string) {
  return clerkClient.users.getUser(clerkUserId)
}

export async function deleteClerkUser(clerkUserId: string) {
  return clerkClient.users.deleteUser(clerkUserId)
}
