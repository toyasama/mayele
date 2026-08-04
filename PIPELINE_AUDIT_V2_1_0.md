# Audit de la pipeline depuis `v2.1.0`

Date de l'audit : 4 août 2026

Périmètre Git : `v2.1.0..168e466`

Workflow : `.github/workflows/production-readiness.yml`

## Résultat synthétique

- 35 commits ont été examinés.
- 37 exécutions du workflow correspondent à ces commits : 28 échecs et 9 succès, soit 24,3 % de succès.
- Les 28 échecs se répartissent ainsi : 16 E2E, 5 étape Railway, 3 audits npm, 1 syntaxe de workflow, 1 scan de code, 1 vérification Prisma post-déploiement et 1 configuration Vercel.
- Les six déploiements Railway échoués du 29 juillet ont tous construit une image valide. Le processus applicatif a ensuite redémarré sur une configuration invalide. Le retry ajouté par `0165bde` a donc répété un défaut déterministe trois fois.
- Le 3 août, Railway a déployé une version saine, mais le job a expiré parce que le CLI n'arrivait pas à streamer les logs Metal. Le commit `168e466` a correctement séparé l'envoi du code du suivi du déploiement.

## Chronologie complète

| Commit | Run | Résultat observé et relation avec le commit suivant |
|---|---|---|
| `72508fc` | [#2](https://github.com/toyasama/mayele/actions/runs/29194263054) | Échec E2E. Le changement corrige bien l'ordre migration/contrainte Railway, mais le frontend E2E s'arrête faute de clé Clerk et provoque ensuite des refus de connexion. |
| `8a00600` | [#3](https://github.com/toyasama/mayele/actions/runs/29206424699) | Même défaut E2E Clerk ; la correction de configuration realtime production n'est pas en cause. |
| `59b18e9` | [#4](https://github.com/toyasama/mayele/actions/runs/29206854163) | Même défaut E2E Clerk ; l'amélioration des acquittements realtime n'est pas la cause du run rouge. |
| `2f93063` | [#5](https://github.com/toyasama/mayele/actions/runs/29454797541) | Le workflow ne crée aucun job : une variable globale `E2E_DATABASE_URL` est réutilisée via le contexte `env` dans les `env` de jobs, expression refusée par GitHub. |
| `385ed63` | — | Suppression de documentation, sans run autonome (push groupé avec le commit suivant). |
| `a1c9d57` | [#6](https://github.com/toyasama/mayele/actions/runs/29455029725) | La syntaxe du workflow est réparée. Les deux suites E2E échouent désormais sur une application non authentifiée/non initialisée. |
| `c4aca6c` | [#7](https://github.com/toyasama/mayele/actions/runs/29456263118) | Le client ne dépend plus de Clerk en mode E2E, mais le middleware serveur et le runtime de test ne sont pas encore correctement isolés. |
| `4ed4bda` | [#8](https://github.com/toyasama/mayele/actions/runs/29475968331) | Le middleware Clerk est contourné ; 10 tests responsive passent, mais deux fixtures manquent et 16 scénarios métier restent rouges. |
| `3e03194` | [#9](https://github.com/toyasama/mayele/actions/runs/29477817422) | L'environnement E2E est isolé ; les mêmes échecs de fixtures et d'état multiplayer restent visibles. |
| `469549b` | [#10](https://github.com/toyasama/mayele/actions/runs/29480421012) | Le bundle E2E devient déterministe ; le serveur d'une suite ne démarre pas et deux scénarios responsive ne trouvent toujours pas leurs données. |
| `b263c6d` | [#11](https://github.com/toyasama/mayele/actions/runs/29483450586) | Le démarrage realtime est stabilisé ; il reste deux fixtures responsive et treize scénarios solo sans données initiales. |
| `944f7ac` | [#12](https://github.com/toyasama/mayele/actions/runs/29483992645) | Les fixtures responsive sont corrigées ; les treize échecs solo demeurent. |
| `2aaf37c` | [#13](https://github.com/toyasama/mayele/actions/runs/29485380954) | Succès après initialisation des fixtures solo. Cette séquence montre une cause de conception des tests, pas une instabilité de GitHub Actions. |
| `2e1a1e0` | [#14](https://github.com/toyasama/mayele/actions/runs/29488895597) | Succès. |
| `a2adc92` | [#15](https://github.com/toyasama/mayele/actions/runs/29519932121) | Deux échecs E2E : latence mesurée à 198 ms pour un budget strict de 150 ms, et propagation de présence non observée. |
| `3c8ab73` | [#16](https://github.com/toyasama/mayele/actions/runs/29522422697) | Succès après synchronisation autoritative de la présence. |
| `c6e440c` | [#17](https://github.com/toyasama/mayele/actions/runs/29537726196) | Succès. |
| `d838757` | [#18](https://github.com/toyasama/mayele/actions/runs/30400315721) | Le scan ad hoc interdit `console.log`, alors que trois nouveaux tests de performance l'utilisent intentionnellement. |
| `5d44b9b` | [#19](https://github.com/toyasama/mayele/actions/runs/30401009845) | Le scan est réparé par des pièces jointes Playwright ; l'audit serveur détecte ensuite 4 vulnérabilités modérées et 3 élevées. |
| `b169fe2` | [#20](https://github.com/toyasama/mayele/actions/runs/30401571302) | Les dépendances sont mises à jour et l'audit client documente une exception. Deux défauts fonctionnels E2E et un défaut CSS responsive restent présents. |
| `93f7ef0` | [#22](https://github.com/toyasama/mayele/actions/runs/30433509989) | Les défauts UI sont corrigés ; un test compte encore une requête REST de bootstrap comme une régression realtime. |
| `f83f6bb` | [#23](https://github.com/toyasama/mayele/actions/runs/30436003836) | Les tests passent. Railway construit l'image, puis le démarrage échoue : `SENTRY_DSN` est absent et `CORS_ORIGINS` est rejeté. |
| `0165bde` | [#24](https://github.com/toyasama/mayele/actions/runs/30437591949) | Trois déploiements sont lancés pour la même erreur de configuration. Le texte `service unavailable` du healthcheck a été interprété à tort comme une panne transitoire Railway. |
| `e2e2af4` | [#25](https://github.com/toyasama/mayele/actions/runs/30439360619) | Les retries sont retirés et les logs révèlent enfin la cause exacte : `SENTRY_DSN` et `CORS_ORIGINS`. |
| `1fd82f5` | [#26](https://github.com/toyasama/mayele/actions/runs/30442228141) | Sentry devient correctement optionnel ; `CORS_ORIGINS` reste l'unique cause du crash. |
| `99cce82` | [#27](https://github.com/toyasama/mayele/actions/runs/30443195647) | Railway déploie l'API. La vérification suivante échoue localement car le client Prisma généré manque dans le runner. |
| `d612c12` | [#28](https://github.com/toyasama/mayele/actions/runs/30443812464) | Prisma est généré ; deux E2E échouent avant le déploiement : 157 ms pour un budget de 150 ms et ordre concurrent des événements outbox. |
| `97d5de3` | [#29](https://github.com/toyasama/mayele/actions/runs/30444295465) | Le budget realtime passe à 175 ms ; l'assertion outbox reste dépendante d'un ordre non garanti. |
| `b8e9d62` | [#30](https://github.com/toyasama/mayele/actions/runs/30444837599) | L'outbox est corrigée. L'API est déployée, puis Vercel est bloqué parce que le validateur exige encore `VITE_SENTRY_DSN`. |
| `b81443b` | [#31](https://github.com/toyasama/mayele/actions/runs/30450893581) | Succès après alignement du caractère optionnel de Sentry côté frontend. |
| `eb76559` | [#32 develop](https://github.com/toyasama/mayele/actions/runs/30848409864) | L'audit serveur bloque sur Socket.IO et `fast-uri`. |
| `636c64d` | [#33 develop](https://github.com/toyasama/mayele/actions/runs/30848758969), [#34 main](https://github.com/toyasama/mayele/actions/runs/30849368291) | L'audit est réparé. Le run develop passe ; le run main révèle une course réelle dans le retry concurrent Solo (état canonique périmé). |
| `eb20fb3` | [#35 develop](https://github.com/toyasama/mayele/actions/runs/30851167639) | La course Solo est corrigée ; un nouvel avis `ip-address` bloque l'audit. |
| `a021bee` | [#36 develop](https://github.com/toyasama/mayele/actions/runs/30851487988), [#37 main](https://github.com/toyasama/mayele/actions/runs/30851990715) | L'audit est réparé. Railway rend le nouveau déploiement sain, mais le CLI échoue à récupérer le flux de build et le job expire. |
| `168e466` | [#38 develop](https://github.com/toyasama/mayele/actions/runs/30854434152), [#39 main](https://github.com/toyasama/mayele/actions/runs/30854961518) | Deux succès. L'upload détaché et le polling par identifiant exact corrigent le faux échec lié au streaming. |

## Diagnostic du nœud de déploiement

Les déploiements Railway `c220c14e`, `de19aa45`, `1468ee37`, `6899d413`, `1113c79b` et `e93c1bcd` ont tous :

1. installé, généré Prisma et compilé TypeScript sans erreur ;
2. produit et poussé une image OCI ;
3. échoué pendant le healthcheck, car le processus Node quittait sur la validation d'environnement ;
4. réexécuté `prisma migrate deploy` et `db:check-domain` à chaque redémarrage de conteneur.

Avec une tentative initiale et cinq retries de processus, la même migration idempotente a pu être relancée environ 36 fois sur ces six déploiements. Le retry CI de `0165bde` ajoutait encore des déploiements complets au lieu de corriger la configuration.

Le déploiement `72b0b4f6` du run #37 a, lui, passé le healthcheck à la deuxième tentative. Son échec GitHub est uniquement dû au streaming du CLI. Le déploiement `5ce832a2` du run #39 utilise la même image et a réussi avec le polling détaché.

## Changements appliqués par cet audit

- `railway.json` utilise le schéma actuel, des valeurs d'enum valides, un timeout explicite et surtout `preDeployCommand` pour les migrations et contraintes. Railway exécute cette phase une seule fois, avant de mettre le nouveau conteneur en service ; un échec arrête le déploiement sans retry ([documentation Railway](https://docs.railway.com/deployments/pre-deploy-command)).
- Le `CMD` Docker ne lance plus de migrations via un shell : il démarre directement Node. Les signaux Railway atteignent donc correctement le serveur Express et son arrêt gracieux.
- Le job de qualité construit puis démarre l'image de production contre PostgreSQL avant d'autoriser un déploiement.
- Les variables Railway sont validées via le même code TypeScript que le démarrage de production, avant l'upload. Les variables Vercel sont également téléchargées et validées avant de modifier le backend.
- Le déploiement Railway reste détaché, suit l'identifiant exact retourné et inscrit l'identifiant/commit dans le résumé GitHub. La CLI Railway documente explicitement ce modèle `--detach` + polling ([documentation CLI](https://docs.railway.com/cli/up)).
- Les migrations ne font plus partie du restart path. Le healthcheck `/api/ready` conserve la vérification PostgreSQL, realtime et workers ; Railway ne bascule le trafic qu'après un HTTP 200 ([healthchecks Railway](https://docs.railway.com/deployments/healthchecks)).
- Playwright effectue un retry unique en CI. Le réglage `trace: on-first-retry`, jusque-là inactif faute de retry, produit maintenant une trace utile sur les intermittences sans transformer une erreur répétable en succès silencieux.
- Un workflow `actionlint` séparé détecte une syntaxe GitHub Actions invalide même si le workflow principal ne peut créer aucun job.
- Les actions et l'image Node sont figées par SHA/digest. GitHub indique qu'un SHA complet est la seule référence immuable pour une action ([guide de sécurisation](https://docs.github.com/en/actions/reference/security/secure-use)).
- Dependabot surveille npm, GitHub Actions et Docker chaque semaine. Les avis de sécurité sont ainsi traités en PR au lieu d'être découverts au moment d'une mise en production.
- Le smoke de production vérifie désormais que Clerk initialise réellement le formulaire de connexion. Les tests métier restent isolés de Clerk ; les tests Clerk complets devront utiliser `@clerk/testing`, une instance de développement et des testing tokens dans une suite séparée ([guide Clerk Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview)).
- Vercel Analytics n'est plus injecté dans les bundles E2E. Les navigateurs WebKit ne dépendent donc plus de la disponibilité ou des règles HTTP d'un script analytics externe ; le composant reste actif dans le bundle `production`.

## Limite d'architecture Railway actuelle

Railway recommande au moins deux replicas pour la disponibilité ([checklist de production](https://docs.railway.com/overview/production-readiness-checklist)). Mayele ne doit pas activer ce réglage immédiatement : le registre Socket.IO est local au processus et chaque démarrage appelle `markAllPlayersOffline()`. Deux replicas pourraient donc se contredire sur la présence et perdre des événements ciblés. Il faut d'abord ajouter un adapter Socket.IO partagé (par exemple Redis) et déplacer la présence vers un stockage/lease partagé.

## Contrôle GitHub restant

L'API GitHub indique que la branche `main` n'est actuellement pas protégée. Après intégration de ces fichiers, il faut activer une règle exigeant une pull request et les checks `Workflow syntax`, `Quality and build`, `E2E multiplayer and solo` et `Responsive and Safari E2E` avant merge. Cette règle est volontairement laissée à appliquer après le premier run des nouveaux checks : GitHub doit d'abord les avoir enregistrés, et son activation modifie directement les droits de merge du dépôt.
