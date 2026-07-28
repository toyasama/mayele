# Mayele — bilan d’implémentation, lot 2

Date de validation : 18 juillet 2026  
Landing page : volontairement hors périmètre.

Le seuil de validation est fixé à **8/10**. Une note n’est attribuée qu’après contrôle du contenu, des interactions, du responsive, des erreurs navigateur et de l’absence de débordement horizontal.

## Résultat page par page

| Page ou zone | Évolutions livrées | Validation | Note |
|---|---|---|---:|
| Mon espace — en-tête | identité, progression de niveau, objectif du jour, meilleure série, dernière partie et six badges récents illustrés | desktop, 390, 768 et 1024 px | 9,0/10 |
| Vue d’ensemble | cartes de bilan conservées, seconde jauge de niveau redondante supprimée | responsive + navigation | 8,8/10 |
| Statistiques | résultats par difficulté, volume de sprints, fiabilité du repère, détail par opération, records et tendances | 3 tests ciblés + captures responsive | 9,1/10 |
| Missions | trois objectifs quotidiens issus d’un catalogue de neuf, sélection stable pour la journée et rotation le lendemain | tests jour J/J+1 + reset local | 9,0/10 |
| Trophées | véritables illustrations de badges, progression individuelle, objectifs et états verrouillés ; fausse jauge commune supprimée | filtres, détail et responsive | 9,1/10 |
| Historique | timeline conservée ; rouge `<25`, jaune `25–49`, orange `50–74`, vert `75–100` avec libellés | tests des huit valeurs limites | 8,9/10 |
| Jeu solo | configuration et arène conservées ; nouveau résultat avec score radial, série, temps, XP, point à retravailler et rejouer | parcours Tempo complet de 10 questions | 8,9/10 |
| Lobby multijoueur | rédaction directe autour du défi, étapes inviter/configurer/jouer, invitations séparées | parcours à deux navigateurs + responsive | 8,8/10 |
| Résultat multijoueur | comparaison centrale et actions de revanche, suppression des textes techniques sur le serveur | tests fonctionnels existants | 8,7/10 |
| Amis | roster compact, recherche et actions conservées | responsive + interactions | 8,7/10 |
| Profil ami | comparaison des niveaux et XP, badges illustrés, statistiques par mode et difficulté | desktop + mobile | 8,8/10 |
| Notifications | fil groupé, états non lus et actions conservés | ouverture du panneau + capture | 8,5/10 |
| Paramètres | aperçu du profil, sauvegarde visible seulement après modification, fuseau relié au début de journée | desktop + responsive + modification réelle | 8,7/10 |
| Connexion | titre direct, chargement Clerk sécurisé | client Clerk normal, sans bypass E2E | 8,5/10 |
| Inscription | progression informations/vérification et hiérarchie du formulaire | client Clerk normal, sans bypass E2E | 8,7/10 |

## Changements fonctionnels importants

- Les statistiques ne comparent plus un pourcentage global sans contexte : chaque résultat est rattaché à une difficulté et à un volume joué.
- Les missions quotidiennes sont sélectionnées de manière déterministe avec l’identifiant du joueur et sa date locale. Le cache du dashboard inclut cette date, ce qui provoque le reset à minuit dans le fuseau du joueur.
- La progression d’une mission distingue maintenant les parties, les bonnes réponses et le nombre total de questions.
- La récompense de mission reste idempotente, y compris lors de validations concurrentes.
- Les trophées utilisent l’iconographie déjà définie par famille et rang ; chaque carte possède sa propre progression.
- Les couleurs de l’historique respectent exactement les quatre seuils demandés et restent compréhensibles sans la couleur.
- Le champ de réponse solo utilise désormais une expression `pattern` valide dans les navigateurs Chromium récents.
- Connexion et inscription n’accèdent plus à Clerk avant la disponibilité de son client.

## Architecture front-end

Les nouveaux blocs sont séparés des pages orchestratrices :

- `features/dashboard` : en-tête joueur, statistiques par niveau, parcours de missions, trophées et historique ;
- `features/solo` : résultat de partie ;
- `features/social`, `features/notifications` et `features/multiplayer` : structures spécialisées déjà engagées et complétées ;
- feuilles de styles V2 dédiées aux domaines, avec adaptations responsive et `prefers-reduced-motion`.

Les routes, contrats publics existants et actions utilisateur sont conservés. Les anciens blocs remplacés ont été retirés du rendu au lieu d’être simplement recouverts par du CSS.

## Serveur authoritative

La direction retenue reste **serveur-authoritative**. Les protections déjà livrées sont conservées : appartenance aux salons, transitions persistées avant diffusion, progression client neutralisée, réponses et finalisation Tempo persistées avant publication.

L’autorité complète n’est pas déclarée terminée. L’ordre sûr est :

1. questions Sprint émises et corrigées par le serveur ;
2. phases et délais Tempo persistants avec reprise après redémarrage ;
3. idempotence durable et outbox transactionnelle ;
4. diffusion et présence multi-instance.

Les migrations, contrats V1/V2, tests, critères de sortie et rollbacks sont détaillés dans `PLAN_SERVEUR_AUTHORITATIVE_V2.md`.

## Vérifications finales

- client : **23 fichiers de tests, 93 tests réussis** ;
- serveur : **15 fichiers de tests, 151 tests réussis** ;
- lint client réussi ;
- builds TypeScript client et serveur réussis ;
- Playwright architecture : dashboard, missions, trophées, historique, amis, profil ami, paramètres, notifications, solo, multijoueur ;
- parcours solo complet jusqu’au résultat ;
- matrice responsive du projet : les 10 scénarios non affectés ont réussi, les 2 assertions structurelles devenues obsolètes ont été adaptées puis revalidées sur mobile ;
- connexion et inscription vérifiées séparément avec le client Clerk normal ;
- aucune erreur console ni barre de défilement horizontale sur les captures de référence.

## Captures de référence

- [Mon espace](local_data/architecture-captures/dashboard-overview.png)
- [Statistiques](local_data/architecture-captures/dashboard-stats.png)
- [Missions et trophées](local_data/architecture-captures/dashboard-missions.png)
- [Historique](local_data/architecture-captures/dashboard-history.png)
- [Résultat solo](local_data/architecture-captures/solo-result.png)
- [Profil ami](local_data/architecture-captures/friend-versus-profile.png)
- [Paramètres](local_data/architecture-captures/profile-settings.png)
- [Multijoueur](local_data/architecture-captures/multiplayer-lobby.png)
- [Connexion](local_data/architecture-captures/login.png)
- [Inscription](local_data/architecture-captures/register.png)

## Lot 3 — multijoueur, amis et performance

Validation finale : 18 juillet 2026. Le seuil reste fixé à **8/10** et les notes ci-dessous ont été attribuées après contrôle des interactions, du contenu, du responsive, des erreurs navigateur et des captures réelles.

| Page ou zone | Évolutions validées | Preuves | Note |
|---|---|---|---:|
| Lobby multijoueur | activité des amis, choix direct d'adversaire, invitations séparées, états vide/rempli et animation respectant la réduction de mouvement | desktop, 390, 768 et 1024 px ; un seul `room-overview` observé | 9,1/10 |
| Salle multijoueur | configurateur dédié, progression `0/3 → 3/3`, récapitulatif instantané, règles Sprint/Tempo et libellés français | état `3/3` capturé sur desktop, mobile et tablette ; parcours de clic complet | 9,0/10 |
| Vue Amis | liste compacte, fiche sélectionnée densifiée, progression de niveau, XP restant, dernière activité et actions regroupées | desktop, 390, 768 et 1024 px | 9,0/10 |
| Profil ami | suppression des grilles legacy, résultats par difficulté, opérations condensées, badges illustrés et appel métier unique | capture desktop + responsive ; aucun appel dashboard | 9,2/10 |
| Historique entre amis | bilan gagné/perdu/nul, trois défis récents réels et état vide honnête | contrat serveur, test avec résultat réel fourni au composant et test d'état vide | 9,0/10 |
| Performance de chargement | préchargements globaux supprimés, GET coalescés par session, cache anti-stampede et N+1 multijoueur supprimé | Playwright performance 1/1, 101 tests client et 154 serveur | 8,8/10 |

Corrections issues de la validation visuelle :

- le clic mobile « Nouveau défi » n'est plus interprété comme un objet adversaire ;
- « Easy » et « Room » ont été remplacés par « Débutant » et « Salon » dans toutes les zones visibles du multijoueur ;
- le contraste des opérations et difficultés sélectionnées est explicite ;
- la salle est maintenant capturée séparément du lobby, dans son état complet `3/3` ;
- la vue ami n'affiche aucune rencontre fictive lorsque les deux joueurs ne se sont pas encore affrontés.

Captures ajoutées ou actualisées :

- [Lobby multijoueur V3](local_data/architecture-captures/multiplayer-lobby.png)
- [Salle multijoueur V3](local_data/architecture-captures/multiplayer-room-config.png)
- [Salle multijoueur mobile](local_data/architecture-captures/mobile-multiplayer-room.png)
- [Salle multijoueur tablette](local_data/architecture-captures/tablet-multiplayer-room.png)
- [Vue Amis V3](local_data/architecture-captures/friends-roster.png)
- [Profil ami V3](local_data/architecture-captures/friend-versus-profile.png)

Le détail des causes, mesures et limites performance est conservé dans `AUDIT_PERFORMANCE_V3.md`. La migration authoritative à l'échelle du produit est décrite dans `PLAN_AUTORITE_SERVEUR_SITE_V3.md`.
