# Plan d’évolution Mayele — lot 2

Date : 18 juillet 2026  
Landing page : hors périmètre, conformément à la demande précédente.

Ce document transforme chaque retour en critère vérifiable. Une page n’est considérée comme terminée que si son contenu, ses interactions, son rendu mobile et son rendu desktop ont été contrôlés.

## Principes de rédaction

- parler au joueur, jamais commenter l’interface ou expliquer l’intention du design ;
- supprimer les formulations comme « Une lecture claire de vos forces », « Route active », « Focus » ou « Données cumulées » ;
- employer des titres directement utiles : « Résultats par niveau », « À travailler », « Vos défis » ;
- ne pas répéter sous un titre ce que l’action ou la composition montre déjà ;
- réserver les explications aux règles que le joueur doit réellement connaître.

## 1. Mon espace — en-tête

### Objectif

Transformer l’identité statique en résumé vivant de la progression.

### Évolutions

- niveau et progression vers le niveau suivant visibles immédiatement ;
- série actuelle, XP restant et dernier résultat dans une bande compacte ;
- badges récents présentés comme une collection, avec leurs vraies illustrations ;
- animation courte au chargement et respect de `prefers-reduced-motion` ;
- navigation des quatre vues conservée, sans repousser le contenu utile trop bas.

### Validation

- aucune information purement décorative ou formulée comme une note de conception ;
- en-tête lisible à 390, 768, 1024 et 1440 px.

## 2. Statistiques

### Objectif

Remplacer le pourcentage global ambigu par une lecture qui tient compte du niveau de difficulté.

### Évolutions

- score présenté par niveau : Débutant, Intermédiaire, Avancé et Expert ;
- distinction entre maîtrise, volume de jeu et vitesse ;
- comparaison d’une même opération entre niveaux ;
- indication du volume d’échantillon pour éviter de surévaluer une seule partie ;
- recommandations liées à une opération **et** un niveau ;
- conservation de la tendance récente, mais sans en faire l’indicateur principal ;
- ajout de données utiles au-delà du cockpit existant : régularité, couverture des niveaux et prochaine cible.

### Validation

- 50 % en Expert ne doit jamais être présenté comme équivalent à 50 % en Débutant ;
- chaque métrique doit répondre à une décision possible : continuer, changer de niveau ou retravailler une compétence.

## 3. Quêtes quotidiennes

### Objectif

Proposer de vraies journées différentes et garantir leur réinitialisation.

### Évolutions

- catalogue élargi : volume, précision, série, vitesse, opération, niveau et variété ;
- sélection quotidienne stable pendant la journée, mais différente le jour suivant ;
- progression et récupération rattachées à la date de la quête ;
- reset vérifié même si l’application reste ouverte au changement de jour ;
- intitulés naturels, sans « quête quotidienne » répété sur chaque ligne.

### Validation

- tests jour J / jour J+1 ;
- deux lectures le même jour retournent les mêmes quêtes ;
- aucune progression de la veille ne contamine la nouvelle journée.

## 4. Vitrine de trophées

### Objectif

Faire comprendre la progression de chaque badge et utiliser son identité visuelle réelle.

### Évolutions

- vraie illustration du badge débloqué ou à atteindre ;
- une jauge indépendante et clairement rattachée à chaque trophée ;
- valeur courante, objectif et état obtenable visibles sans ouvrir le détail ;
- étagères conservées, mais séparateurs décoratifs distincts des jauges ;
- état verrouillé lisible sans remplacer toutes les illustrations par « ? ».

### Validation

- aucune barre grise ne peut être interprétée comme une jauge commune ;
- les assets existants sont réutilisés, sans nouvelle iconographie générique.

## 5. Historique

### Objectif

Lire immédiatement la qualité d’une session tout en conservant la timeline appréciée.

### Seuils

- moins de 25 % : rouge, « À reprendre » ;
- de 25 % à moins de 50 % : jaune, « Fragile » ;
- de 50 % à moins de 75 % : orange, « En progrès » ;
- de 75 % à 100 % : vert, « Solide ».

### Validation

- la couleur est appliquée au nœud, au score et à un accent de ligne ;
- le libellé reste présent pour ne pas dépendre uniquement de la couleur ;
- le détail des réponses et les actions existantes restent fonctionnels.

## 6. Jeu solo

### Objectif

Faire évoluer l’ensemble du parcours et pas seulement le dashboard.

### Évolutions

- configuration plus tactile et résumé de partie immédiatement compréhensible ;
- départ, changement de question et seuils de série plus dynamiques ;
- résultat final hiérarchisé : score, progression, point à retravailler, rejouer ;
- suppression des messages qui décrivent la mécanique interne plutôt que l’objectif du joueur.

## 7. Multijoueur

### Objectif

Conserver l’arène tout en utilisant une rédaction directe et une autorité serveur explicite seulement quand elle est utile au joueur.

### Évolutions

- remplacer « Créer un salon » par une action orientée joueur, par exemple « Lancer un défi » ;
- supprimer la description « Invitez un ami, composez le défi… » ;
- lobby, préparation, attente, partie et résultat traités comme cinq états d’une même expérience ;
- ne jamais afficher de termes comme snapshot, état canonique, synchronisation ou serveur authoritative ;
- poursuivre la migration serveur des questions Sprint et de la reprise Tempo dans un lot backend dédié.

## 8. Amis, profil ami et notifications

### Objectif

Finaliser les structures déjà engagées.

### Évolutions

- roster : états vides, demandes et actions compactes ;
- profil ami : comparaison utile et bienveillante, pas seulement un habillage « versus » ;
- notifications : actions prioritaires visibles, regroupement et lecture mobile ;
- vocabulaire homogène entre invitation, défi, proposition et revanche.

## 9. Paramètres du profil

### Objectif

Faire évoluer la page au-delà de sa simple conservation.

### Évolutions

- aperçu plus vivant et cohérent avec le nouvel en-tête de Mon espace ;
- sections mieux séparées sans accumulation de grandes cartes ;
- barre d’enregistrement visible seulement après une modification ;
- retours de sauvegarde courts et orientés résultat.

## 10. Connexion et inscription

### Objectif

Vérifier les pages fonctionnelles restantes, même si la landing est exclue.

### Évolutions

- cohérence des états chargement, erreur et succès ;
- transitions sobres entre les étapes ;
- aucune promesse ou explication interne inutile ;
- validation clavier, focus et affichage mobile.

## Ordre d’exécution

1. statistiques, quêtes, trophées, historique et en-tête Mon espace ;
2. jeu solo et multijoueur complet ;
3. amis, profil ami, notifications et paramètres ;
4. connexion/inscription ;
5. validation visuelle globale et notation finale sans déclarer les phases futures comme terminées.

