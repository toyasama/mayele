# Guide de deploiement production - Mayele Maths v2

## Architecture cible

```text
Client React/Vite -> Vercel
API Express TypeScript -> Railway
Auth -> Clerk
Database -> Neon Postgres
ORM/Migrations -> Prisma
```

SQLite n'est plus utilise en production. Les donnees applicatives vivent dans Neon Postgres. Clerk est la source de verite pour l'identite; Postgres stocke seulement le profil joueur et les donnees de jeu.

## 1. Creer les services cloud

1. Creer une app Clerk.
2. Creer une base Neon Postgres avec deux branches :
   - `production` pour Railway.
   - `dev` pour le developpement local.
3. Creer un service Railway depuis le repo GitHub.
4. Creer un projet Vercel avec `client/` comme root directory.

## 2. Variables d'environnement

### Local development

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

Le local utilise la branche Neon `dev`. Ne pas utiliser la branche `production` pour les tests locaux.

### Railway API

Railway utilise la branche Neon `production`.

```env
NODE_ENV=production
PORT=4000
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
DATABASE_URL=postgresql://...pooled...?sslmode=require
DIRECT_URL=postgresql://...direct...?sslmode=require
CORS_ORIGINS=https://mayele-learning.com,https://www.mayele-learning.com
```

`DATABASE_URL` sert au runtime API. `DIRECT_URL` sert aux migrations Prisma.

### Vercel client

```env
VITE_API_URL=https://api.mayele-learning.com/api
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx
```

Ne jamais exposer `CLERK_SECRET_KEY`, `DATABASE_URL` ou `DIRECT_URL` dans Vercel client.

`VITE_API_URL` est une configuration publique du client. Pour `production`, elle doit pointer vers Railway avec le chemin `/api`.

Le websocket Socket.IO est derive de `VITE_API_URL`. Avec `VITE_API_URL=https://api.mayele-learning.com/api`, le client se connecte a `https://api.mayele-learning.com/socket.io`.

`VITE_REALTIME_URL` est optionnel et ne doit etre ajoute que si le temps reel est deplace sur une origine differente de l'API. Dans ce cas, la valeur doit etre une origine HTTPS sans chemin.

Pour `vercel dev`, `VITE_API_URL` peut rester sur `http://localhost:4000/api`.

## 3. Deploiement Railway API

Railway utilise le `Dockerfile` racine. L'image build uniquement le serveur TypeScript.

Au demarrage du container, Railway laisse le `CMD` du `Dockerfile` executer :

```bash
npm run prisma:migrate:deploy && npm run db:check-domain && node dist/server.js
```

Cela applique les migrations Prisma, verifie les contraintes de domaine, puis lance l'API.

Endpoints a verifier :

```bash
curl https://api.mayele-learning.com/api/health
curl https://api.mayele-learning.com/api/ready
```

`/api/health` verifie le process API. `/api/ready` verifie la connexion Postgres et l'initialisation Socket.IO en production.

## 4. Deploiement Vercel client

Configurer Vercel :

- Root directory: `client`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm ci`

Le fichier `client/vercel.json` redirige les routes SPA vers `index.html`.

## 5. Verification fonctionnelle

1. Ouvrir `https://mayele-learning.com`.
2. Creer un compte via Clerk.
3. Lancer un sprint.
4. Verifier que `/api/sessions` retourne `201`.
5. Ouvrir le dashboard.
6. Ouvrir la page multijoueur et verifier que le statut temps reel est connecte.
7. Verifier dans Neon que `players`, `game_sessions`, `answers`, `daily_stats` sont alimentes.

## 6. Workflow de livraison

Avant un push important :

```powershell
.\build-prod.ps1
```

Puis :

```bash
git add .
git commit -m "Production v2"
git push
```

Railway deploie l'API. Vercel deploie le client.

## 7. Bonnes pratiques

- Les migrations Prisma sont versionnees dans `server/prisma/migrations`.
- Ne jamais modifier la DB au demarrage hors `prisma migrate deploy`.
- Garder des environnements Clerk/Neon separes pour local, preview et production.
- Le local pointe vers Neon `dev`.
- Railway production pointe vers Neon `production`.
- Restreindre `CORS_ORIGINS` aux domaines Vercel autorises.
- Ajouter un monitoring d'erreurs avant d'ouvrir l'app a de vrais utilisateurs.
