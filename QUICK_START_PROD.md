## 🎯 Démarrage rapide — v1.0 Production

**Objectif** : Deployer Mayele Maths en production simple et gratuite

---

### 📦 Fichiers clés ajoutés

```
✨ NEW:
  - Dockerfile              (build production)
  - railway.json            (config Railway)
  - DEPLOYMENT_GUIDE_FR.md  (📖 LIRE CECI EN PREMIER)
  - STRUCTURE_PRODUCTION.md (architecture overview)
  - build-prod.ps1          (test build local)
  - .env*.example           (templates)

🔄 MODIFIÉ:
  - server/src/index.js     (sert frontend + API)
  - .gitignore              (secrets)
```

---

### ⚡ Checklist 30 sec

1. ✅ **Générer JWT_SECRET**
   ```powershell
   $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
   Write-Output $secret
   ```

2. ✅ **Test local**
   ```bash
   .\build-prod.ps1
   ```

3. ✅ **Créer Railway** : https://railway.app

4. ✅ **Connecter repo** : Railway → New Project → From GitHub

5. ✅ **Ajouter secret** : Railway Settings → Variables
   - `JWT_SECRET=<votre-secret>`
   - `NODE_ENV=production`

6. ✅ **Redéployer** : `git push` (Railway redéploie auto)

---

### 📖 Documentation complète

👉 **Lire** : [DEPLOYMENT_GUIDE_FR.md](DEPLOYMENT_GUIDE_FR.md)

*(10 min, tout est expliqué pas-à-pas)*

---

### 💰 Coûts

- **Mois 1** : Gratuit
- **Après** : ~$5/mois (très abordable)
- **Domaine** : optionnel, ~$10/an

---

### ✨ Architecture finale

```
Browser → Railway App (Node.js)
          ├── Sert React (static)
          ├── API Express routes
          └── SQLite DB (persistant)
```

**Un seul déploiement = tout est en prod**

---

### 🔐 Secrets à protéger

⚠️ **Ne JAMAIS commiter** :
- `server/.env.production` (JWT_SECRET)
- `client/.env.production.local` (URLs)

✅ **C'est dans .gitignore** : vous êtes protégé

---

### 🚀 C'est prêt !

```bash
git add .
git commit -m "Production setup ready"
git push origin main
```

Railway détectera le Dockerfile et déploiera.

---

**Questions ?** → Lire `DEPLOYMENT_GUIDE_FR.md` 📖
