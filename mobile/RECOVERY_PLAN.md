# Reprise de la version mobile

## Changements déduits de la conversation

- passer d’Expo SDK 57 à SDK 54 pour Expo Go sur iPhone ;
- ajouter les commandes `start:go` avec LAN, tunnel et nettoyage du cache ;
- remplacer les vues Clerk natives par une authentification JavaScript ;
- persister la session Clerk dans SecureStore ;
- empêcher le mélange d’une clé Clerk test avec une API distante/live ;
- stabiliser l’accès à `getToken` pour éviter les effets React relancés en boucle ;
- n’avoir qu’une décision d’affichage entre chargement, authentification et application ;
- afficher les erreurs `/api/me` au lieu de rediriger indéfiniment ;
- conserver le projet Expo sous le slug `mayele` et afficher le nom `Mayele` ;
- neutraliser les intégrations natives facultatives dans Expo Go ;
- valider TypeScript, lint, tests, Expo Doctor et l’export iOS.

## État reconstruit

Le socle permet maintenant de tester Expo Go → Clerk → profil Mayele → partie solo autoritaire → résultat. La navigation Jouer / Mon espace / Amis et les sous-routes sont en place. Progression, Missions, Badges, Profil et les fonctions sociales restent des placeholders explicites à remplacer une par une.

## Suite recommandée

1. Valider le socle sur l’iPhone avec la checklist du README.
2. Recréer ensuite les écrans métier un par un à partir des contrats API existants.
3. Ajouter un test pour chaque écran avant de passer au suivant.
4. Créer un commit Git dès que le test iPhone est concluant.
5. Revenir à un SDK Expo plus récent seulement lors de la préparation d’une development build/TestFlight.
