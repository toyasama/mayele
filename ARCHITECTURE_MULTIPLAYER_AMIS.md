# Architecture future - Amis et multijoueur

Date: 2026-07-07
Contexte: Mayele Maths est aujourd'hui une application solo avec authentification Clerk, API Express, Prisma/PostgreSQL et des sessions de jeu persistantes. L'objectif est d'ajouter progressivement un graphe d'amis, puis des experiences multijoueur.

## Decision structurante

Ne pas transformer `GameSession` en table multijoueur.

`GameSession` doit rester la trace individuelle d'une performance joueur: score, XP, reponses, missions, progression. Le multijoueur doit etre modelise par une entite de niveau superieur, par exemple `Match`, qui regroupe plusieurs participations individuelles. Chaque participant peut ensuite produire une `GameSession` liee au match.

Cette separation evite de casser le dashboard solo, les recompenses et les stats existantes.

## Cible fonctionnelle

### Phase 1 - Graphe social

- Rechercher un joueur par `username`.
- Envoyer une demande d'ami.
- Accepter ou refuser une demande.
- Supprimer un ami.
- Voir la liste d'amis et leur statut simple: ami, demande recue, demande envoyee.

### Phase 2 - Defi live entre amis

- Le joueur createur ouvre une session en ligne.
- Le createur invite un ami.
- Le createur choisit l'operation, le niveau et le type de defi.
- L'adversaire recoit l'invitation et doit accepter ou refuser.
- Si l'adversaire accepte, une session live se lance pour les deux joueurs.
- Le backend gere l'etat du match, les questions, les validations de reponse et le resultat final.

Le premier mode multijoueur de Mayele doit donc etre un `challenge` live prive entre deux amis. Les defis asynchrones peuvent rester une option future, mais ils ne sont pas le premier jalon produit.

### Variantes de defi

Deux variantes sont prevues.

#### Speed

- Les deux joueurs ont la meme liste de questions.
- Les questions sont dans le meme ordre pour les deux joueurs.
- Chaque joueur avance a son propre rythme.
- Un joueur peut prendre de l'avance sur l'autre.
- Le vainqueur est determine par le score, puis par le temps total en cas d'egalite.

Ce mode favorise la vitesse globale et la capacite a enchainer.

#### Tempo

Nom recommande pour le mode 2: `Tempo`.

Raison: le nom exprime une partie rythmee, question par question, avec un tempo commun. Il est court, comprehensible en francais, et plus distinctif que "mode classique" ou "tour par tour".

- Le createur configure un nombre de questions entre 15 et 50.
- Les deux joueurs voient la meme question au meme moment.
- Chaque question a une limite de 10 secondes.
- Si les deux joueurs repondent avant les 10 secondes, le match passe a la question suivante.
- Si un joueur ne repond pas dans les 10 secondes, sa reponse est consideree comme manquante ou incorrecte selon la regle choisie.
- Si personne ne valide dans les 10 secondes, la partie passe automatiquement a la question suivante.
- Le vainqueur est determine par le nombre de bonnes reponses, puis par le temps de reponse cumule en cas d'egalite.

Ce mode favorise la precision sous contrainte et donne une sensation de duel synchronise.

### Phase 3 - Salons et invitations avancees

- Creer un salon prive.
- Inviter un ami.
- Etat du salon: attente, pret, en cours, termine, annule.
- Les joueurs recoivent les memes questions ou la meme seed de generation.
- Le backend valide les resultats finaux.

### Phase 4 - Temps reel competitif et matchmaking

- Presence live.
- Scoreboard pendant la partie.
- Reconnexion courte.
- Anti-triche plus stricte.
- Eventuellement matchmaking public.

## Modele de donnees propose

### Amitie

Deux tables sont recommandees: une table pour les demandes, une table canonique pour les relations acceptees.

```prisma
model FriendRequest {
  id          String   @id @default(cuid())
  senderId    String   @map("sender_id")
  receiverId  String   @map("receiver_id")
  status      String   @default("pending")
  createdAt   DateTime @default(now()) @map("created_at")
  respondedAt DateTime? @map("responded_at")

  sender      Player   @relation("SentFriendRequests", fields: [senderId], references: [id], onDelete: Cascade)
  receiver    Player   @relation("ReceivedFriendRequests", fields: [receiverId], references: [id], onDelete: Cascade)

  @@unique([senderId, receiverId])
  @@index([receiverId, status])
  @@index([senderId, status])
  @@map("friend_requests")
}

model Friendship {
  id        String   @id @default(cuid())
  playerAId String  @map("player_a_id")
  playerBId String  @map("player_b_id")
  createdAt DateTime @default(now()) @map("created_at")

  playerA   Player  @relation("FriendshipA", fields: [playerAId], references: [id], onDelete: Cascade)
  playerB   Player  @relation("FriendshipB", fields: [playerBId], references: [id], onDelete: Cascade)

  @@unique([playerAId, playerBId])
  @@index([playerBId])
  @@map("friendships")
}
```

Important: `playerAId` et `playerBId` doivent toujours etre stockes dans un ordre canonique, par exemple ordre lexicographique des ids. Cela permet de garantir qu'une amitie entre A et B ne peut pas exister deux fois dans les deux sens.

### Match multijoueur

```prisma
model Match {
  id              String   @id @default(cuid())
  type            String
  challengeMode   String   @default("speed") @map("challenge_mode")
  status          String   @default("pending")
  game            String
  level           String
  practiceSkill   String?  @map("practice_skill")
  durationSeconds Int      @default(60) @map("duration_seconds")
  questionCount   Int?     @map("question_count")
  perQuestionTimeLimitSeconds Int? @map("per_question_time_limit_seconds")
  questionSeed    String?  @map("question_seed")
  createdById     String   @map("created_by_id")
  winnerPlayerId  String?  @map("winner_player_id")
  createdAt       DateTime @default(now()) @map("created_at")
  startedAt       DateTime? @map("started_at")
  finishedAt      DateTime? @map("finished_at")

  createdBy       Player   @relation("CreatedMatches", fields: [createdById], references: [id], onDelete: Cascade)
  participants    MatchParticipant[]

  @@index([createdById, createdAt(sort: Desc)])
  @@index([status, createdAt(sort: Desc)])
  @@map("matches")
}

model MatchParticipant {
  id          String   @id @default(cuid())
  matchId     String   @map("match_id")
  playerId    String   @map("player_id")
  status      String   @default("invited")
  score       Int?
  xp          Int?
  sessionId   String?  @unique @map("session_id")
  joinedAt    DateTime? @map("joined_at")
  finishedAt  DateTime? @map("finished_at")

  match       Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  player      Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  session     GameSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@unique([matchId, playerId])
  @@index([playerId, status])
  @@map("match_participants")
}
```

Champs importants:

- `type`: `challenge` pour le premier mode multijoueur.
- `challengeMode`: `speed` ou `tempo`.
- `durationSeconds`: utile pour `speed`.
- `questionCount`: utile pour `tempo`, borne serveur entre 15 et 50.
- `perQuestionTimeLimitSeconds`: utile pour `tempo`, valeur initiale recommandee: 10.
- `questionSeed`: seed serveur permettant de generer la meme liste de questions pour les deux joueurs.

Option complementaire:

```prisma
model GameSession {
  // champs existants
  matchParticipantId String? @unique @map("match_participant_id")
}
```

Il faut choisir une seule direction de relation pour eviter une modelisation ambigue:

- soit `MatchParticipant.sessionId` pointe vers `GameSession.id`;
- soit `GameSession.matchParticipantId` pointe vers `MatchParticipant.id`.

La premiere option est plus simple pour garder `GameSession` intacte au debut.

## API cible

### Amis

- `GET /api/players/search?username=...`
- `GET /api/friends`
- `GET /api/friends/requests`
- `POST /api/friends/requests`
- `POST /api/friends/requests/:requestId/accept`
- `POST /api/friends/requests/:requestId/decline`
- `DELETE /api/friends/:friendId`

Regles serveur:

- Interdire l'auto-invitation.
- Interdire une demande si une relation existe deja.
- Interdire deux demandes pendantes opposees; si B a deja invite A, A doit accepter la demande existante.
- Ne jamais exposer l'email des autres joueurs.
- Utiliser `username`, `name`, `avatarUrl`, `totalXp` et progression publique minimale.

### Defi live

- `POST /api/matches/challenges`
- `GET /api/matches`
- `GET /api/matches/:matchId`
- `POST /api/matches/:matchId/accept`
- `POST /api/matches/:matchId/decline`
- `POST /api/matches/:matchId/ready`
- `POST /api/matches/:matchId/start`
- `POST /api/matches/:matchId/answers`
- `POST /api/matches/:matchId/finish`

Payload recommande pour `POST /api/matches/challenges`:

```json
{
  "opponentPlayerId": "player_id",
  "game": "multiplication",
  "level": "medium",
  "challengeMode": "tempo",
  "questionCount": 30
}
```

Regles serveur de creation:

- le createur et l'adversaire doivent etre amis;
- le createur ne peut pas s'inviter lui-meme;
- `challengeMode` doit etre `speed` ou `tempo`;
- en `speed`, la configuration repose sur la duree de session;
- en `tempo`, `questionCount` doit etre entre 15 et 50 et `perQuestionTimeLimitSeconds` vaut 10;
- le serveur genere `questionSeed` ou une liste de questions signee;
- l'adversaire doit accepter avant le demarrage.

`POST /api/matches/:matchId/answers` doit verifier:

- le joueur est participant du match;
- le match est dans un statut compatible;
- la question appartient bien a la liste du match;
- la reponse arrive dans la fenetre de temps autorisee;
- un participant ne peut pas repondre deux fois a la meme question;
- le match est finalise quand les conditions du mode sont atteintes.

En fin de match, le serveur peut creer une `GameSession` par participant pour reutiliser la progression, l'XP, les stats et les recompenses existantes.

## Temps reel: choix technique

### Court terme

Pour le defi live, REST suffit pour creer, accepter ou refuser l'invitation, mais il faut un canal temps reel pour:

- notifier l'adversaire qu'il est invite;
- synchroniser le demarrage;
- envoyer les changements d'etat du match;
- afficher l'avancement de l'autre joueur en `speed`;
- synchroniser la question courante en `tempo`;
- pousser le resultat final.

### Moyen terme

Ajouter un canal temps reel separe de l'API REST.

Options:

- Socket.IO sur le serveur Express si l'hebergement accepte les connexions longues.
- Service externe temps reel, par exemple Ably, Pusher ou Supabase Realtime, si le deploiement serverless ou multi-instance complique les WebSockets.
- SSE uniquement pour de la presence/scoreboard descendant, mais insuffisant si le client doit envoyer beaucoup d'evenements.

Point d'attention: Railway peut convenir a Socket.IO, mais il faudra prevoir sticky sessions ou un adaptateur Redis si le serveur scale horizontalement.

Evenements live recommandes:

- `match:invited`
- `match:accepted`
- `match:declined`
- `match:ready`
- `match:started`
- `match:question`
- `match:answer_submitted`
- `match:progress`
- `match:completed`
- `match:cancelled`

## Anti-triche et validation

Le serveur valide deja les sessions en recalculant les bonnes reponses. Pour le multijoueur, il faudra aller plus loin:

- generer ou signer la liste des questions cote serveur pour les matchs;
- stocker `questionSeed` ou `questionSetId`;
- refuser les reponses dont le prompt ne correspond pas au match;
- borner les temps de reponse par question;
- enregistrer `startedAt` et `finishedAt` cote serveur;
- appliquer un rate limit plus strict sur les routes de match.

Pour le premier defi live, une seed partagee peut suffire si le generateur de questions est deterministe, versionne et valide cote serveur.

## Decoupage serveur recommande

```text
server/src/routes/friendRoutes.ts
server/src/routes/matchRoutes.ts
server/src/services/friendService.ts
server/src/services/matchService.ts
server/src/schemas/friendSchema.ts
server/src/schemas/matchSchema.ts
server/src/domain/matchRules.ts
```

`friendService` doit gerer les invariants relationnels.
`matchService` doit gerer les transitions d'etat et la finalisation.
`matchRules` doit rester pur: calcul vainqueur, tie-break, transitions autorisees.

## Etats recommandes

### FriendRequest.status

- `pending`
- `accepted`
- `declined`
- `cancelled`

### Match.status

- `pending`: invitation creee, pas encore acceptee.
- `accepted`: tous les participants requis ont accepte.
- `ready`: les participants sont connectes et prets a demarrer.
- `in_progress`: partie live demarree.
- `completed`: resultats finalises.
- `cancelled`: annule par createur ou timeout.
- `expired`: aucun participant n'a repondu dans le delai.

### MatchParticipant.status

- `invited`
- `accepted`
- `declined`
- `ready`
- `playing`
- `completed`
- `disconnected`

Transitions principales:

1. Le createur cree le defi: `Match.status = pending`.
2. L'adversaire accepte: `Match.status = accepted`.
3. Les deux clients rejoignent le canal live: participants `ready`.
4. Le serveur demarre le match: `Match.status = in_progress`.
5. Les conditions de fin sont atteintes: `Match.status = completed`.

En cas de refus, le match passe a `cancelled` ou reste historise avec participant `declined`.

## Plan d'implementation progressif

### Lot 1 - Fondations sociales

1. Ajouter les tables `FriendRequest` et `Friendship`.
2. Ajouter `friendService` avec tests unitaires sur les invariants.
3. Ajouter les routes REST amis.
4. Ajouter une page client "Amis" avec recherche par username, demandes et liste.

### Lot 2 - Defi live

1. Ajouter `Match` et `MatchParticipant`.
2. Ajouter les schemas Zod de creation de defi: `game`, `level`, `challengeMode`, `questionCount`.
3. Ajouter `matchService`.
4. Ajouter les routes creation, acceptation, refus et detail du match.
5. Ajouter l'ecran client de creation de defi depuis la liste d'amis.
6. Ajouter l'ecran d'invitation cote adversaire.

### Lot 3 - Moteur de defi

1. Extraire le generateur de questions dans un module partage ou dans le serveur.
2. Ajouter une seed deterministe par match.
3. Implementer `speed`: meme liste, meme ordre, progression libre.
4. Implementer `tempo`: 15 a 50 questions, 10 secondes par question, progression synchronisee.
5. Verifier cote serveur que les reponses correspondent a la seed.

### Lot 4 - Live

1. Choisir l'infrastructure temps reel.
2. Ajouter presence et canal par match.
3. Ajouter demarrage synchronise.
4. Ajouter scoreboard live.
5. Ajouter reconnexion courte.
6. Ajouter tests E2E Playwright du flux invitation -> acceptation -> partie -> resultat.

## Priorites techniques avant de commencer

- Creer un dossier `shared/` ou package interne pour les types `GameType`, `GameLevel`, `SkillTag`.
- Decouper progressivement les types API client trop volumineux.
- Garder les nouveaux services testes sans vraie base, comme les services existants.
- Prevoir des index sur toutes les listes utilisateur: amis, demandes, matchs.
- Ne pas exposer d'informations privees Clerk dans les endpoints sociaux.

## Proposition de premier jalon

Le premier jalon utile est:

1. Recherche par username.
2. Demande d'ami.
3. Acceptation/refus.
4. Liste d'amis.

Le premier jalon multijoueur apres les amis doit etre:

1. Creation d'un defi live par un joueur.
2. Invitation d'un ami.
3. Acceptation ou refus.
4. Choix d'une solution temps reel minimale.
5. Lancement d'une partie `speed`.
6. Ajout de `tempo` quand le moteur live est stable.

## Etat implemente - 2026-07-08

- Le salon multijoueur utilise Socket.IO pour pousser les changements de match, presence, notifications et social; le polling REST n'est plus le mecanisme principal.
- La synchro de page multijoueur utilise `GET /api/matches/room-overview`, qui regroupe amis et matchs en une seule requete au lieu de deux.
- Le cycle serveur couvre maintenant: invitation, acceptation/refus, configuration par le maitre, proposition de defi, acceptation par l'invite, lancement, soumission de resultat, finalisation et gagnant.
- `MatchParticipant` stocke le resultat individuel: score, XP, bonnes reponses, total de questions, temps de reponse cumule, meilleure serie et session liee.
- Le client affiche les questions depuis `questionSeed`, mais le serveur regenere et valide les questions au submit avant de creer la `GameSession`.
- La regle de victoire est: bonnes reponses, puis temps de reponse cumule, puis heure de fin. Egalite possible si tout est identique.
- Le mode `tempo` impose maintenant 10 secondes par question cote client et le serveur rejette les reponses qui depassent cette fenetre avec marge reseau.
- Le client charge les pages de jeu, dashboard, amis et auth en chunks separes; Socket.IO est importe dynamiquement uniquement quand le temps reel est utilise.
- En production, le client derive l'origine Socket.IO depuis `VITE_API_URL`; `VITE_REALTIME_URL` reste uniquement un override explicite si le realtime est deplace hors de l'API Express.
- `/api/ready` verifie Postgres et l'initialisation Socket.IO, afin d'eviter une production consideree saine alors que le multijoueur temps reel est indisponible.

Limites restantes:

- Le mode `tempo` reste tempo par timer client + validation serveur; le passage question par question parfaitement orchestre par evenement serveur peut etre pousse dans un lot suivant.
- Le generateur deterministe est duplique client/serveur; a terme il faut l'extraire dans un package `shared`.
- Le chunk Clerk/auth reste volumineux; le prochain gain frontend serait de reduire ou isoler davantage l'auth publique.

## Architecture de synchronisation challengee - 2026-07-08

### Correction appliquee au salon

Le salon utilise maintenant une strategie optimistic UI:

- le clic met immediatement a jour l'etat local;
- les modifications de configuration sont debounced avant envoi serveur;
- seule la derniere sequence de synchronisation peut modifier l'etat React;
- les refresh Socket.IO/REST n'ecrasent plus un brouillon local en attente de confirmation.
- chaque changement de salon porte une `configVersion` serveur;
- le client envoie `expectedConfigVersion`, et le serveur refuse une modification obsolete avec `match_version_conflict`.

Cette correction evite les retours visuels en arriere quand le maitre du salon clique rapidement sur plusieurs options.

### Option actuelle: serveur autoritaire + Socket.IO

Principe:

- le serveur reste source de verite pour le salon, la configuration, le demarrage, les resultats et le gagnant;
- Socket.IO pousse les changements d'etat;
- le client fait de l'optimistic UI pour la sensation immediate.

Avantages:

- securite et anti-triche plus simples;
- historique et resultats fiables;
- reconnexion et arbitrage plus faciles;
- compatible avec invitations, notifications, missions, XP et dashboard.

Inconvenients:

- latence visible si le client attend la reponse serveur;
- besoin de gerer les conflits de reponses reseau;
- necessite un serveur long-lived ou un service temps reel.

Decision actuelle: c'est le meilleur choix pour Mayele aujourd'hui.

### Alternative: pair-a-pair direct WebRTC

Principe:

- les deux navigateurs echangent les evenements de jeu directement;
- le serveur sert surtout au signaling, a l'invitation et a la validation finale.

Avantages:

- latence potentiellement plus basse;
- moins d'evenements temps reel a faire transiter par le serveur;
- interessant pour des jeux tres reactifs.

Inconvenients:

- NAT/firewall: il faut STUN/TURN;
- TURN peut couter cher et devient lui-meme un relais;
- anti-triche plus difficile: chaque client peut mentir;
- reconnexion et arbitrage plus complexes;
- le serveur doit quand meme valider les resultats.

Decision: pas recommande pour le premier vrai mode competitif de Mayele. Le gain ne justifie pas la complexite tant que les interactions sont des choix de salon et des reponses de calcul, pas de l'action temps reel a 60 FPS.

### Alternative: hybride serveur autoritaire + prediction client

Principe:

- le serveur reste autoritaire;
- le client predit l'etat visible immediat;
- le serveur confirme ou corrige.

Avantages:

- sensation fluide;
- securite conservee;
- complexite raisonnable.

Inconvenients:

- il faut versionner les changements;
- il faut eviter les rollbacks visuels;
- le code client doit distinguer brouillon local, etat confirme et etat distant.

Decision: c'est l'approche appliquee au salon et celle a continuer pour le jeu.

### Alternative: service temps reel externe

Exemples: Ably, Pusher, Supabase Realtime.

Avantages:

- scaling WebSocket simplifie;
- moins d'infra maison;
- presence et channels souvent fournis.

Inconvenients:

- cout externe;
- dependance fournisseur;
- il faut toujours garder le serveur Mayele comme arbitre final.

Decision: utile si l'hebergement Express/Socket.IO devient un frein en production multi-instance.
