# Plan technique — Site de jeux mathématiques (`React + Vite`)

## 1. Direction retenue
Vous souhaitez un produit :
- **moderne** ;
- **beau** ;
- **optimisé** ;
- **accessible sur PC et téléphone** ;
- avec **compte utilisateur**, **connexion** et **suivi de progression**.

La stack retenue est donc :
- **Frontend** : `React + Vite + TypeScript`
- **UI** : `Tailwind CSS`
- **Navigation** : `React Router`
- **Backend local** : `Node.js + Express`
- **Base locale** : `SQLite`
- **Authentification** : email + mot de passe chiffré

---

## 2. Architecture proposée

### Frontend
Le site affichera :
- une page d'accueil élégante ;
- une page de connexion / inscription ;
- un tableau de bord ;
- les jeux ;
- les statistiques de progression.

### Backend local
Le serveur local gérera :
- la création des comptes ;
- la connexion ;
- l'enregistrement des scores ;
- la progression par thème ;
- les données du profil.

### Base de données locale
Pour commencer simplement et proprement, la base locale recommandée est **SQLite**.

Pourquoi SQLite :
- gratuit ;
- léger ;
- très bon pour un prototype sérieux ;
- facile à faire évoluer plus tard vers PostgreSQL ou Supabase.

---

## 3. Données à stocker

### Table `users`
- id
- nom
- email
- mot_de_passe_hash
- date_creation

### Table `progress`
- id
- user_id
- categorie (`addition`, `soustraction`, `matrices`, etc.)
- niveau
- score
- meilleur_score
- temps_moyen
- date_maj

### Table `sessions`
- id
- user_id
- jeu
- score
- duree
- date_partie

### Table `badges` (optionnel)
- id
- user_id
- badge_name
- obtenu_le

---

## 4. Parcours utilisateur
1. l'utilisateur arrive sur la page d'accueil ;
2. il crée un compte ou se connecte ;
3. il choisit un type de jeu ;
4. il joue ;
5. son score et sa progression sont sauvegardés ;
6. il retrouve plus tard son tableau de bord.

---

## 5. Première version recommandée

### Écrans à développer en priorité
- `Accueil`
- `Connexion`
- `Inscription`
- `Dashboard`
- `Jeu de calcul mental`
- `Résultats`

### Jeux à lancer en premier
- addition / soustraction rapide ;
- multiplication ;
- quiz chronométré.

---

## 6. Design recommandé
Pour que le site soit beau dès le départ :
- fond clair ou sombre moderne ;
- cartes arrondies ;
- couleurs douces mais contrastées ;
- boutons larges pour mobile ;
- typographie simple et lisible ;
- petites animations au survol.

---

## 7. Roadmap de développement

### Étape A — Initialisation
- créer le projet `React + Vite`
- installer `Tailwind CSS`
- préparer la structure des pages

### Étape B — Base de l'application
- créer le layout principal
- ajouter la navigation
- rendre le site responsive

### Étape C — Authentification locale
- API Express
- base SQLite
- inscription / connexion
- session utilisateur

### Étape D — Progression
- enregistrer scores et niveaux
- afficher les statistiques sur le dashboard

### Étape E — Jeux
- créer les premiers mini-jeux
- valider les réponses
- calculer score, précision et temps

### Étape F — Extensions avancées
- matrices
- dérivées
- intégrales
- badges et défis

---

## 8. Choix conseillé maintenant
La meilleure prochaine étape est de **générer le projet de base** avec :
- `React + Vite + TypeScript`
- `Tailwind CSS`
- pages `Accueil`, `Connexion`, `Dashboard`
- architecture prête pour `SQLite`

---

## 9. Suite
Je peux maintenant passer à la réalisation concrète :

1. **scaffold complet du projet React + Vite** ;
2. création de l'interface moderne ;
3. préparation de la connexion utilisateur ;
4. ajout du premier jeu mathématique.
