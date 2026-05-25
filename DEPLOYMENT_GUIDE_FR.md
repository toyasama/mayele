# 🚀 Guide de déploiement en production — Mayele Maths

## Objectif
Déployer votre application **React + Express + SQLite** en production de manière **simple et gratuite** (ou presque).

---

## 📍 Architecture finale

```
┌─────────────────────────────────────────┐
│   Railway App (Frontend + Backend)      │
│  ┌───────────────────────────────────┐  │
│  │  Node.js Server (Express)         │  │
│  │  - Sert l'API                     │  │
│  │  - Sert le build React (static)   │  │
│  │  - Base SQLite locale             │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Avantages** :
- Un seul déploiement à gérer
- Persistance SQLite sur le filesystem de Railway
- Gratuit les 5 premiers jours, puis ~5$/mois (très abordable)
- Scalabilité facile (passer à PostgreSQL + DB externe plus tard)

---

## 1️⃣ Préparation locale

### Vérifier que tout fonctionne en local

```bash
# Terminal 1 - Frontend
cd client
npm install
npm run build    # ← Important : génère le dossier dist/

# Terminal 2 - Backend
cd server
npm install
NODE_ENV=production npm start
```

Accédez à : **http://localhost:4000**

Vous devriez voir votre app en production locale. ✅

---

## 2️⃣ Configuration des secrets (JWT)

Avant le déploiement, générez un secret JWT sécurisé :

```bash
# PowerShell
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
Write-Output $secret
```

OU utilisez un générateur en ligne : https://generate-random.org/ (32+ caractères)

**⚠️ Jamais en dépôt Git** : gardez ce secret pour Railway uniquement.

---

## 3️⃣ Déploiement sur Railway

### Option A : Via interface web (recommandée pour débuter)

1. **Créer un compte** : https://railway.app (gratuit)

2. **Connecter votre repo GitHub** :
   - Click **"New Project"** → **From GitHub Repo**
   - Autorisez Railway à accéder à votre repo
   - Sélectionnez `mayele`

3. **Configuration utilisée** :
   - Railway détecte le `Dockerfile` automatiquement
   - Lance le build et le déploiement

4. **Ajouter les variables d'environnement** :
   - N'allez pas en Settings (variables) du projet
   - Cliquez sur le service (après son déploiement)
   - Onglet **"Variables"**
   - Ajoutez :
     ```
     NODE_ENV=production
     JWT_SECRET=<votre-secret-généré>
     PORT=4000
     ```

5. **Deploy** : Railway redéploie et votre app est live ! 🎉

### Option B : Via CLI Railway (avancé)

```bash
# Installer Railway CLI
npm i -g @railway/cli

# Login et déployer
railway login
railway init        # Créer un projet
railway up          # Déployer

# Ajouter les variables
railway variables
```

---

## 4️⃣ Vérifier le déploiement

Une fois déployé :

1. **Railway** vous donne l'URL publique : ex. `https://mayele-api-production-xyz.railway.app`

2. **Tester l'API** :
   ```bash
   curl https://mayele-api-production-xyz.railway.app/api/health
   # Devrait retourner : {"status":"ok"}
   ```

3. **Mettre à jour le frontend** :
   - Éditer `client/.env.production.local` :
     ```
     VITE_API_URL=https://mayele-api-production-xyz.railway.app/api
     ```
   - (ou dans Vite, ajouter une condition pour différencier dev/prod)

4. **Rebuilt et redéployez** :
   ```bash
   cd client && npm run build
   git add . && git commit -m "Production deployment"
   git push
   ```

---

## 5️⃣ Configuration du frontend pour la prod

Dois adapter **une seule fois** votre client pour utiliser les variables d'env correctement.

Dans [client/src/lib/api.ts](client/src/lib/api.ts), c'est déjà bon :
```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
```

Ça veut dire :
- **En local** : utilise `/api` (fallback)
- **En prod** : utilise `VITE_API_URL` depuis le `.env.production`

### Créer `.env.production`

```
VITE_API_URL=https://votre-domaine-railway.railway.app/api
```

---

## 6️⃣ Domaine personnalisé (optionnel mais recommandé)

Au lieu de `mayele-xyz.railway.app`, vous préférez peut-être `mayele.dev` ?

**Railway** supporte les domaines personnalisés :
1. Acheter un domaine (Namecheap, Vercel, etc.)
2. Dans Railway → Project Settings → **Domains**
3. Ajouter votre domaine + configurer le DNS

*(Étape optionnelle pour v1, idéale pour v2)*

---

## 7️⃣ Monitorage et logs

Railway offre une console pour voir les logs en direct :
- Dashboard → Your App → Logs
- Parfait pour déboguer les erreurs en prod

---

## 🔄 Workflow de mise à jour

À chaque fois que vous faites un changement :

```bash
# 1. Build local
cd client && npm run build

# 2. Commit & push
git add .
git commit -m "Nouvelle feature"
git push origin main

# 3. Railway détecte et redéploie automatiquement
#    (regarder les logs pour vérifier)
```

---

## 💰 Coûts

- **Mois 1-2** : Gratuit (~$5 crédits inclus)
- **À partir du mois 3** : ~$5/mois pour 1 service Node.js
- **Avantage** : arrêt instantané si limite atteinte, pas de surprise

👉 *Si vous voulez illimité*, regarder Render.com (gratuit mais plus limité) ou Railway premium.

---

## 🆘 Troubleshooting

### L'app ne démarre pas
- Vérifier les logs Railway (Logs tab)
- Vérifier `JWT_SECRET` est défini
- Vérifier `PORT=4000` est accepté

### Les connexions utilisateurs ne marchent pas
- Certifier que `JWT_SECRET` est le **même** en local et prod
- Vérifier que la DB SQLite se crée bien : `data/mayele.db`

### Les requêtes API retournent 404
- Vérifier `VITE_API_URL` pointe vers la bonne URL
- Vérifier le build React inclut les fichiers : `cd client && npm run build`

### La DB est perdue après redéploiement
- Railway a un filesystem persistant, mais il vaut mieux migrer vers PostgreSQL/Supabase pour la v2
- Pour maintenant, pas de soucis, la DB est conservée

---

## ✨ Étapes suivantes (après v1)

1. **PostgreSQL** : Remplacer SQLite par Postgres (gratuit sur Railway)
2. **Monitoring** : Ajouter Sentry ou Logrocket
3. **Domaine** : Acheter un domaine personnalisé
4. **Email** : Ajouter confirmations par email (SendGrid gratuit)
5. **Analytics** : Suivre les utilisateurs (Posthog, Plausible)

---

## 📞 Support

- **Railway Docs** : https://docs.railway.app
- **Votre repo local** : Vous garder le contrôle total avec Git

Bonne chance ! 🚀
