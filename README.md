# Mayele Maths

Application d'entrainement au calcul mental avec compte joueur, sprints de 60 secondes et suivi de progression.

## Architecture v2

- `client/` : React/Vite, auth Clerk, deploiement Vercel
- `server/` : API Express TypeScript, auth Clerk, Prisma, Neon Postgres, deploiement Railway

SQLite et l'auth JWT maison ne sont plus utilises.

## Lancer en local

Creer les fichiers `.env.local`/`.env` necessaires a partir des exemples :

- `client/.env.example`
- `server/.env.example`

### Backend

```powershell
cd server
npm install
npm run prisma:generate
npm run dev
```

### Frontend

```powershell
cd client
npm install
npm run dev
```

## Acces local

- Client : `http://localhost:5173`
- API health : `http://localhost:4000/api/health`
- API ready : `http://localhost:4000/api/ready`

## Verification

```powershell
.\build-prod.ps1
```

Ou separement :

```powershell
cd server
npm run typecheck
npm run test
npm run build

cd ../client
npm run lint
npm run test
npm run build
```

## Deploiement

Lire [DEPLOYMENT_GUIDE_FR.md](DEPLOYMENT_GUIDE_FR.md).
