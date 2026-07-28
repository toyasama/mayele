# Mayele — plan d’autorité serveur à l’échelle du site

Date de l’audit : 18 juillet 2026  
Périmètre : authentification et profil, parties solo, tableau de bord, statistiques, XP, quêtes, badges, amis, notifications, présence, cache et multijoueur.  
Nature de ce document : audit et plan de migration. Aucun fichier d’exécution n’est modifié par cet audit.

## 1. Conclusion

Mayele n’est pas encore « server-authoritative » à l’échelle du produit.

Le serveur est déjà la source de vérité pour l’identité authentifiée, le profil persisté, le graphe social, les notifications persistées, les agrégats du tableau de bord et une grande partie du cycle de vie multijoueur. Il recalcule aussi le score et l’XP d’une session à partir du détail reçu.

La faille structurante se situe en amont : pour une partie solo, le navigateur fournit encore les questions, les bonnes réponses, les temps de réponse, la durée et la meilleure série. Le serveur recalcule correctement à partir de ces valeurs, mais ne peut pas prouver qu’elles correspondent à une partie réellement jouée. Une requête répétée crée également une nouvelle session et crédite de nouveau l’XP.

La cible doit donc être la suivante :

- le serveur décide et persiste tous les faits durables et toutes les règles donnant un avantage ou modifiant l’état partagé ;
- le client envoie des intentions et des réponses, jamais un résultat faisant foi ;
- les caches, événements temps réel et états optimistes ne sont que des copies réconciliables d’un état canonique ;
- les animations, filtres, brouillons, saisies non envoyées et interpolations visuelles restent côté client.

L’ordre recommandé est :

1. rendre les parties solo et leurs récompenses vérifiables et idempotentes ;
2. introduire un reçu de commande, un journal d’XP et une outbox communs à tout le site ;
3. rendre atomiques le social et les notifications ;
4. versionner les lectures et distribuer l’invalidation des caches ;
5. terminer le protocole multijoueur authoritative déjà décrit dans `PLAN_SERVEUR_AUTHORITATIVE_V2.md` ;
6. distribuer la présence et le temps réel pour le multi-instance ;
7. fiabiliser la synchronisation Clerk et les écritures concurrentes du profil.

## 2. Règle de décision

Une donnée doit être authoritative côté serveur si elle répond à au moins une de ces conditions :

- elle attribue de l’XP, un badge, une quête, une victoire ou un classement ;
- elle est visible par un autre joueur ;
- elle autorise une action ou protège une ressource ;
- elle doit survivre à un changement d’appareil, un retry ou un redémarrage ;
- elle dépend d’une horloge, d’un aléa ou d’une règle de jeu ;
- elle déclenche une notification ou un événement métier.

Peuvent rester côté client :

- onglet, filtre, tri, panneau ouvert et préférences purement visuelles ;
- brouillon de formulaire avant soumission ;
- saisie d’une réponse avant son envoi ;
- animation, son, vibration et interpolation d’un chrono à partir d’une échéance serveur ;
- cache d’un snapshot portant une version et une règle de fraîcheur ;
- état optimiste explicitement marqué « en cours », remplacé par l’ACK ou le snapshot serveur ;
- reprise locale d’un brouillon qui ne donne aucun crédit tant qu’il n’est pas validé par le serveur.

## 3. Audit par domaine

### 3.1 Authentification et profil

| Sujet | Autorité actuelle | Validation, idempotence et concurrence | Risque | Priorité |
|---|---|---|---|---:|
| Session utilisateur | Clerk vérifie l’identité ; l’API et Socket.IO valident le jeton côté serveur | Les routes utilisent l’identité du jeton et non un identifiant joueur fourni par le client | Base saine | Fait |
| Création du joueur local | `getOrCreatePlayer` crée une ligne liée à `clerkUserId`, unique en base | Deux premières requêtes concurrentes peuvent encore se heurter à l’unicité sans stratégie explicite de relire après conflit | Erreur ponctuelle à la première connexion | P1 |
| Nom, naissance, pseudonyme, fuseau | La base Mayele fait foi après validation Zod ; le pseudonyme est verrouillé | Écriture `PUT` en dernier écrivain gagnant, sans version de profil ; le client choisit les valeurs mais le serveur les valide | Écrasement entre deux onglets ; acceptable à court terme, à versionner | P2 |
| E-mail et avatar Clerk | Une copie est stockée dans `Player`; Clerk reste implicitement la source externe | Cache Clerk mémoire 5 minutes. Un joueur déjà créé n’est pas resynchronisé à chaque lecture ; la convergence dépend d’un chemin de synchronisation ultérieur | Profil public périmé après modification dans Clerk | P1 |
| Avatar personnalisé | L’URL ou la data URL vient du client, avec validation syntaxique | Pas de stockage objet ni de contrôle de contenu serveur | Contenu externe cassé, sécurité et performance difficiles à garantir | P2 |
| `totalXp` et présence | Non modifiables par la route de profil | Bonne séparation des champs publiables et des champs système | Base saine | Fait |

Décision : Clerk est authoritative pour l’authentification et ses attributs d’identité ; Mayele est authoritative pour les attributs métier du profil. Le formulaire reste un brouillon client jusqu’à l’ACK serveur.

### 3.2 Parties solo

| Sujet | Autorité actuelle | Champs encore confiés au client | Risque | Priorité |
|---|---|---|---|---:|
| Génération des questions | Client | `prompt`, `correctAnswer`, `skill`, parfois `game` et `level` par réponse | Le client peut fabriquer une partie parfaite | P0 |
| Déroulement | Client | ordre, nombre de questions, durée et rythme | Une session peut être créée sans partie réelle | P0 |
| Temps | Client | `responseTimeMs`, `durationSeconds` | Records de vitesse et badges falsifiables | P0 |
| Série | Client | `bestStreak` | XP et badge de série falsifiables | P0 |
| Correction | Le serveur compare `userAnswer` à `correctAnswer`, mais les deux faits viennent du client | Bonne réponse déclarée par le client | Recalcul exact sur une donnée non prouvée | P0 |
| Score, points et XP | Recalculés côté serveur | Dépendent des faits précédents | Toute la progression hérite de leur fragilité | P0 |
| Soumission répétée | Une nouvelle `GameSession` est créée à chaque `POST /sessions` | Aucun identifiant de run ni clé d’idempotence | Double XP sur retry réseau ou rejeu volontaire | P0 |

Décision : les parties solo doivent utiliser le même principe que le multijoueur cible. Le serveur crée un run, choisit les questions, ne transmet pas les réponses attendues, horodate les phases et corrige les réponses. Le navigateur ne soumet que `runId`, `questionId`, `userAnswer` et une clé de commande.

### 3.3 Tableau de bord, statistiques et plan d’entraînement

| Sujet | Autorité actuelle | Cohérence | Risque | Priorité |
|---|---|---|---|---:|
| Agrégats | Calculés côté serveur depuis PostgreSQL | Les regroupements par jeu, niveau, compétence, temps et sessions sont serveur | Bonne architecture de lecture | Fait |
| Fiabilité des statistiques | Indirectement liée aux sessions | Une session solo fabriquée devient une donnée statistique légitime | Statistiques et recommandations manipulables | P0, résolu avec le protocole solo |
| Plan d’entraînement | Calculé côté serveur | Algorithme déterministe à partir des réponses stockées | Correct une fois les réponses fiables | Fait conditionnel |
| Cache serveur | `Map` mémoire, TTL 15 secondes, clé joueur/fuseau/jour | Invalidation locale après session et changement de fuseau | Stale entre instances ; cache perdu au redémarrage ; plusieurs calculs identiques simultanés | P1 |
| Cache navigateur | Snapshot persistant par utilisateur, sans enveloppe de version ni expiration explicite | Affiché immédiatement puis rafraîchi | Données anciennes visibles longtemps si le réseau échoue ; aucune protection contre un ancien snapshot écrasant un nouveau | P1 |
| Coût de lecture | Le dashboard exécute de nombreux agrégats transactionnels | Pas de read model matérialisé ni coalescence partagée | Latence croissante avec l’historique | P1, lié au chantier performance |

Décision : les statistiques restent calculées et signées logiquement par le serveur. Le client peut conserver un snapshot, mais doit recevoir `dataVersion`, `generatedAt`, `staleAt` et un `ETag`, puis ignorer toute réponse plus ancienne.

### 3.4 XP, quêtes et badges

| Sujet | Autorité actuelle | Validation, idempotence et concurrence | Risque | Priorité |
|---|---|---|---|---:|
| Calcul XP de session | Serveur | Recalculé, mais depuis des réponses solo non prouvées | Gain artificiel | P0 |
| Solde `Player.totalXp` | Serveur, incrément transactionnel | Pas de journal de mouvements ni de source unique par session | Audit et réparation difficiles ; doublon de session = doublon d’XP | P0 |
| Statistiques quotidiennes | Serveur, `upsert` par joueur et jour local | Unicité DB correcte ; incréments dans la transaction de session | Bonne concurrence une fois la session idempotente | Fait conditionnel |
| Quêtes du jour | Sélection serveur déterministe par joueur et date locale | `MissionCompletion` unique par joueur, mission et scope ; insertion avec `skipDuplicates` | Bonne protection contre le double gain de quête | Fait |
| Badges historiques | Calculés côté serveur ; `Achievement` unique par clé et joueur | Lecture préalable puis `createMany` sans `skipDuplicates` | Deux sessions concurrentes peuvent provoquer un conflit d’unicité et annuler une transaction valide | P0/P1 |
| Badges de maîtrise affichés | Dérivés des agrégats serveur | Pas nécessairement matérialisés, donc reproductibles | Base saine | Fait conditionnel |

Décision : introduire un registre d’XP append-only. `totalXp` devient une projection contrôlée, reconstruisible depuis les écritures `XpLedger`. Une source métier, par exemple `session:<id>` ou `mission:<jour>:<clé>`, ne peut créditer qu’une fois.

### 3.5 Amis, demandes et profils publics

| Sujet | Autorité actuelle | Validation, idempotence et concurrence | Risque | Priorité |
|---|---|---|---|---:|
| Recherche | Base serveur, exclusion du joueur courant | Limite de 10 ; pseudonyme normalisé | Correct | Fait |
| Demande d’ami | Base serveur, identité du jeton | Vérifications puis écriture séparées ; unicité directionnelle seulement | Deux demandes croisées ou concurrentes peuvent produire un conflit ou un état incohérent | P1 |
| Acceptation | Serveur vérifie le destinataire et l’état ; amitié canonique unique | Requête et amitié sont dans une transaction | Bon socle ; retry retourne aujourd’hui un conflit au lieu du même résultat | P1 |
| Refus, annulation, retrait | Serveur vérifie propriétaire ou relation | Mutations sûres, mais pas de reçu de commande durable | Retry peu ergonomique ; effets temps réel non rejouables | P1 |
| Notification sociale | Créée après la transaction sociale | Pas dans la même transaction et pas d’outbox | Amitié créée sans notification si le processus tombe, ou diffusion perdue | P0/P1 |
| Profil ami | Relation d’amitié vérifiée côté serveur | Les statistiques et badges viennent du dashboard serveur | Bonne confidentialité ; fiabilité dépend des sessions | Fait conditionnel |
| Historique entre deux amis | Pas de contrat condensé dédié | La future vue ne doit pas agréger des données brutes côté client | Risque de duplication de logique et de fuite de matchs | P1 fonctionnel |

Pour la vue condensée des défis entre deux amis, ajouter une lecture serveur :

```http
GET /friends/:friendId/versus?limit=5&cursor=...
```

```ts
type VersusHistory = {
  summary: {
    completedChallenges: number
    currentPlayerWins: number
    friendWins: number
    draws: number
    currentStreak: { playerId: string | null; count: number }
    lastPlayedAt: string | null
  }
  items: Array<{
    matchId: string
    playedAt: string
    challengeMode: 'sprint' | 'tempo'
    game: string
    level: string
    currentPlayer: { score: number; scorePoints: number; xp: number }
    friend: { score: number; scorePoints: number; xp: number }
    outcome: 'win' | 'draw' | 'loss'
  }>
  nextCursor: string | null
  dataVersion: string
}
```

Le serveur vérifie l’amitié, ne lit que les matchs terminés contenant exactement les deux joueurs et calcule `outcome`. Le client ne déduit jamais le gagnant à partir de fragments de réponses.

### 3.6 Notifications

| Sujet | Autorité actuelle | Validation, idempotence et concurrence | Risque | Priorité |
|---|---|---|---|---:|
| Liste et compteur | Base serveur | Maximum 20, compteur séparé mais lu en parallèle | Snapshot cohérent à quelques millisecondes près, suffisant à court terme | P2 |
| Création | Serveur, `dedupeKey` unique par destinataire | `upsert` réactive et remet en non lu une notification existante | Bonne déduplication locale | Fait |
| Marquer lu / tout lire / supprimer | Serveur, filtré par propriétaire | `updateMany` rend ces commandes naturellement répétables | Bon socle idempotent | Fait |
| Événement temps réel | Émission mémoire après mutation | Non durable, non rejouable, parfois absente pour les changements de lecture | Autres onglets ou instances temporairement incohérents | P1 |
| Atomicité métier | Notification créée hors transaction sociale ou match | Pas d’outbox commune | Mutation durable sans notification correspondante | P0/P1 |

Décision : la base est authoritative pour l’état lu/supprimé. Le temps réel transporte un signal versionné ; il ne remplace jamais la lecture canonique. Les créations liées à un métier doivent passer par une outbox écrite dans la même transaction.

### 3.7 Présence

| Sujet | Autorité actuelle | Validation, idempotence et concurrence | Risque | Priorité |
|---|---|---|---|---:|
| Connexion | Socket authentifié côté serveur | Le serveur associe lui-même socket et joueur | Bonne base | Fait |
| Activité | Le client envoie un indice actif/inactif ; le runtime serveur agrège les sockets, limite la fréquence et décide `online/away/offline` | Le client ne choisit plus directement le statut | Correct pour une instance | Fait mono-instance |
| Mode invisible | Intention client validée, état runtime serveur | Éphémère et local au processus | Perdu au redémarrage ; comportement différent entre instances | P1/P2 selon produit |
| Persistance | Écriture DB asynchrone en file mémoire ; remise hors ligne au démarrage | Heartbeat 60 secondes | Statut brièvement périmé après crash ; une instance remettrait tous les joueurs hors ligne au démarrage | P1 avant multi-instance |
| Diffusion | Rooms Socket.IO et mémoire locale | Versions de broadcast locales seulement | Ne traverse pas plusieurs instances sans adaptateur | P1 avant scale-out |

Décision : le client reste une source de signaux de visibilité, jamais la source du statut. En multi-instance, la présence éphémère doit être distribuée avec TTL par socket ; PostgreSQL ne doit conserver qu’un dernier état indicatif et, si le produit le veut, une préférence durable de visibilité.

### 3.8 Cache et temps réel

| Couche | Rôle cible | État actuel | Risque | Priorité |
|---|---|---|---|---:|
| PostgreSQL | Source canonique des faits durables | Oui pour la majorité des domaines | Les runs solo ne prouvent pas encore leurs faits | P0 |
| Mémoire Node | Accélération et état éphémère | Dashboard, Clerk, matchs, présence, reçus/événements room | Incohérent après redémarrage et entre instances | P1 |
| Local/session storage | Démarrage instantané, jamais autorité | Dashboard et social | Pas de version ni de TTL métier | P1 |
| Socket.IO | Signal de changement et commande faible latence | Plusieurs mutations et événements | Déduplication surtout mémoire ; diffusion perdue au crash | P1 |
| Redis futur | Cache distribué, pub/sub, présence TTL, leases | Absent | Le scale-out n’est pas sûr aujourd’hui | Ultérieur après journal/outbox |

Règles de cache cibles :

- toute réponse agrégée porte une version monotone ou un curseur métier ;
- une écriture commitée publie un événement d’invalidation via outbox ;
- le cache navigateur conserve `{ payload, dataVersion, generatedAt, staleAt }` ;
- une donnée périmée peut être affichée avec un état explicite, mais ne peut autoriser une mutation ;
- les mutations relisent ou retournent le snapshot canonique après commit ;
- le cache n’abrite aucun secret de question ni résultat non encore public ;
- un verrou de coalescence évite plusieurs recalculs identiques du dashboard ;
- les réponses privées utilisent `Cache-Control: private` et un `ETag`; le multijoueur actif reste `no-store` tant que son protocole de snapshot versionné n’est pas achevé.

### 3.9 Multijoueur

Le détail de migration reste dans `PLAN_SERVEUR_AUTHORITATIVE_V2.md`. À l’échelle du site, les constats utiles sont :

- authentification Socket.IO, appartenance aux rooms, transitions principales persistées et versions de configuration : déjà présentes ;
- Tempo persiste les réponses avant diffusion, mais conserve encore une partie de sa phase et de ses délais en mémoire ;
- Sprint transmet encore un seed exploitable et accepte un résultat décrit par le client ;
- `clientCommandId` est surtout dédupliqué dans le journal mémoire et perd sa garantie au redémarrage ;
- les snapshots de match en vol, révisions de room et files de persistance sont locaux au processus ;
- la cible reste : questions serveur, horloge serveur, réponses au fil de l’eau, finalisation serveur, reçus durables, outbox, reprise et multi-instance.

## 4. Matrice fait / prochain / ultérieur

| Capacité | Fait aujourd’hui | Prochain | Ultérieur |
|---|:---:|:---:|:---:|
| Jetons Clerk vérifiés par API et Socket.IO | ✓ |  |  |
| Identité de l’acteur dérivée du jeton | ✓ |  |  |
| Profil métier validé côté serveur | ✓ | Version d’écriture | Webhooks Clerk durables |
| Questions solo émises par le serveur |  | Lot 1 |  |
| Chrono et correction solo serveur |  | Lot 1 |  |
| Soumission de session solo idempotente |  | Lot 1 |  |
| Score et XP calculés côté serveur | Partiel, entrées non prouvées | Lot 1 |  |
| Registre d’XP auditable |  | Lot 2 |  |
| Quêtes tournantes et récompense unique | ✓ |  |  |
| Attribution concurrente des badges sûre |  | Lot 2 |  |
| Dashboard calculé depuis la DB | ✓ |  |  |
| Read model dashboard rapide et versionné |  | Lot 4 | Matérialisation avancée |
| Cache partagé et invalidation distribuée |  | Lot 4 | Redis multi-région si nécessaire |
| Graphe social protégé côté serveur | ✓ | Reçus de commande |  |
| Social + notifications atomiques |  | Lot 3 |  |
| Historique condensé entre deux amis |  | Lot 3/4 |  |
| État des notifications persisté | ✓ |  |  |
| Outbox et diffusion rejouable |  | Lot 2/3 |  |
| Présence décidée par le serveur | ✓ mono-instance | TTL distribué | Multi-région |
| Questions et finalisation multijoueur serveur | Tempo partiel | Lots multijoueur 1–2 |  |
| Idempotence après redémarrage |  | Lot 2 commun |  |
| Temps réel multi-instance |  |  | Lot 6 |

## 5. Architecture commune cible

### 5.1 Enveloppe de commande

Toutes les mutations significatives, HTTP ou Socket.IO, utilisent la même enveloppe logique :

```ts
type CommandEnvelope<T> = {
  commandId: string
  commandType: string
  expectedVersion?: number | string
  payload: T
}
```

En HTTP, `commandId` peut être transporté par `Idempotency-Key`. En Socket.IO, conserver `clientCommandId` pendant la compatibilité et le mapper vers le même mécanisme.

Créer `CommandReceipt` :

- `id`, `actorPlayerId`, `commandId`, `commandType` ;
- `scopeType`, `scopeId` ;
- `requestHash`, `status` ;
- `responseStatus`, `responsePayload Json?` ;
- `createdAt`, `completedAt`, `expiresAt?` ;
- unicité `(actorPlayerId, commandId)`.

Même identifiant et même hash : retourner la réponse déjà commitée. Même identifiant et payload différent : `409 idempotency_conflict`.

### 5.2 Registre d’XP

Créer `XpLedger` :

- `id`, `playerId`, `amount`, `reason` ;
- `sourceType`, `sourceId`, `scopeKey?` ;
- `sessionId?`, `missionCompletionId?`, `matchId?` ;
- `createdAt` ;
- unicité `(playerId, sourceType, sourceId)`.

`Player.totalXp` reste une projection rapide, mise à jour dans la même transaction. Un job compare régulièrement le solde à la somme du registre et alerte sans corriger silencieusement.

### 5.3 Outbox

Créer `DomainEvent` :

- `id`, `aggregateType`, `aggregateId`, `aggregateVersion` ;
- `eventType`, `payload Json`, `audiencePlayerIds Json` ;
- `commandReceiptId?`, `createdAt` ;
- `publishedAt?`, `publishAttempts`, `nextAttemptAt?`, `leaseUntil?` ;
- unicité adaptée à l’agrégat et à la version.

La mutation, le reçu, le registre d’XP éventuel, la notification persistée et l’événement outbox sont écrits dans une transaction. Le worker diffuse après commit. La livraison est au moins une fois ; chaque consommateur déduplique par `eventId` ou version.

### 5.4 Versions de lecture

Ajouter une version aux agrégats qui changent fréquemment :

- `PlayerProgressVersion(playerId, version)` ou version dérivée d’un journal ;
- version de graphe social ;
- version de notifications ;
- révision de room multijoueur.

Une réponse canonique inclut au minimum :

```ts
type ReadEnvelope<T> = {
  data: T
  dataVersion: string
  generatedAt: string
  staleAt: string
}
```

## 6. Lots de migration

### Lot 0 — Mesure et contrats

Statut : prochain, sans changement métier.

- tracer durée DB, attente token, cache hit/miss, taille de réponse et nombre de requêtes par page ;
- ajouter `commandId`, `actorPlayerId`, `aggregateId`, `dataVersion` et `instanceId` aux logs structurés ;
- définir des SLO séparés : lecture dashboard, ouverture amis, soumission réponse et ACK mutation ;
- documenter les contrats V1 actuels et ajouter un champ `protocolVersion` sans changer leur comportement ;
- mesurer les divergences entre `totalXp`, sessions, missions et badges avant migration.

Rollback : aucun changement de décision métier ; désactiver seulement l’instrumentation trop coûteuse.

### Lot 1 — Parties solo authoritative et idempotentes

Statut : P0.

Ajouter `GameplayRun` et, si nécessaire, `GameplayQuestion` :

- run lié au joueur, mode, opération, niveau, compétence, version de protocole ;
- `status`, `startedAt`, `deadlineAt`, `finishedAt`, seed secret ou questions persistées ;
- index de question courant et version ;
- réponses attendues jamais envoyées au navigateur ;
- unicité d’une réponse `(runId, questionIndex)`.

Contrats V2 proposés :

```http
POST /gameplay-runs
POST /gameplay-runs/:runId/answers
POST /gameplay-runs/:runId/finish
GET  /gameplay-runs/:runId
```

Le serveur retourne prompt, identifiant de question et deadline, mais pas `correctAnswer`. Il calcule le temps depuis ses timestamps, corrige, met à jour la série, puis finalise score, session, XP, quêtes et badges dans une transaction idempotente.

Compatibilité : conserver `POST /sessions` uniquement pour les clients V1, marquer les sessions `protocolVersion = 1`, appliquer un plafond de récompense ou désactiver leur crédit après adoption suffisante de V2. Ne jamais mélanger un run V2 et le payload libre V1.

Tests obligatoires : réponse inventée, bonne réponse forgée, index sauté, réponse double, retry après timeout, fin avant deadline, fin après deadline, deux onglets, crash avant/après commit, replay du même `commandId`, progression exacte du dashboard.

Rollback : arrêter la création de nouveaux runs V2, laisser les runs V2 existants se terminer via le protocole V2, réactiver temporairement V1 derrière un flag sans convertir leurs données.

### Lot 2 — Reçus, registre d’XP, badges concurrents et outbox commune

Statut : P0/P1.

- créer les trois tables communes décrites plus haut ;
- brancher d’abord la finalisation solo et l’attribution XP ;
- rendre l’insertion de badges sûre par contrainte et `skipDuplicates`/upsert, sans lecture préalable fragile ;
- écrire les événements `session.completed`, `xp.credited`, `mission.completed`, `badge.earned` dans la transaction ;
- migrer ensuite les commandes multijoueur vers le même reçu durable ;
- backfiller le registre d’XP avec un événement `legacy_balance` par joueur, puis journaliser uniquement les nouveaux mouvements ;
- exécuter le rapprochement en observation avant d’autoriser une correction.

Tests : 50 soumissions concurrentes d’une même session, mission et badge déclenchés simultanément, crash après commit avant diffusion, reprise du worker, réutilisation de clé avec payload différent, solde reconstructible.

Rollback : double écriture journal/projection sous flag ; si le journal échoue, bloquer les nouveaux crédits V2 plutôt que créditer sans trace. Ne jamais supprimer les reçus ou mouvements déjà écrits.

### Lot 3 — Social et notifications atomiques

Statut : P1.

- mettre demande, acceptation/refus/annulation, amitié, notification et outbox dans une transaction ;
- normaliser également les demandes avec une paire canonique ou une contrainte empêchant deux demandes croisées actives ;
- faire des retries d’acceptation et de retrait des succès idempotents quand l’état final correspond déjà à l’intention ;
- ajouter une version du graphe social et une version de boîte de notifications ;
- diffuser depuis l’outbox et réconcilier par lecture canonique ;
- ajouter l’endpoint `versus` paginé, filtré par relation et calculé côté serveur.

Tests : demandes croisées simultanées, double acceptation, suppression pendant acceptation, crash avant/après commit, notification exactement une fois dans la boîte malgré diffusion au moins une fois, révocation d’amitié avant lecture de l’historique.

Rollback : conserver les nouvelles contraintes ; repasser temporairement à la lecture complète après mutation si la diffusion outbox est en panne, tout en drainant l’outbox.

### Lot 4 — Read models, cache versionné et performance

Statut : P1.

- créer un `PlayerDashboardSnapshot` ou des agrégats incrémentaux mis à jour par les événements de session ;
- séparer le résumé immédiatement nécessaire des historiques détaillés paginés ;
- ajouter ETag/`If-None-Match`, `dataVersion`, `generatedAt` et `staleAt` ;
- introduire un cache partagé seulement après avoir une source/version canonique ;
- coalescer les recalculs concurrents et invalider par événement outbox ;
- versionner le cache navigateur et refuser toute régression de version ;
- ne pas charger le dashboard courant complet uniquement pour comparer deux joueurs : fournir un endpoint de comparaison/versus ciblé.

Tests : ancienne réponse arrivée après la nouvelle, minuit local, session commitée sur instance A et lecture sur B, cache froid/chaud, ETag 304, perte Redis, reconstruction depuis PostgreSQL, historique volumineux paginé.

Rollback : le read model est une projection ; revenir aux agrégats PostgreSQL à la demande derrière un flag. Ne jamais faire de Redis la source unique.

### Lot 5 — Multijoueur authoritative complet

Statut : P1, détaillé dans `PLAN_SERVEUR_AUTHORITATIVE_V2.md`.

- questions Sprint serveur et correction au fil de l’eau ;
- phases et deadlines Tempo persistantes ;
- finalisation sans score soumis par le client ;
- reçus et événements communs du lot 2 ;
- reprise après redémarrage.

Le mécanisme générique des lots 1 et 2 doit être réutilisé, pas dupliqué dans un second système propre aux matchs.

### Lot 6 — Présence et temps réel multi-instance

Statut : ultérieur, après l’outbox.

- Socket.IO Redis adapter pour les rooms ;
- présence par socket dans Redis avec TTL et agrégation serveur par joueur ;
- préférence invisible persistée séparément si elle doit survivre ;
- workers avec leases pour outbox et deadlines ;
- PostgreSQL reste canonique pour les mutations durables, Redis pour coordination courte et diffusion ;
- supprimer la remise globale de tous les joueurs hors ligne au démarrage dès que plusieurs instances existent ; utiliser l’expiration des TTL.

Tests : deux instances, plusieurs onglets, crash d’une instance, Redis indisponible, expiration TTL, événement rejoué, commande concurrente sur deux instances.

Rollback : revenir à une seule instance, continuer à drainer l’outbox, laisser expirer les présences Redis ; ne pas revenir à des décisions métier stockées seulement en mémoire.

### Lot 7 — Synchronisation Clerk et profil versionné

Statut : P2, P1 si les incohérences de profil deviennent fréquentes.

- consommer les webhooks Clerk `user.created`, `user.updated`, `user.deleted` avec vérification de signature ;
- ajouter `ClerkEventReceipt(eventId unique)` pour les retries ;
- mettre à jour e-mail/avatar/name externe depuis l’événement ;
- ajouter `profileVersion` et `If-Match` pour éviter l’écrasement silencieux entre onglets ;
- remplacer les data URL par un upload vers stockage objet avec type, taille, analyse et URL contrôlés ;
- relire après conflit de création `clerkUserId` plutôt que remonter une erreur.

Rollback : garder la lecture Clerk ponctuelle comme voie de réparation ; les webhooks sont additifs et rejouables.

## 7. Migrations de données proposées

Toutes les migrations sont additives pendant la transition :

1. `GameSession.protocolVersion`, `GameSession.gameplayRunId?` unique et éventuellement `GameSession.commandReceiptId?` ;
2. `GameplayRun` et `GameplayQuestionAttempt` ;
3. `CommandReceipt` générique ;
4. `XpLedger` et événement de solde legacy ;
5. `DomainEvent` outbox ;
6. compteurs/version des agrégats joueur, social et notifications ;
7. contrainte empêchant deux demandes d’amis actives opposées, après nettoyage des doublons ;
8. read model dashboard ;
9. états persistants multijoueur V2 décrits dans le plan dédié ;
10. `profileVersion` et `ClerkEventReceipt`.

Avant chaque contrainte : produire un rapport de doublons, corriger de manière déterministe, garder le rapport, puis appliquer la contrainte. Aucune colonne V1 n’est supprimée avant la fin de la période de compatibilité et de rétention.

## 8. Stratégie de tests transverse

### Contrats et autorisations

- un joueur ne peut jamais agir sur le profil, la session, la demande, la notification ou le match d’un autre ;
- tous les identifiants d’acteur sont ignorés ou refusés dans les payloads ;
- les réponses publiques n’exposent aucun secret de question ;
- le profil ami et l’historique versus deviennent inaccessibles dès le retrait d’amitié.

### Idempotence et concurrence

- même commande, mêmes octets : même statut et même réponse ;
- même commande, payload différent : conflit ;
- deux commandes concurrentes incompatibles : une seule gagne, l’autre reçoit la version canonique ;
- crash aux quatre points : avant transaction, pendant transaction, après commit avant outbox, après publication avant ACK ;
- rejeu après redémarrage et sur une autre instance.

### Cohérence des projections

- somme du registre XP égale projection `totalXp` ;
- sessions, `DailyStat`, missions et badges convergent ;
- version du dashboard augmente après tout événement pertinent et jamais à cause d’un simple rendu ;
- compteur non lu égal au nombre de notifications actives non lues ;
- graphe social symétrique et sans paire dupliquée ;
- résultat versus égal aux matchs canoniques.

### Performance

- budget de requêtes DB et taille de réponse par endpoint ;
- test avec historique réaliste et non une base vide ;
- cache stampede, cache froid, cache chaud et perte du cache partagé ;
- temps d’ACK d’une réponse de jeu indépendant du recalcul complet du dashboard ;
- diffusion temps réel asynchrone après commit, sans allonger inutilement la mutation.

## 9. Observabilité et alertes

Mesures minimales :

- taux de commandes dédupliquées et conflits d’idempotence ;
- latence p50/p95/p99 par lecture, mutation et requête DB ;
- divergences XP et read models ;
- âge et taille du backlog outbox ;
- événements publiés plusieurs fois et dédupliqués ;
- runs actifs après leur deadline ;
- taux de cache hit, âge des snapshots servis et recalculs coalescés ;
- conflits de version profil/social/match ;
- sockets, joueurs présents, expirations TTL et convergence après déconnexion ;
- erreurs de webhook Clerk et délai de traitement.

Une alerte ne doit jamais corriger silencieusement une progression. Toute réparation de solde produit un mouvement auditable distinct.

## 10. Rollback global

- utiliser des flags par version de protocole et par domaine, pas un interrupteur unique ;
- garder les écritures V2 lisibles même si la création de nouvelles entités V2 est désactivée ;
- terminer un run ou match avec la version qui l’a créé ;
- préférer revenir à une lecture DB plus lente plutôt qu’à un cache non fiable ;
- ne jamais supprimer les reçus, mouvements XP ou événements déjà commités ;
- si l’outbox est en panne, conserver les mutations commitables uniquement quand leur événement peut être écrit dans la même transaction, puis drainer plus tard ;
- revenir à une instance avant de désactiver l’infrastructure distribuée ;
- appliquer les suppressions de colonnes et contrats V1 dans des déploiements séparés, après observation.

## 11. Définition de « site server-authoritative »

Mayele pourra être décrit ainsi lorsque :

- aucune session créditée ne peut être créée sans run serveur ;
- aucune bonne réponse attendue, durée faisant foi, série ou score ne vient du navigateur ;
- chaque crédit XP et chaque récompense possède une source unique et auditable ;
- les retries et redémarrages ne doublent aucune mutation ;
- social, notification et événement sont atomiques ;
- tous les agrégats portent une version et sont reconstructibles depuis les faits canoniques ;
- les caches ne peuvent ni autoriser une action ni faire régresser un état ;
- la présence est dérivée de connexions authentifiées avec expiration, même sur plusieurs instances ;
- Sprint et Tempo reprennent après redémarrage et finalisent côté serveur ;
- un crash entre commit et diffusion est réparé automatiquement par l’outbox ;
- les tests de concurrence, de rejeu et de multi-instance passent sur tous les domaines concernés.

Avant ces critères, la formulation exacte est : **« données métier majoritairement persistées côté serveur, avec progression solo et orchestration temps réel encore partiellement confiées au client ou à la mémoire d’une instance »**.
