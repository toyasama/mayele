import { clerkClient, getAuth } from '@clerk/express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { unauthorized } from '../errors.js'

export type AuthContext = {
  clerkUserId: string
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

  req.authContext = { clerkUserId: auth.userId }
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

  return { clerkUserId: token }
}

export function mockAuth(clerkUserId: string): RequestHandler {
  return (req, _res, next) => {
    req.authContext = { clerkUserId }
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
