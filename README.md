# Mayele Maths

Application d'entraînement au calcul mental avec compte joueur, sprints de 60 secondes et suivi de progression.

## Structure

- `client/` : interface React/Vite
- `server/` : API Express, authentification et stockage SQLite local

## Lancer en local

### Backend

```powershell
cd server
npm install
npm run dev
```

### Frontend

```powershell
cd client
npm install
npm run dev
```

## Accès

- Local : `http://localhost:5173`
- API : `http://localhost:4000/api/health`

## Fonctionnalités

- inscription et connexion
- sprints de calcul mental de 60 secondes
- modes addition, soustraction, multiplication et mixte
- niveaux débutant, intermédiaire, avancé et expert
- tableau de bord avec records, précision, points, séries et historique

## Vérification

```powershell
cd client
npm run lint
npm run build
```
