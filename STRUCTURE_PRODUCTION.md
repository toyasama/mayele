# Structure production v2

## Vue d'ensemble

```text
mayele/
  client/                 React/Vite pour Vercel
  server/                 API Express TypeScript pour Railway
  server/prisma/          Schema et migrations Prisma
  Dockerfile              Image API-only Railway
  railway.json            Healthcheck et commande de demarrage API
```

## Frontend

Le client utilise `@clerk/react`.

- `VITE_CLERK_PUBLISHABLE_KEY` initialise Clerk.
- `VITE_API_URL` pointe vers l'API Railway.
- Les appels prives recuperent un token Clerk via `getToken()` et l'envoient en `Authorization: Bearer`.
- Aucun JWT maison n'est stocke en `localStorage`.

## Backend

Le serveur est en TypeScript ESM.

- `src/app.ts` configure Express, CORS, JSON, Clerk et les routes.
- `src/server.ts` lance le process HTTP.
- `src/services/` contient la logique metier.
- `src/schemas/` valide les payloads avec Zod.
- `src/lib/prisma.ts` instancie Prisma avec l'adapter Postgres.

Routes publiques :

- `GET /api/health`
- `GET /api/ready`

Routes privees :

- `GET /api/me`
- `GET /api/dashboard`
- `GET /api/practice-plan`
- `POST /api/sessions`

## Base de donnees

Neon Postgres remplace SQLite.

Tables principales :

- `players`
- `game_sessions`
- `answers`
- `achievements`
- `daily_stats`

Les migrations vivent dans `server/prisma/migrations`. Le serveur ne cree ni ne supprime de tables au demarrage.

## Deploiement

Railway execute :

```bash
cd /app/server && npm run prisma:migrate:deploy && node dist/server.js
```

Vercel build le client :

```bash
npm run build
```

Le fichier `client/vercel.json` gere le fallback SPA.
