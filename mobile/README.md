# Mayele mobile — Expo Go

Le socle mobile utilise Expo SDK 54 afin d’être testable gratuitement avec Expo Go sur un iPhone physique. L’authentification Clerk utilise une interface JavaScript compatible Expo Go : connexion par e-mail et mot de passe, inscription suivie d’un code de vérification, et réinitialisation du mot de passe par code e-mail. Elle n’utilise pas les composants natifs `AuthView` ou `UserButton`, qui exigent une development build.

## Lancement recommandé

Installe ou mets à jour Expo Go sur l’iPhone. Connecte le PC et l’iPhone au même Wi-Fi, puis lance depuis la racine du dépôt :

```powershell
.\START_MAYELE_MOBILE.ps1
```

Le script :

1. détecte l’adresse Wi-Fi du PC ;
2. configure `EXPO_PUBLIC_API_URL` ;
3. aligne la clé publique Clerk mobile sur celle du serveur local ;
4. installe les dépendances manquantes ;
5. démarre et vérifie l’API ;
6. lance Expo Go et affiche le QR.

Scanne le QR depuis Expo Go. Le script n’utilise pas `EXPO_NO_REDIRECT_PAGE=1`, qui peut produire un lien `exp://` mal reconnu par l’appareil photo iOS.

## Options

```powershell
.\START_MAYELE_MOBILE.ps1 -Clear       # vide le cache Metro
.\START_MAYELE_MOBILE.ps1 -Tunnel      # tunnel Expo si le LAN bloque Metro
.\START_MAYELE_MOBILE.ps1 -CheckOnly   # vérifie sans lancer
.\START_MAYELE_MOBILE.ps1 -SkipServer  # utilise une API déjà lancée
```

Le tunnel ne publie pas l’API locale : l’iPhone doit rester sur le même Wi-Fi pour joindre Mayele.

## Test attendu sur iPhone

1. Pour te connecter, saisis l’adresse e-mail et le mot de passe d’un compte existant.
2. Pour créer un compte, saisis une adresse e-mail et un mot de passe, puis le code reçu par e-mail.
3. Pour tester « Mot de passe oublié », saisis l’adresse e-mail, le code reçu, puis le nouveau mot de passe. La réinitialisation déconnecte les autres sessions du compte.
4. La session est stockée avec SecureStore et survit à la fermeture d’Expo Go.
5. Pour un nouveau compte, complète le profil Mayele demandé sur la page Jouer.
6. Vérifie que les trois objectifs du jour sont chargés dans le bandeau horizontal. Une deuxième carte doit rester visible sur le bord droit pour signaler le défilement.
7. Configure Sprint/Tempo, durée ou paramètres Tempo, opération et niveau, puis démarre la partie. Les choix sont disposés en grille compacte et ne doivent plus être coupés.
8. Appuie sur le `?` de Mode pour vérifier l’aide Sprint/Tempo.
9. Utilise la bascule Solo/Multijoueur, configure un défi, puis appuie sur la bulle `+` pour choisir un ami. La confirmation d’envoi doit apparaître dans une bulle verte et disparaître seule après environ trois secondes ; le profil et le statut de l’ami remplacent ensuite le `+`.
10. Avec un deuxième compte ouvert sur `http://localhost:5173`, accepte l’invitation et entre dans le salon. L’iPhone doit passer automatiquement de « Invitation envoyée » à « Les deux joueurs sont dans le salon ».
11. Depuis l’iPhone maître du salon, modifie plusieurs choix. Ils doivent apparaître sur le deuxième compte. Appuie ensuite sur « Proposer le défi ».
12. Depuis le compte invité, refuse une première proposition : le salon revient à l’état modifiable. Propose de nouveau puis accepte : les deux appareils doivent ouvrir simultanément l’arène.
13. En Sprint, vérifie que le chrono démarre à la durée configurée et qu’aucun résultat vide n’est envoyé à l’ouverture. Réponds sur les deux appareils jusqu’à la fin : chacun passe en attente après son propre résultat, puis les deux affichent le même vainqueur et les mêmes scores.
14. Recommence en Tempo : chaque joueur doit attendre l’autre après sa réponse, une expiration doit enregistrer la réponse éventuellement saisie, puis la question suivante doit apparaître simultanément des deux côtés.
15. Depuis le résultat, demande une revanche sur un appareil, accepte-la sur l’autre, puis vérifie que le nouveau salon reprend la configuration du duel. Teste aussi « Quitter le résultat ».
16. Pendant une autre partie, appuie sur la croix : annule une première fois la confirmation, puis confirme l’abandon et vérifie que l’adversaire voit immédiatement sa victoire.
17. Vérifie aussi le bouton Annuler/Quitter du salon : la confirmation doit le fermer pour les deux joueurs, puis rendre le `+` disponible.
18. Explore les onglets Jouer, Mon espace et Amis ; les rubriques non reconstruites affichent un placeholder explicite.
19. Ferme et rouvre Expo Go pour vérifier la restauration de session.

## Dépannage

- QR non reconnu : utilise le lecteur intégré d’Expo Go.
- Écran bloqué : arrête Metro avec `Ctrl+C`, puis relance avec `-Clear`.
- API indisponible : autorise Node.js dans le pare-feu Windows et vérifie que les deux appareils sont sur le même Wi-Fi.
- `401` après connexion : relance le script ; il réaligne automatiquement l’environnement Clerk local.
- Multijoueur indisponible : relance le script, qui aligne maintenant `EXPO_PUBLIC_REALTIME_URL` sur la même adresse locale que l’API.
- Port 8081 occupé : arrête l’ancien terminal Expo ou accepte le port proposé.

## Validation locale

```powershell
cd mobile
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform ios
```

Pour une future development build ou publication, utilise les profils présents dans `eas.json`. Une nouvelle build native devient nécessaire après l’ajout d’un module natif ou la modification d’un plugin/configuration iOS.

## Découpage actuel

- `Jouer` : bascule Solo/Multijoueur, partie solo connectée à l’API, objectifs quotidiens, salon multijoueur et invitations temps réel ;
- `Mon espace` : Progression, Missions, Badges et Profil préparés comme sous-pages ;
- `Amis` : Recherche, Demandes et Défis préparés comme sous-pages ;
- Notifications et menu : routes accessibles depuis l’en-tête ;
- le multijoueur gère l’entrée de l’invité, la configuration versionnée par le maître, la proposition/refus/acceptation, les réponses Sprint/Tempo enregistrées par le backend, l’attente de l’adversaire, l’abandon, le résultat partagé et la revanche ;
- les autres sous-pages en attente affichent un placeholder au lieu d’une route cassée.
