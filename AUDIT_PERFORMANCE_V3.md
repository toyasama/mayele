# Audit de performance V3

Date : 18 juillet 2026

## Périmètre et méthode

L'audit suit cet ordre : journaux runtime, temps API, waterfall navigateur, requêtes Prisma, cache et bundle. Les mesures navigateur sont produites par `client/e2e/performance.spec.ts` sur un client compilé E2E et une API locale reliée à la base de développement distante.

Ces chiffres sont des mesures reproductibles de développement, pas des Core Web Vitals de production. Ils servent à comparer l'architecture avant/après dans le même environnement.

## Preuves avant modification

L'agrégation de `e2e-latest.log` montrait :

| Endpoint | Échantillons | Moyenne | P95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| `/api/dashboard` | 66 | 763 ms | 1 217 ms | 1 388 ms |
| `/api/matches/room-overview` | 213 | 528 ms | 967 ms | 1 168 ms |
| `/api/friends/overview` | 70 | 132 ms | 254 ms | 362 ms |
| `/api/notifications` | 176 | 117 ms | 198 ms | 505 ms |
| `/api/me` | 128 | 40 ms | 51 ms | 634 ms |

Les mêmes journaux contenaient 54 dashboards et 97 room-overviews au-dessus de 500 ms. Plusieurs séquences lançaient deux dashboards et plusieurs room-overviews quasi simultanément.

Causes confirmées :

1. `App.tsx` préchargeait dashboard et social sur toutes les routes authentifiées. Une page de jeu déclenchait donc `/me`, notifications, dashboard et social sans utiliser ces données.
2. Deux composants pouvaient lancer le même GET au même instant sans partager la requête.
3. Deux dashboards simultanés contournaient le cache serveur tant que le premier calcul n'était pas terminé.
4. `loadDashboard` exécutait 18 agrégations dans une transaction Prisma. Sur la base distante, ces lectures indépendantes étaient sérialisées.
5. `listMatches` enrichissait chaque salon avec deux nouvelles recherches d'historique : forme `1 + 2N` pour N salons visibles.
6. Le profil ami reconstruisait le dashboard complet de l'ami, y compris missions, sessions détaillées et données privées inutiles à cette vue.
7. Le bundle initial restait important : 407,30 kB de JavaScript brut (121,76 kB gzip) et 229,07 kB de CSS global (39,83 kB gzip).

Les logs runtime ne montrent pas de 5xx récurrent expliquant les lenteurs. Un ancien `EADDRINUSE` correspond à un redémarrage de serveur de développement, pas au temps de réponse normal.

## Corrections intégrées

### Chargement client

- Suppression du préchargement global des données dashboard et sociales. Chaque route ne demande plus que ses données utiles.
- Coalescence des GET identiques déjà en vol dans `api.ts`. La clé inclut le chemin et le token de session : aucune réponse ne peut être partagée entre deux utilisateurs.
- Ajout de tests couvrant le partage concurrent, la fin de vie de l'entrée et l'isolation entre sessions.
- Chargement différé de Sentry quand un DSN est réellement configuré.

### Dashboard serveur

- Cache étendu de 15 à 60 secondes. Les écritures de session et de profil continuent de l'invalider explicitement.
- Ajout d'un cache de promesse pour empêcher deux calculs concurrents du même dashboard.
- Une invalidation pendant un calcul empêche la promesse ancienne de repeupler le cache.
- Les 18 projections analytiques en lecture seule sont exécutées en parallèle. Les mutations restent transactionnelles et authoritative.

### Multijoueur serveur

- L'enrichissement d'une liste de salons charge maintenant l'historique en une requête groupée.
- Complexité de l'enrichissement : `2N` requêtes d'historique avant, `1` requête après.
- Test de non-régression avec deux salons et vérification du bilan calculé.

### Profil ami

- Loader public dédié : il ne construit plus le dashboard complet.
- Les statistiques publiques et badges sont calculés sans charger missions, réponses récentes, objectifs quotidiens ou historique solo détaillé.
- Le même endpoint renvoie le bilan des défis directs et les trois derniers défis. La vue n'a donc pas besoin d'un GET `/matches` ou `/dashboard` supplémentaire.

## Mesures après modification

Mesure finale Playwright, contextes navigateur froids :

| Route | Prête en | Requête métier | Temps API | Requêtes inutiles constatées |
| --- | ---: | --- | ---: | ---: |
| Solo | 356 ms | aucune | — | 0 dashboard, 0 social |
| Dashboard | 463 ms | `/api/dashboard` | 149 ms | 0 social, 1 dashboard |
| Multijoueur | 248 ms | `/api/matches/room-overview` | 288 ms | 1 room-overview |
| Profil ami | 471 ms | `/api/friends/:id/profile` | 125 ms | 0 dashboard, 0 matches |

Comparaison directe du dashboard dans le même harnais, juste avant/après la parallélisation des lectures :

| Mesure | Avant | Après | Évolution |
| --- | ---: | ---: | ---: |
| API dashboard à froid | 726 ms | 149 ms | -79 % |
| Vue dashboard prête | 1 472 ms | 463 ms | -69 % |

Le test `performance.spec.ts` impose aussi les invariants réseau : aucun préchargement dashboard/social en solo, un seul dashboard sur sa route, aucun dashboard depuis le profil ami et au plus deux room-overviews pendant la fenêtre observée. La mesure finale en a observé un seul.

## Bundle : résultat et limite assumée

Le JavaScript initial est presque inchangé après les évolutions UI concurrentes : 406,96 kB brut, 121,74 kB gzip. Le CSS global atteint désormais 244,23 kB brut, 42,17 kB gzip. La régression CSS vient de nouvelles surfaces visuelles ajoutées pendant ce lot ; elle n'est pas masquée par cet audit.

Le prochain lot performance doit :

1. sortir les feuilles social, multijoueur, dashboard et authentification de `index.css` pour profiter du code splitting par route ;
2. analyser le chunk initial Clerk/Socket/observabilité avec un visualiseur de bundle ;
3. ne connecter le temps réel que pour les fonctionnalités qui en ont besoin, ou après le premier rendu utile ;
4. servir client et API sous une même origine en production si l'infrastructure le permet, afin d'éviter les préflights CORS authentifiés ;
5. remplacer le nettoyage de matchs périmés exécuté à chaque room-overview par un balayage borné/planifié ;
6. ajouter des mesures Web Vitals et traces SQL en production avant toute nouvelle optimisation de base.

## Validation

- Client : suite complète réussie avant le dernier test d'isolation, puis 8/8 tests API ciblés, lint et build réussis.
- Serveur : 154/154 tests, build et typecheck réussis.
- Performance E2E : 1/1 scénario, quatre routes froides, réussi.
- `git diff --check` : aucune erreur de diff ; seul un avertissement de normalisation CRLF/LF a été signalé.

## Contre-mesure après intégration visuelle finale

Une seconde exécution complète a été lancée après les derniers ajustements du multijoueur. Les invariants réseau restent identiques : zéro dashboard/social sur le solo, un dashboard sur sa page, un seul `room-overview`, et zéro dashboard/matches sur le profil ami.

La base distante introduit une variabilité visible : cette seconde passe a mesuré 275 ms pour l'API dashboard et 1 146 ms jusqu'à la vue prête, contre 149 ms et 463 ms lors de la première passe. Le multijoueur était prêt en 480 ms avec un `room-overview` à 374 ms ; le profil ami en 582 ms avec son endpoint à 156 ms. Ces chiffres confirment la suppression des doublons et du travail inutile, mais montrent aussi qu'un SLO de production ne doit pas être déduit d'une base de développement distante. La suite doit conserver les invariants de requêtes et ajouter des mesures p50/p95 en production.
