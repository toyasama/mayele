FROM node:22-alpine AS builder

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/server/package*.json ./
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/server/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/server/scripts ./scripts

EXPOSE 4000

CMD ["sh", "-c", "npm run db:check-domain && npm run prisma:migrate:deploy && node dist/server.js"]
