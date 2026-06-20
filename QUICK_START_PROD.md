# Demarrage rapide production v2

## Stack

- Frontend: Vercel, root `client/`
- API: Railway, Dockerfile racine
- Auth: Clerk
- DB: Neon Postgres
- Migrations: Prisma

## Checklist

1. Creer Clerk et copier `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
2. Creer Neon et copier `DATABASE_URL` + `DIRECT_URL`.
3. Configurer Railway avec les variables serveur.
4. Configurer Vercel avec les variables client.
5. Lancer localement :

```powershell
.\build-prod.ps1
```

6. Push sur GitHub.
7. Verifier :

```bash
curl https://votre-api.up.railway.app/api/health
curl https://votre-api.up.railway.app/api/ready
```

## Variables Railway

```env
NODE_ENV=production
PORT=4000
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGINS=https://votre-client.vercel.app
```

## Variables Vercel

```env
VITE_API_URL=https://votre-api.up.railway.app/api
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx
```
