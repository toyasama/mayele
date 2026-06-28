# Demarrage rapide production v2

## Stack

- Frontend: Vercel, root `client/`
- API: Railway, Dockerfile racine
- Auth: Clerk
- DB: Neon Postgres
- Migrations: Prisma

## Checklist

1. Creer Clerk et copier `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
2. Creer Neon avec deux branches :
   - `production` pour Railway.
   - `dev` pour le developpement local.
3. Configurer Railway avec les variables serveur.
4. Configurer Vercel avec les variables client.
5. Lancer localement :

```powershell
.\build-prod.ps1
```

6. Push sur GitHub.
7. Verifier :

```bash
curl https://api.mayele-learning.com/api/health
curl https://api.mayele-learning.com/api/ready
```

## Variables Railway

Railway doit pointer vers la branche Neon `production`.

```env
NODE_ENV=production
PORT=4000
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGINS=https://mayele-learning.com,https://www.mayele-learning.com
```

## Variables Vercel

```env
VITE_API_URL=https://api.mayele-learning.com/api
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx
```

## Variables locales

Le local doit pointer vers la branche Neon `dev`, jamais vers `production`.

`client/.env.local` :

```env
VITE_API_URL=http://localhost:4000/api
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
```

`server/.env.local` :

```env
NODE_ENV=development
PORT=4000
CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
DATABASE_URL=postgresql://...dev...
DIRECT_URL=postgresql://...dev...
CORS_ORIGINS=http://localhost:5173
```
