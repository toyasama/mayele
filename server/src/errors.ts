import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

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

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code })
  }

  if (isPayloadTooLarge(error)) {
    return res.status(413).json({ message: 'Payload trop volumineux.', code: 'payload_too_large' })
  }

  if (error instanceof ZodError) {
    return res.status(400).json({ message: 'Payload invalide.', code: 'validation_error', issues: error.issues })
  }

  console.error(error)
  return res.status(500).json({ message: 'Erreur serveur.', code: 'internal_error' })
}
