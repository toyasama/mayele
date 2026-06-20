import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

const adapter = new PrismaPg(env.databaseUrl || 'postgresql://postgres:postgres@localhost:5432/mayele')
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (!env.isProduction) {
  globalForPrisma.prisma = prisma
}
