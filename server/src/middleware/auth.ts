import { clerkClient, getAuth } from '@clerk/express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { unauthorized } from '../errors.js'

export type AuthContext = {
  clerkUserId: string
}

export function requireClerkUser(req: Request, _res: Response, next: NextFunction) {
  const auth = getAuth(req)

  if (!auth.isAuthenticated || !auth.userId) {
    return next(unauthorized())
  }

  req.authContext = { clerkUserId: auth.userId }
  return next()
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
