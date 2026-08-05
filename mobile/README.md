# Mayele Maths — application mobile

Client Expo SDK 57 pour iOS et Android. Il réutilise Clerk et l’API Express de la webapp Mayele.

## Premier lancement sur iPhone

Les vues Clerk préconstruites sont natives et nécessitent une **development build**. Elles ne fonctionnent pas dans Expo Go.

1. Dans le Dashboard Clerk, ouvre **Native applications** et active **Native API**.
2. Installe EAS CLI puis connecte-toi :

   ```powershell
   npm install --global eas-cli
   eas login
   ```

3. Depuis `mobile/`, lie le projet Expo et enregistre l’iPhone :

   ```powershell
   eas build:configure
   eas device:create
   ```

4. Crée la development build iOS :

   ```powershell
   npm run build:ios:development
   ```

5. Installe le fichier `.ipa` via le QR code EAS. Sur iOS 16 ou plus récent, active ensuite **Réglages > Confidentialité et sécurité > Mode développeur**.

## Développement quotidien

Le PC et l’iPhone doivent être sur le même réseau Wi-Fi. Démarre d’abord l’API :

```powershell
cd C:\Users\emery\dev\mayele
.\START_MAYELE_MOBILE.ps1
```

Ce lanceur détecte l’adresse Wi-Fi, actualise `mobile/.env.local`, démarre l’API en arrière-plan, vérifie `/api/health`, puis affiche le QR Expo. Utilise `-Tunnel` si la découverte du serveur Expo est bloquée, ou `-CheckOnly` pour vérifier la configuration sans rien démarrer.

Pour lancer les deux processus manuellement :

```powershell
cd server
npm run dev
```

Puis, dans un second terminal :

```powershell
cd mobile
npm start
```

Ouvre la development build Mayele sur l’iPhone et scanne le QR code. Utilise `npm run start:tunnel` si le réseau local bloque la découverte du serveur Expo.

`mobile/.env.local` pointe actuellement sur `http://10.31.208.72:4000/api`. Si l’adresse Wi-Fi du PC change, récupère-la avec `ipconfig` et remplace cette valeur. `localhost` désignerait l’iPhone, pas le PC.

## Vérifications et publication

```powershell
npm run typecheck
npx expo-doctor
npm run build:ios:production
npm run submit:ios
```

Le bundle identifier initial est `com.mayele.maths`. Il doit être unique dans ton compte Apple ; modifie-le dans `app.json` avant la première publication s’il est déjà pris.

Les composants natifs Clerk (`AuthView`, `UserButton`) sont encore en bêta. Si leur stabilité devient insuffisante avant la production, conserve Clerk mais remplace seulement l’interface d’authentification par un flux JavaScript personnalisé.
