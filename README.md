# Mayele Maths

Plateforme locale de jeux mathématiques moderne en `React + Vite`, avec connexion utilisateur et suivi de progression via une base `SQLite`.

## Structure
- `client/` : interface web responsive
- `server/` : API Express + authentification + base locale

## Lancer le projet

### 1. Backend
```powershell
cd server
npm install
npm run dev
```

### 2. Frontend
```powershell
cd client
npm install
npm run dev
```

## Accès
- Local : `http://localhost:5173`
- Téléphone : utiliser l’URL `Network` affichée par Vite, sur le même Wi‑Fi

## Fonctionnalités prêtes
- accueil moderne
- inscription / connexion
- dashboard personnel
- sauvegarde des sessions
- suivi de progression
- mini-jeux : addition, soustraction, multiplication

## Vérifications effectuées
- build frontend OK
- API locale démarrée sur `http://localhost:4000`
- test réel d’inscription + session + dashboard validé
