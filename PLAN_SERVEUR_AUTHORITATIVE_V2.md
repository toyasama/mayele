# Plan serveur authoritative V2

Dernière mise à jour : 18 juillet 2026.

Ce document décrit une migration par lots déployables. Il distingue ce qui est présent dans le code actuel de ce qui reste à construire. Une phase décrite ci-dessous n'est pas considérée comme livrée tant que ses migrations, son chemin runtime, ses tests et ses critères de déploiement ne sont pas tous validés.

## 1. Statut synthétique

### Fait dans le code actuel

- Les sockets sont authentifiées.
- `room:join` vérifie désormais en base que le joueur appartient au salon avant de joindre le channel.
- Les transitions principales du salon attendent leur écriture en base avant le snapshot, l'événement et l'ACK : création, configuration, invitation, proposition, démarrage, refus, abandon, relance et départ.
- La progression envoyée par l'ancien client via `match:update-progress` est acceptée pour compatibilité mais ne modifie plus l'état canonique.
- L'abandon ne persiste plus une progression déclarée par le client.
- Une réponse Tempo est persistée avant sa diffusion. En cas d'échec, elle est retirée du runtime mémoire.
- La fin Tempo est persistée avant la publication de `match_completed`.
- Les résultats sont recalculés côté serveur à partir de la configuration du match et des réponses reçues.
- Les versions de configuration protègent déjà une partie des écritures concurrentes.

### Prochain

1. Faire émettre et corriger les questions Sprint par le serveur, sans seed ni bonne réponse dans le contrat public.
2. Persister les phases et deadlines Tempo, puis réhydrater une partie après redémarrage.
3. Rendre l'idempotence et le journal d'événements durables avec une outbox transactionnelle.

### Ultérieur

4. Autoriser plusieurs instances realtime avec diffusion partagée, leases et présence distribuée.

## 2. Limites restantes du système actuel

Le système n'est pas encore entièrement server-authoritative pour les raisons suivantes :

- `questionSeed` reste inclus dans `SerializedMatch` et permet au client de calculer toutes les questions et leurs réponses.
- En Sprint, le client génère les questions, mesure les temps, puis envoie un résultat complet avec `match:submit-result`.
- Le serveur valide les questions Sprint, mais les temps de réponse et la cadence restent fournis par le client.
- `match:update-progress` et `match:submit-result` existent toujours dans le protocole public.
- Le runtime Tempo (`tempoMatchRuntimes`), les deadlines, les événements de room et les reçus de commandes sont en mémoire.
- Après un redémarrage, une partie Tempo persistée `in_progress` n'est pas reconstruite automatiquement.
- `clientCommandId` est dédupliqué grâce aux événements mémoire ; cette garantie disparaît au redémarrage.
- Les révisions de room et le replay des événements ne sont pas durables.
- Socket.IO, la présence et les caches de match sont locaux à une instance.

Les interpolations visuelles locales, les animations et l'affichage fluide du chrono ne sont pas des défauts. Ils doivent rester côté client, mais ne doivent plus décider du résultat.

## 3. Invariants de la cible

À la fin de la migration :

1. Le client ne reçoit jamais un secret permettant de prédire une réponse non jouée.
2. Une réponse entrante contient seulement l'identité de la question et la réponse du joueur.
3. Les dates de début, deadlines, temps de réponse, scores, séries, XP et gagnants sont calculés côté serveur.
4. Un ACK succès désigne toujours un état déjà commité.
5. Une même commande rejouée retourne le même résultat sans rejouer ses effets.
6. Un événement commité finit par être diffusé, même après un crash entre le commit et l'émission Socket.IO.
7. Un redémarrage ou un changement d'instance ne modifie pas le résultat d'une partie.
8. Les caches mémoire sont des projections jetables, jamais une source de vérité.

## 4. Versionnement du protocole

Ajouter une capacité explicite, commune à tous les lots :

```ts
type GameplayProtocol = 'legacy_seed_v1' | 'server_questions_v2'
```

Le match persiste son protocole au démarrage. Les deux participants d'un même match utilisent toujours le même protocole.

La réponse `realtime:ready` évolue de façon additive :

```ts
// Avant
{ playerId, at }

// Après, compatible avec les clients existants
{
  playerId,
  at,
  supportedGameplayProtocols: ['legacy_seed_v1', 'server_questions_v2'],
  realtimeProtocolVersion: 2
}
```

Le nouveau client doit comprendre V1 et V2 avant l'ouverture de la première partie V2. Le lot 1 active V2 uniquement pour Sprint ; Tempo reste V1 jusqu'au lot 2. Les matchs V1 déjà actifs terminent en V1 et ne sont jamais convertis en cours de partie.

## 5. Lot 1 — Questions Sprint émises par le serveur

Statut : **prochain, non livré**.

### Objectif

Supprimer la génération et la mesure authoritative côté client pour les nouveaux matchs Sprint, tout en gardant une interaction immédiate.

### Modèle de données

Migration additive proposée :

- `Match.gameplayProtocol String @default("legacy_seed_v1")` ;
- `Match.stateVersion Int @default(0)` ;
- `MatchParticipant.currentQuestionIndex Int @default(0)` ;
- `MatchQuestionAnswer.questionId String?` ;
- `MatchQuestionAnswer.issuedAt DateTime?` ;
- `MatchQuestionAnswer.receivedAt DateTime?` ;
- `MatchQuestionAnswer.source String @default("manual")` ;
- index unique sur `(matchId, playerId, questionId)` lorsque `questionId` est renseigné.

`questionSeed` peut rester en base pour la reproductibilité, mais il n'est plus sérialisé pour un match V2.

Backfill :

- tous les matchs existants reçoivent `legacy_seed_v1` ;
- aucune question active V1 n'est transformée ;
- les colonnes V2 restent nulles pour l'historique.

### Contrats avant

```ts
// Snapshot public
{
  questionSeed,
  startedAt,
  endsAt,
  participants: [{ scorePoints, correctAnswers, totalQuestions }]
}

// Progression déclarative ; déjà neutralisée côté serveur
match:update-progress {
  matchId,
  progress: { score, scorePoints, correctAnswers, totalQuestions, totalResponseTimeMs, bestStreak }
}

// Résultat Sprint en bloc
match:submit-result {
  matchId,
  result: {
    durationSeconds,
    bestStreak,
    answers: [{ prompt, correctAnswer, userAnswer, responseTimeMs, skill }]
  }
}
```

### Contrats après

Événement privé au participant concerné :

```ts
match:question {
  protocolVersion: 2,
  matchId,
  stateVersion,
  question: {
    id,
    index,
    prompt,
    skill,
    issuedAt,
    deadlineAt: null // le Sprint est borné par endsAt
  }
}
```

Commande minimale :

```ts
match:submit-answer {
  protocolVersion: 2,
  clientCommandId,
  matchId,
  questionId,
  userAnswer
}
```

ACK :

```ts
{
  answer: {
    questionId,
    isCorrect,
    correctAnswer,
    responseTimeMs,
    scoreDelta
  },
  participantProgress,
  nextQuestion,
  stateVersion,
  serverNow
}
```

L'adversaire reçoit uniquement une progression dérivée, jamais la prochaine question privée :

```ts
match:participant-progressed {
  matchId,
  playerId,
  scorePoints,
  correctAnswers,
  totalQuestions,
  bestStreak,
  stateVersion
}
```

À `endsAt`, le serveur ferme les participants encore actifs avec les réponses déjà enregistrées, calcule le gagnant et publie `match_completed`. Le client n'envoie plus de résultat final V2.

### Exécution serveur

Pour chaque réponse :

1. authentifier le participant et charger le match ;
2. vérifier `in_progress`, le protocole V2, `questionId`, l'index attendu et `receivedAt <= endsAt + grace` ;
3. générer la réponse attendue côté serveur ;
4. calculer `responseTimeMs = receivedAt - issuedAt` ;
5. insérer la réponse et mettre à jour la progression dans une transaction ;
6. incrémenter `stateVersion` ;
7. produire la question suivante ;
8. commiter, puis ACKer et diffuser.

### Compatibilité et déploiement

1. Déployer d'abord le nouveau client capable de jouer V1 et V2.
2. Déployer les migrations et le serveur avec `SERVER_QUESTIONS_V2_ENABLED=false`.
3. Activer V2 seulement pour les nouveaux matchs internes ou un faible pourcentage de rooms.
4. Monter progressivement le pourcentage.
5. Quand les clients V1 ne sont plus supportés, refuser la création de nouveaux matchs V1.
6. Conserver la lecture de l'historique V1 ; retirer l'ancien chemin d'écriture dans un déploiement ultérieur.

Un client V1 ne doit pas entrer dans un match V2. Il reçoit une erreur explicite `client_upgrade_required`, pas un match incomplet sans seed.

### Tests obligatoires

- Le snapshot V2 ne contient ni seed ni bonne réponse future.
- La même question n'est enregistrée qu'une fois par participant.
- Une réponse à une ancienne ou future question est rejetée.
- Le temps retenu vient des timestamps serveur, pas du payload.
- Un client ne peut pas soumettre 120 réponses instantanées en bloc.
- Le serveur finalise sans `match:submit-result`, y compris si un navigateur se ferme.
- Les deux joueurs obtiennent la même séquence, avec une cadence indépendante en Sprint.
- Le score live et le score final sont identiques.
- E2E V1/V1, V2/V2 et refus V1/V2.

### Critères de sortie

- Aucun écart entre les réponses persistées et le score final sur le canary.
- Aucun `questionSeed` dans les payloads V2 observés.
- Taux d'échec de délivrance de la première question inférieur à 0,5 % hors déconnexions client.
- P95 de l'ACK réponse dans le budget realtime défini par les tests de production.

### Rollback

- Désactiver `SERVER_QUESTIONS_V2_ENABLED` pour les nouveaux matchs.
- Laisser les matchs V2 déjà démarrés finir sur le chemin V2 ; ne jamais les rétrograder vers V1.
- Si le chemin V2 est indisponible, empêcher de nouveaux démarrages V2 et afficher une resynchronisation, plutôt que de révéler le seed.
- Garder les colonnes additives ; aucune migration destructive pendant la période de rollback.

Déclencheurs de rollback : perte de première question supérieure à 0,5 % pendant 5 minutes, hausse des erreurs de commande de plus de 2 points par rapport à la référence, ou divergence score live/final confirmée.

## 6. Lot 2 — Timers Tempo persistants et reprise

Statut : **prochain après le lot 1, non livré**.

### Objectif

Faire de la phase Tempo et de sa deadline un état persistant reconstructible, au lieu d'un `setTimeout` attaché à une instance.

### Modèle de données

Ajouter à `Match` :

- `currentQuestionIndex Int?` ;
- `questionStartedAt DateTime?` ;
- `questionDeadlineAt DateTime?` ;
- `timerRevision Int @default(0)` ;
- `timerResolvedAt DateTime?`.

Alternative si l'historique de chaque phase doit être auditable : table `MatchQuestionPhase(matchId, questionIndex, startedAt, deadlineAt, resolvedAt, resolution, revision)` avec unicité `(matchId, questionIndex)`. Cette option est recommandée si l'outbox du lot 3 est mise en œuvre immédiatement après.

Backfill :

- les matchs Tempo V1 actifs restent sur le runtime V1 jusqu'à leur fin ou expiration ;
- les nouveaux matchs `server_questions_v2` initialisent la phase dans la transaction de démarrage ;
- les matchs terminés ne nécessitent pas de backfill de phase.

### Contrats avant

Le snapshot expose `tempoQuestionIndex` et `tempoQuestionStartedAt`, tous deux issus du runtime mémoire. Le client envoie encore `prompt`, `correctAnswer`, `responseTimeMs`, `skill` et `source`.

### Contrats après

Le même événement générique `match:question` est utilisé :

```ts
match:question {
  protocolVersion: 2,
  matchId,
  stateVersion,
  question: {
    id,
    index,
    prompt,
    skill,
    issuedAt,
    deadlineAt
  }
}
```

La commande est identique au Sprint :

```ts
match:submit-answer {
  clientCommandId,
  matchId,
  questionId,
  userAnswer
}
```

`source: timeout` n'est plus accepté depuis le client. Le serveur insère lui-même une réponse nulle lorsque la deadline est résolue.

Le snapshot Tempo V2 ne sérialise plus `questionSeed` et contient une projection de reprise :

```ts
{
  currentQuestion: { id, index, prompt, skill, issuedAt, deadlineAt },
  serverNow,
  stateVersion
}
```

### Reprise après crash

Au démarrage et à la première commande sur cache miss :

1. charger les matchs Tempo V2 `in_progress` ;
2. charger les réponses de la phase courante ;
3. si la deadline est future, programmer un wake-up local jetable ;
4. si elle est passée, résoudre la phase par transaction compare-and-swap sur `timerRevision` ;
5. créer les réponses timeout manquantes ;
6. avancer la phase en utilisant la deadline précédente comme base lorsqu'une indisponibilité a dépassé plusieurs questions ;
7. répéter jusqu'à la phase courante réelle ou la fin du match ;
8. republier un snapshot canonique.

Le wake-up mémoire n'est qu'une optimisation. Une tâche périodique doit également rechercher les deadlines échues afin qu'un timeout perdu soit rattrapé.

### Tests obligatoires

- Redémarrage avant une deadline : même index et même deadline après reprise.
- Redémarrage après une deadline : timeout inséré une seule fois.
- Indisponibilité couvrant plusieurs questions : rattrapage déterministe jusqu'à la phase correcte.
- Réponse et timeout concurrents : un seul gagne le compare-and-swap.
- Dernière question : résultat final persisté une seule fois.
- Reconnexion du client : le chrono est reconstruit depuis `deadlineAt` et `serverNow`.
- Aucune dépendance de correction à l'horloge du navigateur.

### Compatibilité et déploiement

- Réutiliser `GameplayProtocol` : V1 garde le runtime actuel, V2 utilise les phases persistantes.
- Activer d'abord le mécanisme de réhydratation en lecture/observation, sans résoudre de deadline.
- Comparer les décisions observées aux timeouts mémoire.
- Activer ensuite la résolution persistante sur un canary.
- Une fois stable, retirer les timeouts métier V2 de `tempoMatchRuntimes`; garder seulement les wake-ups.

### Critères de sortie

- 100 % des matchs Tempo V2 actifs sont reconstructibles depuis la base seule.
- Aucun match V2 ne reste `in_progress` au-delà de sa deadline finale plus la grâce prévue.
- Aucune double réponse timeout ni double finalisation dans les tests de concurrence.

### Rollback

- Désactiver la création de nouveaux matchs Tempo V2.
- Continuer le worker de reprise pour les matchs V2 déjà actifs.
- Ne jamais réactiver le runtime V1 sur un match dont une phase V2 est persistée.
- En cas de panne du worker, conserver les données et relancer le rattrapage ; ne pas marquer arbitrairement les matchs terminés.

Déclencheurs : phase résolue deux fois, deadline perdue, écart entre index persistant et index diffusé, ou backlog de deadlines dépassant la fenêtre de grâce.

## 7. Lot 3 — Idempotence durable, journal et outbox

Statut : **ultérieur proche, non livré**.

### Objectif

Garantir qu'un retry, un redémarrage ou un crash après commit ne perde ni ne double une commande ou un événement.

### Modèle de données

Créer `MatchCommandReceipt` :

- `id` ;
- `matchId`, `playerId` ;
- `commandId`, `commandType` ;
- `requestHash` ;
- `responsePayload Json?` ;
- `createdAt`, `completedAt` ;
- unicité `(playerId, commandId)`.

Créer `MatchRoomState` :

- `roomId` primaire ;
- `revision BigInt @default(0)` ;
- `updatedAt`.

Créer `MatchEvent` servant aussi d'outbox :

- `id` stable ;
- `roomId`, `matchId`, `revision` ;
- `type`, `reason`, `payload Json` ;
- `commandReceiptId?` unique ;
- `createdAt`, `publishedAt?`, `publishAttempts`, `nextAttemptAt?` ;
- unicité `(roomId, revision)`.

Backfill :

- créer une ligne `MatchRoomState` pour chaque `roomId` distinct ;
- ne pas convertir les événements mémoire historiques ;
- commencer le journal durable à une révision de base documentée, avec un événement `room_snapshot_baseline` ;
- conserver les anciens `eventId` uniquement pour les clients V1 en cours.

### Contrats avant

```ts
room:join { roomId, lastSeenEventId }

room:event {
  roomId,
  matchId,
  eventId,
  revision, // mémoire
  type,
  reason,
  serverTime,
  match
}
```

### Contrats après

```ts
room:join {
  roomId,
  lastSeenRevision,
  protocolVersion: 2
}

room:event {
  protocolVersion: 2,
  roomId,
  matchId,
  eventId,
  revision, // persistante
  type,
  reason,
  serverTime,
  match
}
```

Pendant la compatibilité, `room:join` accepte `lastSeenEventId` ou `lastSeenRevision`. Le serveur préfère la révision. Si la rétention ne permet plus le replay, il renvoie `room:snapshot` avec la révision canonique.

Une réutilisation du même `clientCommandId` avec le même hash retourne `responsePayload`. Avec un payload différent, elle retourne `409 idempotency_conflict`.

### Transaction de commande

1. réserver ou relire le reçu de commande ;
2. verrouiller/CAS l'état concerné ;
3. appliquer la transition ;
4. incrémenter la révision de room ;
5. écrire l'événement/outbox et la réponse canonique ;
6. finaliser le reçu ;
7. commiter ;
8. ACKer depuis le reçu commité ;
9. diffuser l'événement ;
10. marquer `publishedAt`.

Un worker reprend les événements non publiés. La livraison est au moins une fois ; le client déduplique par `(roomId, revision)`.

### Tests obligatoires

- Même commande avant/après redémarrage : une seule mutation, même ACK.
- Même identifiant avec payload différent : conflit.
- Crash simulé après commit avant émission : événement diffusé par l'outbox.
- Deux commandes concurrentes : révisions uniques et ordonnées.
- Replay depuis une révision ancienne, révision inconnue et rétention expirée.
- Relance simultanée : un seul nouveau match.
- Échec de diffusion Socket.IO sans rollback de la mutation DB.

### Compatibilité et déploiement

- Écrire d'abord événements mémoire et durables en parallèle, mais diffuser depuis l'ancien chemin.
- Comparer révision, type et snapshot en observation.
- Basculer le replay vers la base.
- Basculer ensuite la diffusion vers l'outbox.
- Garder un seul producteur de diffusion par événement grâce au lease du worker.

### Critères de sortie

- Aucun doublon d'effet sur les tests de retry et de concurrence.
- Aucun événement commité non publié au-delà de l'objectif de délai.
- Aucune divergence entre snapshot de l'événement et lecture canonique correspondante.
- Backlog outbox stable et observable.

### Rollback

- Arrêter la création de nouveaux matchs V2 si le journal n'est plus fiable.
- Revenir temporairement à la diffusion directe pour les nouveaux événements tout en continuant à drainer l'outbox.
- Ne pas supprimer les reçus ni réutiliser leurs identifiants.
- Les migrations restent additives jusqu'à la fin de la période de stabilisation.

Déclencheurs : révisions dupliquées, reçu appliqué deux fois, backlog outbox croissant pendant plus de 5 minutes, ou événement durable impossible à désérialiser.

## 8. Lot 4 — Multi-instance

Statut : **ultérieur, non livré**.

### Objectif

Permettre à deux joueurs connectés à des instances différentes de partager le même match sans dépendre d'une mémoire locale.

### Préconditions

- Les lots 2 et 3 sont stables.
- Les transitions utilisent CAS/transactions en base.
- Les deadlines sont persistantes.
- Les événements et reçus sont durables.

### Architecture

- Adaptateur Socket.IO Redis pour les rooms et broadcasts inter-instances.
- Base de données comme vérité du match.
- Redis uniquement pour diffusion, présence éphémère, cache et coordination courte.
- Lease de worker pour chaque deadline/outbox, avec résultat protégé par CAS en base.
- Cache local rechargé depuis la base sur miss ; aucune commande ne doit échouer uniquement parce que le match n'est pas dans `matchSnapshotCache`.
- Présence distribuée par socket avec TTL, agrégée par joueur. La préférence « hors ligne » reste persistante.

Si le transport polling Socket.IO reste activé, le load balancer doit fournir l'affinité requise. Sinon, valider puis imposer WebSocket pour le realtime de production.

### Contrats

Les contrats V2 des lots précédents ne changent pas. Le passage multi-instance doit être transparent pour le client.

Ajouter seulement des champs de diagnostic non métier dans les logs, jamais dans les règles de jeu : `instanceId`, `workerLeaseId`, `eventPublishAttempt`.

### Migrations et infrastructure

- Redis managé avec authentification, TLS et politique d'éviction compatible.
- Variables de connexion séparées des secrets DB.
- Colonnes de lease sur les deadlines et événements, ou table générique de jobs.
- Index sur événements non publiés et deadlines échues.
- Alertes sur Redis, outbox, leases expirés et matchs actifs en retard.

### Tests obligatoires

- Deux serveurs Socket.IO, un joueur sur chaque serveur, invitation et partie complètes.
- Déconnexion d'une instance sans perte du match.
- Réponse et timeout traités simultanément sur deux instances : un seul effet.
- Outbox reprise par une autre instance après expiration du lease.
- Présence correcte avec plusieurs onglets répartis sur plusieurs instances.
- Redis indisponible : commandes DB sûres, reconnexion et replay après retour.
- Test de charge avec répartition réelle des connexions.

### Déploiement

1. Installer Redis avec une seule instance applicative et observer l'adaptateur.
2. Activer les workers avec leases, toujours sur une instance.
3. Ajouter une seconde instance sans trafic utilisateur direct.
4. Envoyer un canary de connexions vers la seconde instance.
5. Monter progressivement la répartition.

### Critères de sortie

- Les scénarios E2E passent lorsque les deux joueurs sont forcés sur deux instances différentes.
- Aucun double timeout, résultat ou rematch pendant les tests de chaos.
- Le replay répare toute émission manquée après perte d'une instance.
- La présence converge après expiration des TTL.

### Rollback

- Ramener immédiatement le nombre de replicas à un sans modifier le schéma.
- Continuer à drainer l'outbox sur l'instance restante.
- Désactiver l'adaptateur Redis uniquement après retour à une instance et vidage des connexions.
- Les leases expirés doivent être récupérables par l'instance restante.

Déclencheurs : événements inter-instances manqués, hausse durable des déconnexions, incohérence de présence, double exécution malgré le CAS, ou indisponibilité Redis non correctement dégradée.

## 9. Ordre de suppression du legacy

Ces suppressions sont postérieures à la stabilisation de tous les lots :

1. arrêter la création de matchs `legacy_seed_v1` ;
2. retirer `questionSeed` des types publics, sans supprimer immédiatement la colonne DB ;
3. retirer le calcul de questions multijoueur côté client ;
4. retirer `match:update-progress` ;
5. retirer `match:submit-result` pour les matchs multijoueur ;
6. retirer les payloads réponse contenant `prompt`, `correctAnswer`, `responseTimeMs`, `skill` et `source` ;
7. retirer les révisions et reçus mémoire ;
8. retirer les timers métier de `tempoMatchRuntimes` ;
9. après la période de rétention, supprimer les chemins V1 et leurs tests de compatibilité.

Chaque suppression doit être un déploiement séparé ou facilement réversible. Les lectures historiques restent compatibles avec les anciennes lignes.

## 10. Matrice de suivi

| Capacité | Fait aujourd'hui | Prochain | Ultérieur |
|---|---:|---:|---:|
| Authentification Socket.IO | Oui |  |  |
| Autorisation `room:join` | Oui |  |  |
| Persistance avant ACK des transitions principales | Oui |  |  |
| Réponse Tempo persistée avant diffusion | Oui |  |  |
| Progression client neutralisée | Oui |  |  |
| Questions Sprint émises par le serveur |  | Lot 1 |  |
| Seed Sprint absent du contrat public |  | Lot 1 |  |
| Seed Tempo absent du contrat public |  | Lot 2 |  |
| Score Sprint fondé sur l'horloge serveur |  | Lot 1 |  |
| Finalisation Sprint sans résultat client |  | Lot 1 |  |
| Phase Tempo persistante et reprise |  | Lot 2 |  |
| Idempotence après redémarrage |  | Lot 3 |  |
| Révisions/replay durables |  | Lot 3 |  |
| Outbox transactionnelle |  | Lot 3 |  |
| Socket.IO multi-instance |  |  | Lot 4 |
| Présence distribuée |  |  | Lot 4 |

## 11. Définition globale de « server-authoritative V2 livré »

La migration ne pourra être déclarée terminée que lorsque :

- tous les nouveaux matchs utilisent `server_questions_v2` ;
- aucun secret de question n'est présent dans le contrat public ;
- Sprint et Tempo enregistrent les réponses au fil de l'eau avec des timestamps serveur ;
- les deux modes terminent sans résultat calculé par le client ;
- un redémarrage au milieu d'une partie est couvert par un E2E automatisé ;
- les retries de commandes sont idempotents après redémarrage ;
- un crash entre commit et broadcast est réparé par l'outbox ;
- deux instances passent le parcours complet et les tests de concurrence ;
- les dashboards, XP et gagnants proviennent uniquement des résultats persistés par le serveur.

Avant satisfaction de ces critères, le produit doit être décrit comme « transitions persistées et Tempo partiellement authoritative », pas comme entièrement server-authoritative.
