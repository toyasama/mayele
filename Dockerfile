FROM node:20-alpine AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY server/package*.json server/
RUN cd server && npm ci --omit=dev

COPY server/src server/src
COPY --from=client-builder /app/client/dist client/dist

RUN mkdir -p server/data

EXPOSE 4000

CMD ["node", "server/src/index.js"]
