# Analyse UI — rendre Mayele plus vivant sans casser l’existant

Date : 16 juillet 2026

![Planche de concepts](local_data/design-audit/mayele-motion-concepts.png)

## Synthèse

Mayele dispose déjà d’une base claire, cohérente et responsive. Le principal décalage avec les meilleurs produits ludiques ne vient pas des fonctionnalités, mais de la manière dont l’interface réagit : beaucoup d’écrans sont visuellement statiques et ressemblent davantage à un tableau de bord SaaS qu’à une expérience de jeu.

La direction recommandée est **« arcade pédagogique maîtrisée »** : des réactions courtes pendant le sprint, une progression plus expressive dans le dashboard et de vraies célébrations uniquement aux moments importants. Les routes, APIs, règles de score et données actuelles peuvent rester inchangées.

## Diagnostic de l’existant

### Ce qui fonctionne déjà

- Palette et identité cohérentes : bleu nuit, turquoise, vert, jaune.
- Hiérarchie claire sur la landing, le dashboard et la configuration du sprint.
- Parcours courts et compréhensibles.
- Feedback correct/erreur déjà présent dans `challenge-experience.css` et `multiplayer-arena-modern.css`.
- Prise en charge de `prefers-reduced-motion` déjà amorcée sur les arènes et les squelettes de chargement.
- Les badges, missions, XP, séries et niveaux fournissent déjà les bonnes données pour une couche de dynamisme.

### Ce qui rend l’expérience encore trop statique

- Seulement huit déclarations `transition` dans l’ensemble des feuilles de style au moment de l’audit.
- Hors arène, les changements de page, onglets, compteurs, badges et missions apparaissent sans continuité visuelle.
- La landing montre une fausse partie, mais celle-ci ne « joue » pas : elle explique le produit sans le faire ressentir.
- Le dashboard donne les chiffres, mais ne raconte pas le gain : pas de montée d’XP, de mission réclamée, de badge révélé ou de série mise en scène.
- Les cartes utilisent une esthétique très rectangulaire et uniforme ; les états hover/pressed/selected sont peu expressifs.
- La fin de sprint montre un résultat, mais pourrait mieux enchaîner score, XP, mission et envie de rejouer.

## Ce que font les références pertinentes

- **Duolingo** réserve des animations fortes aux jalons : séries, fin de leçon et coffres. Son équipe explique aussi traiter les jalons comme des « power-ups » et travailler précisément le timing. Application à Mayele : célébrer les seuils, pas chaque clic. Sources : [Product Highlights 2025](https://blog.duolingo.com/product-highlights/), [Animating the Duolingo Streak](https://blog.duolingo.com/streak-milestone-design-animation/).
- **Kahoot!** alterne réponse, résultat, classement, messages de série et podium. Cette respiration transforme les changements de score en événements. L’option « rejouer contre ses fantômes » donne aussi un objectif immédiat au replay. Application à Mayele : montrer les dépassements, les séries et le meilleur score personnel au bon moment. Source : [Tips for hosting a live game](https://support.kahoot.com/hc/en-us/articles/360039900153-Tips-for-hosting-a-live-game).
- **Blooket** transforme l’XP et les jetons gagnés en boucle de collection et en récompense quotidienne. Application à Mayele : rendre les gains existants tangibles, sans nécessairement ajouter une roue aléatoire. Source : [How to Earn Tokens/XP in Blooket](https://help.blooket.com/hc/en-us/articles/16620459001495-Earning-Tokens-XP).
- **Chess.com** place l’excitation du résultat en haut de sa Game Review, puis guide l’utilisateur à travers les moments importants avec un coach et des actions « Retry ». Application à Mayele : commencer l’écran de résultat par le meilleur moment, puis proposer immédiatement le point à retravailler. Sources : [Game Review design update](https://www.chess.com/news/view/game-review-design-update), [How Game Review works](https://support.chess.com/en/articles/8584089-how-does-game-review-work).

## Trois directions possibles

| Direction | Caractère | Effort estimatif | Risque | Verdict |
|---|---|---:|---:|---|
| **Polish subtil** | transitions de pages, hover, compteurs, barres animées | 2–3 jours | faible | bon premier lot |
| **Arcade pédagogique** | polish + feedback de sprint + séries + récompenses scénarisées | 5–8 jours | modéré | **recommandé** |
| **Compétitif social** | arcade + dépassements, podium, réactions multijoueur, replay fantôme | 8–12 jours | plus élevé | deuxième étape |

## Améliorations proposées

### 1. Landing : transformer l’aperçu en mini-démo

- Faire défiler une boucle de 4 à 6 secondes : question → saisie de « 42 » → validation → `+10 XP` → compteur de série.
- Mettre la boucle en pause après un cycle et au survol pour éviter une animation permanente.
- Donner une vraie profondeur au CTA : ombre basse, compression de 2–3 px au clic, retour rapide.
- Ajouter un léger décalage entre le titre, le texte et les boutons à l’entrée (`opacity + translateY`, 180–260 ms).
- Garder le fond presque immobile : deux halos avec une dérive très lente et une amplitude faible.

Effet attendu : comprendre la promesse de Mayele avant même de se connecter.

### 2. Configuration du sprint : rendre chaque choix satisfaisant

- Faire glisser un indicateur entre Solo/Multijoueur et Sprint/Tempo au lieu de remplacer brutalement la couleur.
- Donner aux chips d’opération un état pressé et un petit ressort au changement.
- Mettre à jour le titre et un mini-résumé de la partie avec un fondu croisé quand la configuration change.
- Transformer « Commencer le sprint » en véritable départ : compression, balayage lumineux très bref, puis transition vers un compte à rebours `3–2–1`.

Effet attendu : rendre le réglage de partie plus tactile sans changer le formulaire.

### 3. Pendant le sprint : augmenter le “game feel”

- Réponse correcte : pulse de la question, anneau vert, `+XP` flottant et 4 à 8 particules maximum.
- Réponse incorrecte : shake horizontal plus court, rouge corail localisé, puis indication de la bonne réponse sans flash plein écran.
- Série : feedback discret aux réponses ordinaires, plus fort uniquement aux seuils 3, 5 et 10.
- Temps critique : conserver le clignotement existant, mais colorer progressivement la barre et éviter de faire pulser toute la page.
- Afficher une micro-transition entre deux questions (`out 90 ms`, remplacement, `in 120 ms`) pour supprimer l’impression de coupure.
- Prévoir un bouton son global avant d’ajouter éventuellement des sons très courts ; aucun son automatique sur la landing.

Effet attendu : chaque bonne réponse paraît plus gratifiante, sans réduire le nombre de réponses possibles en 60 secondes.

### 4. Fin de sprint : scénariser le résultat

- Révéler dans cet ordre : score principal → précision/série → XP gagné → mission progressée → nouveau badge éventuel.
- Limiter la séquence complète à environ 1,2 seconde ; toutes les données doivent rester visibles immédiatement si l’utilisateur clique.
- Mettre en avant une seule action principale : `Rejouer` ; conserver `Changer de mode` en secondaire.
- Ajouter `Battre mon score : 18` ou `Encore 2 bonnes réponses pour ton record` avec les données déjà disponibles.
- En cas de nouveau record, réserver la grande célébration à ce seul moment.

Effet attendu : créer une conclusion mémorable et une raison immédiate de relancer une partie.

### 5. Dashboard : rendre la progression tangible

- Compteurs en count-up une seule fois à l’arrivée sur la vue.
- Barre de niveau animée depuis sa valeur précédente, pas depuis zéro à chaque visite.
- Mission terminée : passage à un état `À récupérer`, puis transfert visuel des XP vers le compteur global.
- Badge nouvellement obtenu : carte dédiée de 700–900 ms, avec option de partager ou fermer.
- Série quotidienne : carte plus expressive, mais statique tant qu’elle ne change pas.
- Historique : petite courbe/heatmap hebdomadaire qui s’anime au reveal, pas en boucle.

Effet attendu : montrer la conséquence des parties, pas seulement leur total.

### 6. Multijoueur : faire vivre la salle

- Arrivée d’un joueur : avatar qui glisse dans la liste + toast court.
- État prêt : anneau animé une seule fois puis état fixe.
- Dépassement : message `Tu passes 2e` au lieu d’un classement qui change silencieusement.
- Fin : podium en trois temps, puis bouton revanche immédiatement disponible.
- Garder le temps réel autoritaire côté serveur ; toutes les animations restent une représentation visuelle de l’état reçu.

Effet attendu : augmenter la présence sociale sans toucher au protocole Socket.IO.

## Fondations techniques recommandées

Pas besoin d’introduire une grosse bibliothèque d’animation pour la première phase. La stack React/Vite actuelle suffit avec CSS et, pour les séquences ponctuelles, la Web Animations API.

```css
:root {
  --motion-instant: 120ms;
  --motion-fast: 180ms;
  --motion-normal: 260ms;
  --motion-celebrate: 650ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
}
```

Principes d’implémentation :

- animer en priorité `transform` et `opacity` ;
- réserver les animations de layout aux rares cas indispensables ;
- ne jamais bloquer la saisie ou la navigation pendant une célébration ;
- déclencher les animations à partir des états React existants (`is-correct`, `is-wrong`, `finished`, progression, résultat) ;
- stocker les animations déjà vues par session pour ne pas répéter les reveals ;
- tester les timings avec Playwright sans faire dépendre les tests fonctionnels de la durée exacte des animations.

## Accessibilité et garde-fous

Mayele utilise déjà `prefers-reduced-motion` sur plusieurs zones : il faut étendre cette règle à toute nouvelle animation. Le W3C recommande de supprimer les mouvements d’interaction non essentiels pour les personnes ayant activé cette préférence. Source : [W3C Technique C39](https://www.w3.org/WAI/WCAG21/Techniques/css/C39).

- En mode réduit : remplacer déplacements, shakes et zooms par un fondu ou un changement de couleur instantané.
- Pas de confettis après chaque réponse.
- Pas de fond en mouvement continu sur mobile ou appareil peu puissant.
- Aucune information portée uniquement par le mouvement ou la couleur.
- Éviter les flashes rapides et les changements plein écran.
- Fournir un contrôle pour les sons et respecter son choix.

## Ordre de mise en œuvre

1. **Fondations** : tokens de durée/easing, composant de reveal, gestion globale du mode réduit.
2. **Sprint** : transition de question, feedback, séries, fin de partie.
3. **Landing** : mini-démo et CTA tactile.
4. **Dashboard** : compteurs, progression, mission réclamable, badge reveal.
5. **Multijoueur** : arrivée, prêt, dépassement, podium et revanche.
6. **Mesure** : taux de démarrage, complétion, replay, abandon pendant la configuration, temps jusqu’à la partie suivante.

Le meilleur premier lot combine les étapes 1 à 3 : il produit le plus grand gain perçu avec très peu de risque sur la base fonctionnelle.
