import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = req.header('x-request-id')
  const requestId = incomingRequestId && incomingRequestId.length <= 128 ? incomingRequestId : randomUUID()
  const startedAt = performance.now()

  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  res.on('finish', () => {
    logger.info('http_request', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    })
  })

  next()
}
