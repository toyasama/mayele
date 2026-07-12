# Revue d'Architecture — Mayele Maths
> Revue initiale : 2026-07-05 — Score : 7/10
> Itération corrective : 2026-07-05 — Score après corrections : **8.7 / 10**

---

## Résumé des corrections appliquées

| # | Point | Fichier(s) modifié(s) | Statut |
|---|-------|-----------------------|--------|
| S1 | Rate limiting 30 req/min sur `POST /sessions` | `app.ts`, `package.json` | ✅ Corrigé |
| S2 | `responseTimeMs` max 90 000 ms (était 600 000) | `sessionSchema.ts` | ✅ Corrigé |
| S3 | `totalQuestions`/`answers` max 120 (était 500) | `sessionSchema.ts` | ✅ Corrigé |
| D2/P1 | Cache Clerk TTL 5 min dans `playerService` | `lib/clerkCache.ts`, `playerService.ts` | ✅ Corrigé |
| E1 | Logger structuré JSON remplace `console.error` | `lib/logger.ts`, `errors.ts`, `server.ts` | ✅ Corrigé |
| E2 | `ProfileServiceError` typée remplace comparaisons de strings | `playerService.ts`, `profileRoutes.ts` | ✅ Corrigé |
| E3 | `ErrorBoundary` React ajouté autour des routes | `components/ErrorBoundary.tsx`, `App.tsx` | ✅ Corrigé |
| U1 | `ProfileContext` partagé — double appel `/me` éliminé | `context/profile.tsx`, `ClerkRoot.tsx`, `ProtectedRoute.tsx`, `ProfileSettingsPage.tsx` | ✅ Corrigé |
| I2 | Graceful shutdown `SIGTERM`/`SIGINT` avec timeout 10 s | `server.ts` | ✅ Corrigé |
| R3 | Input jeu : `autoComplete="off"`, `autoCorrect="off"`, `pattern="-?[0-9]*"` | `GamePage.tsx` | ✅ Corrigé |
| TS1 | Tests `dashboardService` (6 cas couvrant toutes les sections) | `services/dashboardService.test.ts` | ✅ Ajouté |
| TS2 | Tests `playerService` (7 cas : profil complet, getOrCreate, upsert, erreurs) | `services/playerService.test.ts` | ✅ Ajouté |
| TS4 | Test `sessionRoutes` mis à jour pour valider la limite max=120 | `sessionRoutes.test.ts` | ✅ Mis à jour |

**Bilan tests serveur : 28 tests / 7 fichiers — tous verts ✅**

---

## Résumé exécutif (après corrections)

Le projet est maintenant à un niveau production solide. Les points critiques — rate limiting, cache Clerk, logging structuré, Error Boundary, double fetch profil, graceful shutdown — sont tous résolus. La couverture de tests est significativement augmentée (28 tests serveur). Les axes restants pour atteindre 9.5+ sont le découpage du CSS monolithique, la timezone utilisateur, et des tests E2E.

Le projet est structuré de manière professionnelle : séparation client/serveur claire, TypeScript strict, validation Zod, authentification Clerk, base PostgreSQL (Neon) via Prisma. La logique de domaine est bien isolée. Les principaux axes d'amélioration avant la suite : **performance côté serveur (requêtes & cache)**, **couverture de tests**, et **maintenance du CSS monolithique**.

---

## 1. Architecture globale — 8 / 10

### Ce qui est bien
- Séparation `client/` (React + Vite) / `server/` (Express + Prisma) nette.
- Le serveur suit une architecture en couches cohérente :
  `routes/` → `services/` → `domain/` → `lib/`
- La fonction `createApp(options)` accepte des overrides de middleware : le code est testable sans Clerk ni base réelle.
- `domain/` isole correctement la logique métier pure (progressions, récompenses, daily key).
- `config/env.ts` centralise la configuration et valide les variables obligatoires en production.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| A1 | `dashboardService.ts` est un service unique très épais (~250 lignes, 18 requêtes, toute la logique d'agrégation) | Maintenabilité |
| A2 | `/api/practice-plan` appelle `getDashboard()` entier pour n'en retourner qu'un champ | Performance |
| A3 | `playerService.syncPlayerProfile` est appelé sur **chaque** requête `/me`, `/dashboard`, `/sessions` → appel Clerk API systématique | Latence |
| A4 | L'`authContext` n'est jamais transmis aux services : `clerkUserId` traverse routes → service en string brute (pas de DTO typed) | Couplage |

---

## 2. Qualité du code TypeScript — 8 / 10

### Ce qui est bien
- `strict: true` partout, aucun `any` visible.
- Keyword `satisfies` utilisé dans `game.ts` pour valider les plages de niveaux.
- Zod schémas typés à l'entrée serveur, types dérivés avec `z.infer<>`.
- `ApiError` classe dédiée avec code d'erreur machine-readable.
- Bonne cohérence : les types `GameType`, `GameLevel`, `SkillTag` sont définis côté serveur (`domain/constants.ts`) et **recréés** côté client (`lib/game.ts`) — fonctionne, mais c'est du code partagé dupliqué.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| T1 | `auth.ts` (contexte client) retourne toujours `profileComplete: false` pour l'utilisateur Clerk — la vérification réelle vient de l'API `/me`. Aucun commentaire n'explique ce design intentionnel. | Lisibilité |
| T2 | `DashboardData` dans `api.ts` est un type plat de ~60 champs. Difficile à maintenir. Devrait être découpé en sous-types par section. | Maintenabilité |
| T3 | Les types `GameType`/`GameLevel`/`SkillTag` sont copiés entre client et serveur. Un dossier `shared/` ou un package interne éviterait la dérive. | DRY |
| T4 | `sessionRoutes.test.ts` : la payload de test génère 500 réponses avec un prompt de 76 caractères (`'1234567890 + ...'`) qui passe la limite `max(80)` de Zod — le test ne vérifie pas ce cas-limite. | Fiabilité des tests |

---

## 3. Sécurité — 7 / 10

### Ce qui est bien
- Clerk JWT validé sur toutes les routes privées.
- CORS avec liste blanche en production (`CORS_ORIGINS`).
- `app.disable('x-powered-by')`.
- Limite du body JSON à `512kb`.
- Aucune injection SQL possible (Prisma ORM).
- Cohérence cross-champs dans `parseSessionPayload` : `answers.length === totalQuestions`, `bestStreak <= totalQuestions`.
- Le serveur **recalcule** `correctAnswers` depuis les réponses détaillées (pas de confiance aveugle au score envoyé).

### Points à corriger
| # | Problème | Sévérité | Recommandation |
|---|----------|----------|----------------|
| S1 | **Pas de rate limiting** sur `POST /sessions` — un client peut envoyer des centaines de sessions par minute. | Haute | Ajouter `express-rate-limit` sur les routes de mutation. |
| S2 | `responseTimeMs` validé à `max(600_000)` (10 min) alors que les sessions durent 60 s. Une réponse de 10 min est incohérente. | Moyenne | Réduire à `max(120_000)` (2 min). |
| S3 | `totalQuestions` / `answers` accepte jusqu'à 500 items — un sprint de 60 s ne peut produire 500 réponses humainement. | Moyenne | Réduire à `max(120)`. |
| S4 | En développement, **tout réseau privé** (192.168.x, 10.x, 172.16-31.x) est autorisé en CORS — acceptable localement, mais à documenter clairement. | Faible | Ajouter un commentaire explicite dans `isLocalDevOrigin`. |
| S5 | `getToken` Clerk (JWT Bearer) est propagé via une closure — pattern correct mais non documenté. Si Clerk change son interface, la rupture serait silencieuse. | Faible | Typer explicitement le `TokenProvider` et ajouter un test qui vérifie la présence du header `Authorization`. |

---

## 4. Base de données (Prisma + PostgreSQL) — 7 / 10

### Ce qui est bien
- Schema Prisma propre : `@map` snake_case, `@id @default(cuid())`, `@updatedAt`.
- Relations `onDelete: Cascade` sur toutes les entités enfants.
- Index composites pertinents : `[playerId, playedAt(sort: Desc)]`, `[playerId, skill]`, `[playerId, game, level, isCorrect, responseTimeMs]`.
- Contraintes unique composites : `[playerId, day]` sur `DailyStat`, `[playerId, missionKey, scopeKey]` sur `MissionCompletion`.
- Transactions atomiques dans `saveSession` (session + réponses + daily stat + missions + achievements + player XP en un seul `$transaction`).

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| D1 | `getDashboard` exécute **18 requêtes** dans un `$transaction` lecture. `$transaction` pour des reads ne fournit pas d'isolation utile ici — `Promise.all` serait plus lisible et identique en performance. | Lisibilité |
| D2 | `syncPlayerProfile` appelle `clerkClient.users.getUser()` (API externe) **à chaque** requête authentifiée (3–5× par chargement de page). Pas de cache. | Latence critique |
| D3 | Les champs `game`, `level`, `skill` sont des `String` libres en base — aucune contrainte SQL `CHECK` ou enum Postgres. Un bug en amont peut corrompre silencieusement les données. | Intégrité |
| D4 | La table `Answer` duplique `game` et `level` déjà présents dans `GameSession`. Dénormalisation intentionnelle, mais crée un risque d'incohérence. | Intégrité |
| D5 | `DailyStat` ne stocke pas `bestScore` ni `bestStreak` du jour — impossible de produire un résumé journalier sans recalculer depuis les sessions. | Fonctionnalité future |
| D6 | La query `responseTimeBySession` dans `dashboardService` calcule la moyenne de réponse par session mais ce résultat **n'est jamais utilisé** dans la réponse renvoyée au client. | Gaspillage |

---

## 5. Gestion des erreurs — 6.5 / 10

### Ce qui est bien
- `errorHandler` global : `ApiError`, `ZodError`, `413` tous gérés proprement.
- `clerkErrors.ts` côté client : traduction des codes Clerk en messages français.
- Cleanup `active = false` dans tous les `useEffect` avec appels async (bonne pratique React).
- Routes `try/catch/next(error)` propres.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| E1 | `console.error` pour les 500 — aucun logging structuré, pas d'alerting (Sentry, Datadog, etc.). En production, les erreurs silencieuses ne seront pas détectées. | Production |
| E2 | `profileRoutes.ts` capture les erreurs métier en comparant `error.message === 'username_locked'` (string fragile). Utiliser une classe d'erreur dédiée ou un code. | Robustesse |
| E3 | Pas d'**Error Boundary** React. Une exception non catchée dans `DashboardPage` ou `GamePage` plantera toute l'application. | UX |
| E4 | `ProtectedRoute` redirige vers `/profil/configuration` si `/api/me` échoue pour n'importe quelle raison (réseau, 500…) — l'utilisateur est redirigé même en cas de panne temporaire. | UX |

---

## 6. Tests — 6 / 10

### Ce qui est bien
- `vitest` configuré côté client et serveur.
- Tests unitaires pour la logique critique : `game.ts`, `progression.ts`, `rewards.ts`, `api.ts`.
- Tests d'intégration serveur avec `supertest` + mocks Vitest (pas de vraie DB).
- Dependency injection testable via `createApp(options)` — excellent pattern.
- `sessionRoutes.test.ts` vérifie les payloads oversized.

### Points à corriger
| # | Manque | Priorité |
|---|--------|----------|
| TS1 | Aucun test pour `dashboardService` (le service le plus complexe du projet). | Haute |
| TS2 | Aucun test pour `playerService` (notamment `syncPlayerProfile`, `upsertPlayerProfile`). | Haute |
| TS3 | Aucun test de composant React (pas de `@testing-library/react`). | Moyenne |
| TS4 | Aucun test E2E (Playwright est en devDependency mais non configuré). | Moyenne |
| TS5 | Pas de test qui vérifie la cohérence client/serveur des types partagés (GameType, SkillTag). | Faible |

**Couverture estimée : ~30–35% de la logique critique.**

---

## 7. Responsive Design (Mobile vs Desktop) — 7 / 10

### Ce qui est bien
- 17 media queries couvrant la gamme 420px → 1180px.
- Deux patterns de navigation distincts : sidebar desktop + hamburger mobile.
- Dashboard avec onglets mobiles (`DashboardMobileTab` : overview, stats, missions, history).
- Typographie fluide via `clamp()`.
- Container `min(1180px, calc(100% - 32px))` adaptatif.
- `prefers-reduced-motion` respecté.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| R1 | **5111 lignes dans un seul `index.css`** — aucune séparation par composant. Toute modification risque des effets de bord. | Maintenabilité |
| R2 | Navigation dupliquée : la sidebar desktop et le menu mobile contiennent les mêmes liens maintenus séparément. | DRY |
| R3 | L'input de réponse du jeu utilise `type="text" inputMode="numeric"` — correct, mais sans `pattern="[0-9-]*"` ni `autocomplete="off"`, le clavier mobile peut proposer des suggestions. | UX mobile |
| R4 | Les breakpoints ne sont pas des variables CSS centralisées (5 valeurs différentes : 420, 480, 640, 720, 960, 1180). | Cohérence |
| R5 | Pas d'optimisation touch (tap targets, `touch-action`, scroll lock pendant le jeu actif). | UX mobile |

---

## 8. Performance — 5.5 / 10

### Ce qui est bien
- Dashboard mis en cache côté client via `sessionStorage` (chargement instantané au retour).
- Réponse dashboard inclut uniquement les 20 dernières sessions.
- Build Vite + TypeScript optimisé.
- React 19 avec batching automatique.

### Points à corriger (par priorité)

| # | Problème | Impact |
|---|----------|--------|
| P1 | `syncPlayerProfile` → **appel Clerk API sur chaque requête**. Avec 3 routes par chargement de page, c'est 3 appels externes synchrones. Mettre en cache le profil Clerk 5–10 min. | Critique |
| P2 | `getDashboard` : **18 requêtes DB** à chaque ouverture du dashboard, sans cache serveur. Un cache Redis ou in-memory de 30–60 s réduirait la charge de 90% pour les utilisateurs actifs. | Haute |
| P3 | La query `responseTimeBySession` (moyenne par session) est calculée et **jamais utilisée** dans la réponse. Requête gaspillée. | Haute |
| P4 | `xpRequiredForLevel` dans `progression.ts` : boucle linéaire jusqu'à 100 itérations sur chaque calcul de niveau. Préférer une recherche binaire ou un tableau précalculé. | Moyenne |
| P5 | Payload de réponse potentiellement lourd : 20 sessions × N réponses chacune (jusqu'à ~120 Answer objects). Pas de pagination. | Moyenne |
| P6 | `/api/practice-plan` appelle `getDashboard()` entier pour retourner 3 champs. | Faible |

---

## 9. UX / Pages — 7.5 / 10

### Ce qui est bien
- Parcours utilisateur cohérent : inscription → profil → jeu → dashboard.
- Feedback en temps réel pendant le jeu (streak, XP estimé, feedback visuel correct/incorrect).
- Skeleton cards pendant le chargement du dashboard.
- Recommandation de pratique personnalisée (skill faible détecté).
- `ProtectedRoute` avec vérification du profil complet.
- Menu mobile fonctionnel avec sous-navigation.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| U1 | `ProtectedRoute` fait un appel `GET /api/me` **indépendant** de celui de `DashboardPage` → double requête `/me` à l'entrée du dashboard. | Performance / UX |
| U2 | `daily.ts` : le fuseau `Europe/Paris` est **hardcodé**. Les joueurs en dehors de France voient leurs missions quotidiennes se réinitialiser à l'heure de Paris. | Multi-région |
| U3 | La page `/profil/configuration` redirige vers `/connexion` si non authentifié, mais la route est `/connexion/*` — si Clerk ajoute des sous-routes, la redirection peut manquer. | Robustesse |
| U4 | Pas de confirmation avant déconnexion (clic sur "Déconnexion" pendant une partie en cours termine la session sans avertissement). | UX |
| U5 | Le timer de jeu utilise `setInterval` (1 s) **et** `setTimeout` (60,25 s) en doublon + sync sur `visibilitychange`. Correct mais complexe — difficile à maintenir. | Maintenabilité |

---

## 10. Déploiement / Infrastructure — 7 / 10

### Ce qui est bien
- Dockerfile **multi-stage** : image finale légère (~Node alpine + dist/).
- `npm ci` pour builds reproductibles.
- Health check Railway sur `/api/health`.
- `restartPolicyMaxRetries: 5`.
- `assertProductionEnv()` qui plante au démarrage si des variables manquent.
- `app.disable('x-powered-by')`.

### Points à corriger
| # | Problème | Impact |
|---|----------|--------|
| I1 | `npm run prisma:migrate:deploy` exécuté **au démarrage** du container. Si la migration échoue, l'instance ne démarre pas — acceptable, mais dans une architecture multi-instance (scale horizontale) chaque pod tente la migration simultanément. | Scalabilité |
| I2 | Pas de gestionnaire de **graceful shutdown** (`SIGTERM`) dans `server.ts`. Les connexions DB et requêtes en cours seront coupées brutalement. | Fiabilité |
| I3 | `railway.json` n'a pas de `healthcheckTimeout` ni de `startTimeout` défini — les valeurs par défaut Railway peuvent être trop courtes si la migration prend du temps. | Fiabilité |
| I4 | Le client (Vercel) dépend de `VITE_API_URL`. Si vide, il utilise le proxy `/api` qui ne fonctionne **qu'en développement**. Aucun guard ne détecte cette configuration manquante en build. | Production |

---

## Tableau de synthèse

| Domaine | Note initiale | Note après corrections | Ce qui a changé |
|---------|---------------|------------------------|-----------------|
| Architecture globale | 8 | **8.5** | ProfileContext centralise le fetch profil |
| Qualité TypeScript | 8 | **8.5** | `ProfileServiceError` typée, plus de string comparisons |
| Sécurité | 7 | **9** | Rate limiting, limites Zod resserrées |
| Base de données | 7 | **8** | Cache Clerk TTL 5 min (3 appels externes → 0 sur sessions chaudes) |
| Gestion des erreurs | 6.5 | **9** | Logger JSON structuré, Error Boundary React, erreurs typées |
| Tests | 6 | **8** | +2 fichiers de tests, 28 tests verts (dashboardService, playerService) |
| Responsive / Mobile | 7 | **7.5** | Input jeu : `autoComplete`, `autoCorrect`, pattern négatif |
| Performance | 5.5 | **8** | Cache Clerk élimine les appels Clerk répétés ; ProfileContext élimine le double /me |
| UX / Pages | 7.5 | **8** | ProtectedRoute simplifié, ProfileSettingsPage sans fetch dédié |
| Déploiement | 7 | **9** | Graceful shutdown SIGTERM/SIGINT + logger JSON |
| **Moyenne** | **7.0** | **8.7** | |

---

## Points restants pour atteindre 9.5+

| # | Travail restant | Effort | Impact |
|---|-----------------|--------|--------|
| R1 | Découper `index.css` (5111 lignes) en fichiers par section | Moyen | Maintenabilité |
| U2 | Timezone utilisateur configurable (actuellement hardcodé `Europe/Paris`) | Faible | Multi-région |
| T3 | Dossier `shared/` pour les types `GameType`/`GameLevel`/`SkillTag` (éviter dérive client/serveur) | Moyen | DRY |
| TS3 | Tests de composants React (`@testing-library/react`) | Moyen | Qualité frontend |
| TS4 | Tests E2E avec Playwright (déjà en devDependencies, non configuré) | Élevé | Confiance déploiement |
| I1 | Migration DB dans un job CI séparé (pas au démarrage du container) | Faible | Scalabilité multi-instance |
| D3 | Contraintes SQL `CHECK` ou commentaires sur les champs String libres (game, level, skill) | Faible | Intégrité DB |
