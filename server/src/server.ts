import { createApp } from './app.js'
import { assertProductionEnv, env } from './config/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { initSentry } from './lib/sentry.js'
import { initRealtime } from './realtime/notifications.js'
import { createServer } from 'node:http'

assertProductionEnv()
initSentry()

const app = createApp()
const httpServer = createServer(app)

initRealtime(httpServer)

const server = httpServer.listen(env.port, () => {
  logger.info(`Mayele API disponible sur http://localhost:${env.port}`)
})

let shuttingDown = false

function shutdown(signal: string) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  logger.info(`Signal ${signal} reçu, arrêt gracieux...`)

  server.close(async () => {
    try {
      await prisma.$disconnect()
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
