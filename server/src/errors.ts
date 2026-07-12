import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { logger } from './lib/logger.js'
import { captureException } from './lib/sentry.js'

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'api_error',
  ) {
    super(message)
  }
}

export function badRequest(message: string) {
  return new ApiError(400, message, 'bad_request')
}

export function unauthorized(message = 'Authentification requise.') {
  return new ApiError(401, message, 'unauthorized')
}

function isPayloadTooLarge(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('status' in error && error.status === 413) || ('type' in error && error.type === 'entity.too.large'))
  )
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code })
  }

  if (isPayloadTooLarge(error)) {
    return res.status(413).json({ message: 'Payload trop volumineux.', code: 'payload_too_large' })
  }

  if (error instanceof ZodError) {
    return res.status(400).json({ message: 'Payload invalide.', code: 'validation_error', issues: error.issues })
  }

  logger.error('Unhandled server error', {
    requestId: req.requestId,
    name: error instanceof Error ? error.name : 'Unknown',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  captureException(error, {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
  })
  return res.status(500).json({ message: 'Erreur serveur.', code: 'internal_error' })
}
