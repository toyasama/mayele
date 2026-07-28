# Mayele — alternatives aux blocs d’affichage

Complément à `ANALYSE_DYNAMISME_UI.md` — landing volontairement exclue.

![Alternatives aux blocs actuels](local_data/design-audit/mayele-display-patterns.png)

## Direction générale

Le site utilise aujourd’hui la carte comme réponse presque universelle : KPI, missions, niveaux, badges, profils, notifications, salons et résultats. Cette cohérence facilite la lecture, mais finit par aplatir la hiérarchie : une mission, un ami, un record et un badge semblent appartenir à la même famille d’objets alors qu’ils remplissent des rôles très différents.

La recommandation n’est pas de supprimer toutes les cartes. Il faut les réserver aux objets réellement autonomes ou actionnables, puis utiliser d’autres structures pour le reste :

- **cockpit** pour comparer ;
- **parcours** pour progresser ;
- **vitrine** pour collectionner ;
- **timeline** pour comprendre une évolution ;
- **roster** pour agir sur des personnes ;
- **table/arène** pour préparer une partie ;
- **fil d’activité** pour raconter les événements ;
- **panneau contextuel** pour afficher les détails sans répéter les blocs.

Cette orientation rejoint le retour d’expérience récent de Duolingo : après avoir exploré une approche très modulaire et riche en cartes, leur équipe a préféré simplifier certaines vues, utiliser davantage l’espace blanc et éviter de forcer chaque section dans un conteneur. Source : [Duolingo — Core tabs redesign](https://blog.duolingo.com/core-tabs-redesign/).

## 1. Statistiques : un cockpit plutôt qu’une mosaïque

### Proposition principale

Remplacer la succession de `stats-insight-card`, `operation-stat-card` et `level-card` par une vue en trois niveaux :

1. **Score de forme** central : précision moyenne ou indice synthétique.
2. **Comparaison des opérations** sous forme de barres alignées.
3. **Tendance temporelle** en sparkline ou histogramme sur 7/30 jours.

Une sélection d’opération mettrait à jour un panneau latéral avec record, temps moyen, série et bouton `S’entraîner`.

### Variantes utiles

- **Radar de compétences** : très visuel, mais moins précis pour comparer des valeurs proches.
- **Matrice opération × niveau** : excellente lorsque beaucoup de données existent ; chaque cellule montre précision et nombre de sprints.
- **Courbe unique avec filtres** : idéale pour observer la progression réelle dans le temps.

### Données

Les données `byGame`, `byLevel`, `recentTrend`, `records` et `bestCombination` existent déjà. La matrice et la tendance longue pourraient nécessiter davantage de points historiques côté API.

### Mouvement

- tracé/reveal de la tendance à l’entrée ;
- interpolation des valeurs lors d’un changement de filtre ;
- panneau de détail qui glisse depuis la droite ;
- aucun mouvement permanent.

## 2. Missions : un parcours de quêtes

### Proposition principale

Afficher les missions comme une route verticale ou horizontale :

- étapes terminées en vert ;
- étape courante en turquoise ;
- étape suivante verrouillée ou atténuée ;
- récompense XP attachée à chaque nœud ;
- bouton `Récupérer` directement sur l’étape terminée.

Cette structure répond mieux à la logique de progression que quatre cartes de même poids.

### Variantes utiles

- **Agenda du jour** : missions regroupées par matin/après-midi/soir.
- **Anneau quotidien** : trois segments correspondant aux trois objectifs du jour.
- **Passe de progression** : piste horizontale avec récompenses, à réserver si le produit ajoute des saisons.

### Données

Les missions actuelles fournissent déjà `current`, `target`, `progress`, `completed`, `claimed` et `rewardXp`. Aucun changement d’API n’est nécessaire pour la route de quêtes.

### Mouvement

- le chemin se colore jusqu’à l’étape courante ;
- le gain XP se déplace vers le total lors de la récupération ;
- la prochaine étape se déverrouille sans rechargement visuel de toute la section.

## 3. Badges : une vitrine de trophées

### Proposition principale

Remplacer les accordéons et leurs sous-grilles par une véritable collection :

- deux ou trois étagères visibles ;
- trophées obtenus au premier plan ;
- silhouettes des badges manquants ;
- filtres de famille en dessous ;
- détail dans un panneau latéral ou une bottom sheet.

Les badges les plus rares peuvent être légèrement plus grands. Les badges verrouillés ne doivent pas tous être des cartes pleines : une silhouette donne davantage envie de compléter la collection et allège l’écran.

### Variantes utiles

- **Constellation** : familles de badges reliées par des lignes, adaptée à des dépendances.
- **Album** : pages par famille, adapté à un grand nombre de badges.
- **Mur hexagonal** : compact, très ludique, mais moins bon pour les longs titres.

Xbox permet notamment de garder certains succès secrets tout en laissant l’utilisateur choisir de révéler leurs détails. Mayele pourrait reprendre ce principe pour quelques badges surprise sans masquer toute la progression. Source : [Xbox — Secret Achievements](https://news.xbox.com/en-us/2022/05/31/june-xbox-update/).

### Données

Les familles, niveaux, objectifs, progression et état complété existent déjà. Aucun changement d’API pour la vitrine standard.

## 4. Historique : une timeline avec moments clés

### Proposition principale

Afficher les sessions sur un rail chronologique :

- date/heure sur l’axe ;
- opération et niveau en titre ;
- score dans une pastille compacte ;
- record ou série marquante signalé par un nœud spécial ;
- ouverture du détail dans un panneau dédié plutôt qu’à l’intérieur de la ligne.

Une synthèse hebdomadaire peut terminer le groupe : `5 sprints · +420 XP · précision +6%`.

### Variante “revue guidée”

Pour une session ouverte, montrer uniquement :

1. le résumé ;
2. le meilleur moment ;
3. les erreurs à retravailler ;
4. le bouton `Rejouer cette configuration`.

Chess.com sépare justement les highlights de la revue détaillée, met les moments clés en avant et permet de masquer les fonctions non nécessaires. C’est une bonne référence pour éviter un historique trop dense. Sources : [Game Review redesign](https://www.chess.com/news/view/game-review-design-update), [How Game Review works](https://support.chess.com/en/articles/8584089-how-does-game-review-work).

### Données

Les sessions et réponses existent déjà. La détection d’un `moment clé` peut commencer simplement avec les mauvaises réponses, le meilleur temps, la meilleure série et un nouveau record.

## 5. Amis : roster compact et fiche contextuelle

### Proposition principale

Sur desktop :

- colonne gauche compacte avec avatar, présence et statut ;
- sélection d’un ami sans changer immédiatement de page ;
- panneau central avec ses stats essentielles et les actions ;
- fil d’activité à droite si les données sont disponibles.

Sur mobile :

- liste pleine largeur ;
- swipe ou menu contextuel pour `Défier`, `Voir`, `Retirer` ;
- fiche détaillée en bottom sheet.

Cette approche évite une grande carte répétée pour chaque ami et rend la présence en ligne immédiatement scannable.

### Demandes d’amis

Les demandes reçues devraient apparaître comme une **inbox d’actions**, en tête du roster, avec deux boutons compacts. Les demandes envoyées peuvent être une section repliable secondaire.

### Fil d’activité

Un fil `Bob bat son record`, `Awa gagne un badge`, `Joël passe niveau 5` donnerait beaucoup de vie au social. Duolingo met désormais davantage en avant les réussites des amis dans son feed et facilite le partage des victoires. Source : [Duolingo Product Highlights 2025](https://blog.duolingo.com/product-highlights/).

Le roster, les statuts et les actions utilisent les données actuelles. Le fil d’activité demanderait un nouveau flux d’événements backend ; il doit donc rester une phase séparée.

## 6. Profil d’un ami : une fiche “versus”

Au lieu d’un hero puis de plusieurs grilles de statistiques :

- identité et présence à gauche ;
- comparaison `Vous / Bob` au centre ;
- badges récents sur une petite étagère ;
- historique commun ou derniers défis à droite ;
- CTA principal `Défier` toujours visible.

Une comparaison doit rester bienveillante : afficher les forces respectives plutôt qu’un verdict global de supériorité.

## 7. Salon multijoueur : une table de préparation

### Proposition principale

Placer le défi au centre et les deux joueurs autour :

- avatar hôte à gauche, invité à droite ;
- configuration résumée au milieu ;
- anneau prêt autour de chaque avatar ;
- bouton `Lancer` sous la table ;
- actions secondaires `Inviter`, `Changer de maître`, `Fermer` dans un menu discret.

La configuration détaillée peut s’ouvrir dans un panneau inférieur au lieu de rester constamment visible. Cela donne au salon une composition d’arène et réduit l’impression de formulaire administratif.

### Données

Le salon possède déjà joueurs, rôles, présence, configuration, propositions et état de préparation. La transformation est essentiellement visuelle.

## 8. Résultats multijoueur : scoreboard comparatif

Proposer un score central `Alice 18 — 16 Bob`, puis trois lignes comparables : précision, série, temps moyen. Les informations identiques doivent partager la même ligne, plutôt que vivre dans deux grandes cartes séparées.

- gagnant légèrement surélevé ;
- raison d’un abandon affichée comme annotation ;
- évolution du score ou dépassement clé sur une mini-frise ;
- `Revanche` au centre, `Quitter` en secondaire.

Le podium complet est réservé aux modes avec plus de deux joueurs ; pour un duel, un scoreboard est plus naturel.

## 9. Notifications : un fil groupé, pas une pile de mini-cartes

Regrouper par période et type :

- `Maintenant` : invitation ou proposition nécessitant une action ;
- `Aujourd’hui` : demandes, records d’amis, badge obtenu ;
- `Plus tôt` : informations déjà lues.

Chaque ligne utilise une icône/type, un texte et une heure. La bordure complète n’est nécessaire que pour une notification urgente ou actionnable. Les actions `Accepter`, `Refuser`, `Voir` doivent apparaître directement dans le fil lorsqu’elles existent.

## 10. Paramètres du profil : preview fixe + formulaire par sections

Conserver la prévisualisation du profil dans une colonne fixe et afficher le formulaire sans grande carte englobante :

- identité ;
- informations personnelles ;
- préférences système ;
- confidentialité/présence si ces réglages sont regroupés plus tard.

Une barre d’enregistrement collante en bas apparaît seulement quand le formulaire est modifié. Cela évite que la page ressemble à un formulaire d’administration.

## 11. États vides, erreurs et chargements

Ces zones sont aussi des surfaces de design :

- **aucun ami** : illustration légère + recherche immédiatement disponible ;
- **aucune partie** : aperçu d’une future timeline + CTA `Premier sprint` ;
- **badge verrouillé** : silhouette et prochain objectif ;
- **hors connexion** : bandeau d’état persistant, pas une carte d’erreur au milieu ;
- **chargement** : squelette qui reprend la structure finale, pas une carte générique.

## Matrice de décision

| Zone | Nouveau format recommandé | Données actuelles suffisantes | Effort UI | Priorité |
|---|---|---:|---:|---:|
| Statistiques | cockpit + panneau contextuel | presque | moyen | haute |
| Missions | parcours de quêtes | oui | moyen | haute |
| Badges | vitrine de trophées | oui | moyen | haute |
| Historique | timeline | oui | moyen | haute |
| Amis | roster + fiche contextuelle | oui | moyen | moyenne |
| Activité sociale | feed | non | élevé | ultérieure |
| Salon multijoueur | table de préparation | oui | moyen/élevé | haute |
| Résultats duel | scoreboard comparatif | oui | moyen | haute |
| Notifications | fil groupé | oui | faible/moyen | moyenne |
| Profil | preview fixe + sections | oui | faible/moyen | basse |

## Lot recommandé

Le meilleur lot cohérent serait :

1. parcours de missions ;
2. vitrine de badges ;
3. timeline d’historique ;
4. table de salon multijoueur ;
5. scoreboard de résultats.

Ces cinq transformations donnent à Mayele un vocabulaire réellement ludique, utilisent presque exclusivement les données déjà disponibles et ne nécessitent aucune modification des règles du jeu.
