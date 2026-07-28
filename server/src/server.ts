import { createApp } from './app.js'
import { assertProductionEnv, env } from './config/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { closeSentry, initSentry } from './lib/sentry.js'
import { closeRealtime, initRealtime } from './realtime/notifications.js'
import { markAllPlayersOffline } from './services/playerService.js'
import { startOutboxDispatcher } from './services/outboxDispatcher.js'
import { startMatchExpirationWorker } from './services/matchExpirationWorker.js'
import { createServer } from 'node:http'

assertProductionEnv()
initSentry()

const app = createApp()
const httpServer = createServer(app)

// The socket registry is process-local. A fresh process has no connected player,
// so persisted presence must not survive a crash or a deployment.
try {
  const { count } = await markAllPlayersOffline()
  logger.info('presence_reconciled_on_startup', { updatedPlayers: count })
} catch (error) {
  logger.error('presence_reconciliation_failed_on_startup', {
    message: error instanceof Error ? error.message : String(error),
  })
  await prisma.$disconnect()
  process.exit(1)
}

initRealtime(httpServer)
const stopOutboxDispatcher = startOutboxDispatcher()
const stopMatchExpirationWorker = startMatchExpirationWorker()

const server = httpServer.listen(env.port, () => {
  logger.info(`Mayele API disponible sur http://localhost:${env.port}`)
})

let shuttingDown = false

function shutdown(signal: string) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  const backgroundStops = Promise.allSettled([stopOutboxDispatcher(), stopMatchExpirationWorker()])
  closeRealtime()
  logger.info(`Signal ${signal} reçu, arrêt gracieux...`)

  server.close(async () => {
    try {
      await backgroundStops
      try {
        await prisma.$disconnect()
      } finally {
        await closeSentry()
      }
    } catch (error) {
      logger.error('Erreur pendant la déconnexion Prisma.', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    logger.info('Serveur arrêté.')
    process.exit(0)
  })

  // Forcer l'arrêt si le serveur ne se ferme pas dans les 10 secondes
  setTimeout(() => {
    logger.error('Timeout gracieux dépassé, arrêt forcé.')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
