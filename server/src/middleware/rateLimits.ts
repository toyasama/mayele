import type { Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

type LimitOptions = {
  skip?: (req: Request) => boolean
}

function userAwareKey(req: Request) {
  return req.authContext?.clerkUserId ?? ipKeyGenerator(req.ip ?? '0.0.0.0')
}

function isSafeRead(req: Request) {
  return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
}

function limit(windowMs: number, max: number, message: string, options: LimitOptions = {}) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: userAwareKey,
    skip: options.skip,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message, code: 'rate_limit_exceeded' },
  })
}

export const sessionRateLimit = limit(60 * 1000, 30, 'Trop de requetes. Reessayez dans une minute.')
export const soloRunRateLimit = limit(60 * 1000, 240, 'Trop d actions de jeu. Reessayez dans une minute.')
export const profileMutationRateLimit = limit(60 * 1000, 40, 'Trop de mises a jour de profil. Reessayez dans une minute.', {
  skip: isSafeRead,
})
export const socialMutationRateLimit = limit(60 * 1000, 60, 'Trop d actions sociales. Reessayez dans une minute.', {
  skip: isSafeRead,
})
export const matchHeartbeatRateLimit = limit(60 * 1000, 240, 'Trop de heartbeats multijoueur. Reessayez dans une minute.')
export const matchMutationRateLimit = limit(60 * 1000, 90, 'Trop d actions multijoueur. Reessayez dans une minute.', {
  skip: (req) => isSafeRead(req) || req.path.endsWith('/heartbeat'),
})
export const notificationMutationRateLimit = limit(60 * 1000, 120, 'Trop d actions de notification. Reessayez dans une minute.', {
  skip: isSafeRead,
})
export const searchRateLimit = limit(60 * 1000, 45, 'Trop de recherches. Reessayez dans une minute.')
