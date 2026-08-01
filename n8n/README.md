# n8n — déploiement local

Instance n8n self-hosted, en local uniquement (`127.0.0.1`), gratuite.
Aucun workflow n'est encore défini : ce dossier ne contient que
l'infrastructure (Phase 0 du plan Profil B — RF-S4, DP-7).

**n8n tourne dans un conteneur Docker et ne voit pas le système de
fichiers de l'hôte.** Il n'a donc aucun accès direct à `scripts/` ni à
`contracts/`. L'accès aux scripts blockchain (`check.js`, `report.js`) se
fera plus tard via le **bridge HTTP interne (DP-2)**, un service séparé
appelé par n8n en HTTP — pas par un montage de volume vers `scripts/`.

## Protection de l'instance (RF-S4)

n8n a supprimé la basic auth (`N8N_BASIC_AUTH_ACTIVE` et les variables
associées) depuis la version 1.0, avec le passage à l'authentification
JWT native. Ces variables sont **ignorées silencieusement** par les
versions actuelles — elles ne figurent donc pas dans ce déploiement.

La protection de l'instance repose sur deux mécanismes cumulés :

1. **Le user management natif de n8n** : au tout premier accès à
   http://127.0.0.1:5678, n8n affiche un écran de création du **compte
   propriétaire** (email + mot de passe). Sans ce compte, aucun accès à
   l'éditeur, aux workflows ni aux credentials n'est possible. Ce n'est pas
   une option désactivable côté n8n.
2. **La liaison du port sur `127.0.0.1` uniquement** (voir
   `docker-compose.yml`) : l'instance n'est joignable que depuis la
   machine elle-même, jamais depuis le réseau local ou Internet.

RF-S4 (« n8n derrière une authentification, instance non exposée
publiquement ») reste donc satisfaite, mais par le compte propriétaire du
user management + le binding `127.0.0.1`, pas par une basic auth.

## 1. Générer la clé de chiffrement (une seule fois)

`N8N_ENCRYPTION_KEY` chiffre les credentials stockés par n8n (ex. la
future connexion au bridge). **Ne la régénère jamais après le premier
démarrage** : tous les credentials déjà enregistrés deviendraient
illisibles.

Avec Node.js (déjà requis pour ce projet) :

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Copier :

```bash
cp n8n/.env.example n8n/.env
```

puis coller la valeur générée dans `n8n/.env` :

```env
N8N_ENCRYPTION_KEY=<valeur générée>
```

`n8n/.env` est ignoré par Git (couvert par la règle `.env` du
`.gitignore` racine) et **distinct** du `.env` racine (blockchain/LLM/
Discord) : Docker Compose le charge automatiquement car il se trouve à
côté de `docker-compose.yml`, sans option supplémentaire.

## 2. Démarrer

Depuis ce dossier (`n8n/`) :

```bash
docker compose up -d
```

Si `n8n/.env` est absent ou que `N8N_ENCRYPTION_KEY` y est vide, la
commande **échoue immédiatement** avec le message `manquante - voir
n8n/README.md`, plutôt que de démarrer avec une clé aléatoire non
sauvegardée.

## 3. Vérifier

- `docker compose ps` → le service `n8n` doit être `Up`.
- Ouvrir http://127.0.0.1:5678 dans un navigateur → **au tout premier
  démarrage**, n8n affiche l'écran de création du compte propriétaire
  (email + mot de passe) ; aux démarrages suivants, un écran de connexion
  avec ce compte.
- Vérifier que http://0.0.0.0:5678 ou l'IP locale de la machine (ex.
  `http://192.168.x.x:5678`) **ne répond pas** depuis un autre appareil du
  réseau — seul `127.0.0.1` doit être joignable.

## 4. Consulter les logs

```bash
docker compose logs -f n8n
```

## 5. Arrêter

```bash
docker compose down
```

Le volume nommé `anti_phishing_n8n_data` n'est pas supprimé par `down` :
les workflows et credentials persistent. Pour tout effacer (rare, ex.
réinitialisation complète) : `docker compose down -v` —
**irréversible**, à utiliser en connaissance de cause.

## 6. Exporter les workflows en JSON (pour les versionner)

Une fois des workflows créés dans l'éditeur n8n :

```bash
docker compose exec n8n n8n export:workflow --all --output=/export/workflows.json
```

Le fichier apparaît directement sur l'hôte dans `n8n/workflows/`
(monté sur `/export`), prêt à être commité.

**Les credentials ne sont jamais exportés ni versionnés** : ils restent
uniquement dans le volume interne `anti_phishing_n8n_data`, chiffrés avec
`N8N_ENCRYPTION_KEY`.
