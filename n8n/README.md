# n8n — déploiement local

Instance n8n self-hosted, en local uniquement (`127.0.0.1`), gratuite.
WF3 et WF4 sont fournis inactifs dans `workflows/`; WF1–WF2 restent à intégrer. Ce
dossier contient aussi l'infrastructure n8n et le bridge blockchain HTTP
interne sécurisé, qui héberge le store persistant des cycles de vie WF3.

**n8n tourne dans un conteneur Docker et ne voit pas le système de
fichiers de l'hôte.** Il n'a donc aucun accès direct à `scripts/` ni à
`contracts/`. L'accès aux scripts blockchain (`check.js`, `report.js`) se
fait via le service `chain-bridge`, appelé par n8n en HTTP sur le réseau
Compose — jamais par interpolation dans un shell ou montage des scripts
dans le conteneur n8n.

Le bridge n'expose aucun port sur l'hôte. Il valide un schéma JSON fermé,
exige un bearer token, puis lance les scripts avec `spawn`, `shell: false`
et des arguments séparés. Seule la clé Reporter est injectée dans ce
conteneur ; la clé Owner doit en rester strictement absente.

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

## 1. Générer les secrets locaux (une seule fois)

`N8N_ENCRYPTION_KEY` chiffre les credentials stockés par n8n (ex. la
future connexion au bridge). **Ne la régénère jamais après le premier
démarrage** : tous les credentials déjà enregistrés deviendraient
illisibles.

Générer d'abord la clé de chiffrement n8n avec Node.js :

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

Générer ensuite un secret distinct pour authentifier les appels n8n vers
le bridge :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Renseigner également dans `n8n/.env` :

```env
CHAIN_BRIDGE_TOKEN=<deuxième valeur générée, distincte>
AMOY_RPC_URL=https://polygon-amoy.drpc.org
REGISTRY_CONTRACT_ADDRESS=0x8d51dB4a92c338075360A17AcA005ec282fE1f23
REGISTRY_DEPLOYMENT_BLOCK=43090902
REPORTER_PRIVATE_KEY=<clé Reporter testnet uniquement>
```

Ne jamais ajouter `OWNER_PRIVATE_KEY` dans `n8n/.env`. Dans l'interface
n8n, créer un credential **Header Auth** avec le header `Authorization`
et la valeur `Bearer <CHAIN_BRIDGE_TOKEN>`. Les workflows référencent ce
credential sans exporter sa valeur.

`n8n/.env` est ignoré par Git (couvert par la règle `.env` du
`.gitignore` racine) et **distinct** du `.env` racine (blockchain/LLM/
Discord) : Docker Compose le charge automatiquement car il se trouve à
côté de `docker-compose.yml`, sans option supplémentaire.

## 2. Démarrer

Depuis ce dossier (`n8n/`) :

```bash
docker compose up -d
```

Si `n8n/.env` est absent ou qu'une variable obligatoire est vide, la
commande **échoue immédiatement** avec le message `manquante - voir
n8n/README.md`, plutôt que de démarrer avec une configuration incomplète.

## 3. Vérifier

- `docker compose ps` → `chain-bridge` doit être `healthy` et `n8n` doit
  être `Up`.
- Ouvrir http://127.0.0.1:5678 dans un navigateur → **au tout premier
  démarrage**, n8n affiche l'écran de création du compte propriétaire
  (email + mot de passe) ; aux démarrages suivants, un écran de connexion
  avec ce compte.
- Vérifier que http://0.0.0.0:5678 ou l'IP locale de la machine (ex.
  `http://192.168.x.x:5678`) **ne répond pas** depuis un autre appareil du
  réseau — seul `127.0.0.1` doit être joignable.
- Vérifier que http://127.0.0.1:3001 **ne répond pas** : le bridge n'a
  aucun port publié et n'est joignable que par les services Compose.

## 4. Consulter les logs

```bash
docker compose logs -f n8n
```

## 5. Arrêter

```bash
docker compose down
```

Les volumes nommés `anti_phishing_n8n_data` et
`anti_phishing_chain_bridge_state` ne sont pas supprimés par `down` : les
workflows, credentials et cycles de vie WF3 persistent. Pour tout effacer
(rare, ex. réinitialisation complète) : `docker compose down -v` —
**irréversible**, à utiliser en connaissance de cause. Supprimer le second
volume efface notamment les claims Discord et rend impossible leur audit.

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

## 7. Importer et configurer WF4 `/check`

Le fichier `workflows/WF4-check.json` expose le endpoint public demandé :

```text
GET /webhook/check?type=url&value=https%3A%2F%2Fsafe-example.invalid
```

Importer le fichier depuis l'interface n8n ou avec la CLI, puis ouvrir le
nœud **Call Internal Chain Bridge** et sélectionner le credential Header
Auth créé à la section 1. Le placeholder d'identifiant présent dans le
JSON n'est pas un secret et doit être remplacé par ce credential local
avant activation.

Le workflow est volontairement importé avec `active: false`. Avant de
l'activer :

1. vérifier que `chain-bridge` est `healthy` ;
2. sélectionner `Chain Bridge Header Auth` ;
3. tester une URL réservée `.invalid` ;
4. contrôler que la réponse publique ne contient ni `urlHash`, ni
   `normalizedValue`, ni `reporter`, ni `active` ;
5. seulement ensuite activer le workflow.

WF4 ne fait aucun appel IA et aucune transaction. Il effectue uniquement
une lecture publique du registre Polygon Amoy.

## 8. Contrat d'erreur blockchain pour WF3 (RF-N12)

Le bridge ne transmet jamais le message brut du provider RPC. Un échec
blockchain retourne un message générique et trois champs contrôlés :

```json
{
  "error": {
    "code": "CHAIN_TIMEOUT",
    "message": "Blockchain operation failed.",
    "retryable": true,
    "recheckRequired": true
  }
}
```

Seuls les codes suivants sont retryables :

| Codes                   | `retryable` | Signification                                                                                                        |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `CHAIN_TIMEOUT`         | `true`      | Timeout RPC ou du processus borné                                                                                    |
| `CHAIN_NETWORK_ERROR`   | `true`      | Erreur réseau/RPC transitoire                                                                                        |
| `CHAIN_RATE_LIMITED`    | `true`      | Réponse RPC 429                                                                                                      |
| `CHAIN_RPC_UNAVAILABLE` | `true`      | Réponse RPC 5xx ou serveur indisponible                                                                              |
| Tous les autres codes   | `false`     | Validation, authentification, revert, fonds insuffisants, conflit de transaction, sortie invalide ou erreur inconnue |

Pour une action `report`, toute erreur retryable porte aussi
`recheckRequired: true`, car le résultat de la publication peut être
incertain. WF3 devra alors :

1. appeler `/internal/check` avant une nouvelle publication ;
2. si l'entrée est active, la traiter comme `already_blacklisted` sans
   nouvelle transaction ;
3. sinon, appliquer un backoff exponentiel avec jitter ;
4. limiter l'ensemble à trois tentatives maximum ;
5. ne jamais retry une erreur avec `retryable: false` ;
6. ne produire l'alerte Discord finale qu'après un résultat blockchain
   confirmé.

La politique est dérivée d'une liste fermée dans le bridge. Une valeur
`retryable` fournie ou falsifiée par un sous-processus n'est jamais crue
directement.

Le planificateur pur `lib/wf3Retry.js` applique cette politique avant la
création de WF3 :

- trois tentatives maximum, numérotées de 1 à 3 ;
- délai exponentiel de base : environ 1 s avant la tentative 2, puis 2 s
  avant la tentative 3 ;
- jitter borné à ±25 % pour éviter des retries simultanés ;
- aucune quatrième tentative ;
- une erreur permanente produit immédiatement `fail` ;
- une erreur transitoire de lecture produit `retry` s'il reste une
  tentative ;
- une erreur transitoire de publication produit toujours `recheck`, y
  compris après la troisième tentative ;
- un recheck actif produit `complete_existing` sans nouvelle transaction ;
- un recheck inactif produit `retry` s'il reste une tentative, sinon
  `fail` avec `attempts_exhausted`.

Le délai et le jitter sont injectables dans les tests, ce qui permet de
valider le comportement entièrement hors ligne sans attente réelle.

## 9. Cycle de vie et unicité de l'alerte finale (RF-N10)

Le contrat pur `lib/wf3Lifecycle.js` limite chaque signalement aux statuts
contractuels suivants :

```text
queued → analyzing → reporting → reported
                            └──→ already_blacklisted
          ├──→ manual_review
          ├──→ analyzing + decision=log_only + finalized=true
          └──→ failed
```

Les invariants principaux sont :

- chaque enregistrement possède un `reportId`, un numéro de `revision` et
  des timestamps ISO ;
- toute transition vérifie la révision attendue et refuse un état périmé ;
- `reported` et `already_blacklisted` exigent un tx hash confirmé ;
- `failed` ne conserve qu'un code machine borné, jamais un message brut du
  provider ;
- `log_only` ne crée aucune alerte ;
- les résultats blockchain, la revue manuelle et l'échec final créent au
  plus une alerte finale en attente ;
- les objets persistés sont validés par un schéma fermé et immuable.

Le bridge initialise une base SQLite dans le volume nommé
`anti_phishing_chain_bridge_state`. Le reste de son système de fichiers
reste en lecture seule. La table conserve le JSON complet validé et une
colonne `revision` indépendante ; toute lecture vérifie leur cohérence afin
de détecter une corruption ou une modification hors protocole.

Le store utilise `node:sqlite`, disponible dans la version Node 22.14.0
épinglée par l'image du bridge et déclarée dans le `package.json` racine.
Node 22 affiche encore un avertissement expérimental pour cette API ; il
n'est pas masqué, et toute montée de version devra repasser les tests de
concurrence et de redémarrage avant modification de l'image.

Trois routes internes, protégées par le même credential Header Auth que les
opérations blockchain, sont disponibles :

| Route                             | Corps exact                                       | Résultat                                                         |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /internal/lifecycle/create` | `{ "reportId": "..." }`                           | crée uniquement une révision 0 `queued` ; doublon : HTTP 409     |
| `POST /internal/lifecycle/read`   | `{ "reportId": "..." }`                           | retourne l'état validé courant ; absent : HTTP 404               |
| `POST /internal/lifecycle/cas`    | `{ "reportId", "expectedRevision", "lifecycle" }` | persiste uniquement le successeur canonique ; conflit : HTTP 409 |

Le CAS est une unique mise à jour SQL conditionnelle sur `reportId` et
`revision`. Il refuse les sauts de statut même si l'objet proposé respecte
le schéma final. La répétition exacte d'une écriture déjà appliquée retourne
`applied: false` sans incrément supplémentaire ; une écriture concurrente
différente retourne un conflit et impose une nouvelle lecture.

Une indisponibilité du store retourne HTTP 503 avec
`LIFECYCLE_STORE_UNAVAILABLE`. Après une erreur d'écriture incertaine,
l'appelant doit relire l'état avant toute nouvelle tentative. Le endpoint
`/health` vérifie également que la base répond.

L'envoi Discord utilise un protocole de claim en deux étapes :

1. calculer un candidat `claimed` à partir de la révision courante ;
2. le persister par **compare-and-swap atomique** sur `(reportId, revision)` ;
3. relire le claim gagnant et vérifier qu'il appartient à l'exécution ;
4. seulement alors appeler Discord ;
5. enregistrer `sent`, `closed_failed` ou `closed_uncertain`.

Un candidat de claim n'autorise donc jamais à lui seul l'appel HTTP. Deux
exécutions concurrentes peuvent calculer un candidat, mais le store
persistant n'en accepte qu'un. Une exécution perdante ne doit pas appeler
Discord.

Discord ne fournit pas de clé d'idempotence : une garantie « exactement
une fois » est impossible si le processus tombe après réception par
Discord mais avant sauvegarde locale. Pour privilégier l'absence de
doublon exigée par RF-N10, un résultat d'envoi incertain est fermé et ne
fait pas l'objet d'un renvoi automatique. Il reste visible pour audit et
traitement manuel. WF3 utilise ces routes et autorise Discord uniquement
après relecture du claim persistant gagnant ; il reste néanmoins inactif
jusqu'à la configuration locale des credentials et aux tests contrôlés.

## 10. Construction sûre de l'alerte Discord

Le module pur `lib/wf3Discord.js` construit le corps JSON de l'alerte sans
contenir ni appeler un webhook. Son entrée est fermée et comporte uniquement
le cycle de vie persistant relu, le claim gagnant exact et le contexte WF3
validé. Il refuse notamment :

- un cycle qui n'est pas finalisé et `claimed` ;
- un claim différent de celui persisté ;
- un `reportId` différent entre le contexte et le cycle de vie ;
- un résultat IA incompatible avec la décision persistée ;
- tout champ inattendu, y compris une URL de webhook.

La sortie sépare le routage du corps Discord :

- `channel: "alerts"` pour `reported` et `already_blacklisted` ;
- `channel: "manual_review"` pour une revue manuelle ou un échec final ;
- `discord` contient uniquement le JSON à transmettre au credential local
  correspondant.

Le formatter applique les protections suivantes :

- URL affichée avec schéma `hxxp`/`hxxps` et points défangés ;
- domaines, adresses IP et URL imbriqués dans les indicateurs également
  défangés ;
- mentions Discord désactivées par `allowed_mentions` et caractères de
  mention/Markdown neutralisés dans les valeurs non fiables ;
- trois indicateurs maximum et limites Discord appliquées aux champs ainsi
  qu'à l'embed complet ;
- aucun lien contrôlé par l'utilisateur ; le seul lien cliquable possible
  est le lien PolygonScan Amoy construit depuis un tx hash validé ;
- absence explicite de transaction et de publication confirmée pour la revue
  manuelle et les échecs du pipeline ;
- code technique sûr uniquement pour un échec, jamais le message du provider.

Le workflow relit le cycle après le CAS du claim, appelle
`authorizeFinalAlertDispatch()` implicitement via ce builder, puis seulement
transmet `discord` au webhook chiffré sélectionné par `channel`. La
construction du payload ne remplace donc pas le protocole d'idempotence de la
section précédente.

## 11. Importer et configurer WF3

Le fichier `workflows/WF3-action.json` est un sous-workflow interne, sans
webhook public. WF2 doit l'appeler avec exactement les sept champs validés
suivants :

```json
{
  "reportId": "r_20260801_example",
  "type": "url",
  "value": "https://analysis-example.invalid/claim",
  "verdict": "malicious",
  "category": "fake_airdrop",
  "scoreFinal": 0.91,
  "indicators": ["Synthetic wallet prompt"]
}
```

Le workflow ne contient ni clé privée, ni bearer token, ni URL de webhook
Discord. Avant toute activation, importer le JSON puis sélectionner localement
trois credentials chiffrés :

1. `Chain Bridge Header Auth` sur les trois nœuds HTTP internes ;
2. `Discord Alerts Webhook` sur le canal des confirmations blockchain ;
3. `Discord Manual Review Webhook` sur le canal de revue et d'échec.

Le bridge expose trois adaptateurs WF3 protégés par Header Auth :

| Route                        | Rôle                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/wf3/execute` | valide le contexte et l'`executionId` ajouté par n8n, lie les deux au `reportId`, applique le cycle persistant, puis exécute report/recheck/retry si nécessaire |
| `POST /internal/wf3/claim`   | tente le CAS du claim, relit l'état gagnant et ne retourne le payload Discord qu'au seul appel ayant réellement appliqué le claim                               |
| `POST /internal/wf3/settle`  | ferme le claim avec `sent`, `failed` ou `uncertain` sans permettre de réécriture ultérieure                                                                     |

L'empreinte SHA-256 du contexte validé est persistée séparément dans SQLite.
Une réutilisation du même `reportId` avec une cible, un verdict, un score ou
des indicateurs différents retourne `WF3_CONTEXT_CONFLICT`. Le contenu brut
n'est pas dupliqué dans cette table.

Le nœud d'exécution ajoute aussi `executionId = "n8n-" + $execution.id` sans
modifier l'empreinte du contexte métier. Tant que la transaction ou l'alerte
finale reste ouverte, SQLite lie le `reportId` à cet identifiant. La même
exécution peut donc reprendre après un redémarrage du bridge, tandis qu'une
autre exécution reçoit `WF3_EXECUTION_CONFLICT`. Une fois le cycle et son
alerte fermés, une lecture terminale idempotente reste sans effet externe.

Le graphe importé applique l'ordre suivant :

```text
appel interne WF2
→ execute WF3 sécurisé
→ fusion explicite du contexte et du résultat execute
→ si aucune alerte : fin
→ claim persistant
→ si claim perdant/rejoué : fin
→ routage alerts ou manual_review
→ envoi via credential Discord chiffré
→ fusion explicite du claim gagnant et du résultat Discord
→ settlement sent ou uncertain
```

Le nœud Discord continue sur sa sortie normale en cas d'erreur contrôlée afin
que le claim soit fermé `uncertain`. `sent` exige une réponse Discord contenant
un identifiant de message numérique valide ; une réponse vide, erronée ou
ambiguë devient `uncertain`. Aucun renvoi automatique n'est effectué.
Si n8n tombe après réception du message par Discord mais avant le settlement,
le claim reste `claimed` et tout replay est refusé : cela privilégie l'absence
de doublon, sans prétendre garantir un exactly-once impossible avec les
webhooks Discord.

Le workflow est volontairement importé avec `active: false`. Avant de le
connecter à WF2 :

1. utiliser l'image n8n épinglée `2.32.7` ;
2. reconstruire le bridge et vérifier `/health` ;
3. remplacer les trois placeholders de credentials ;
4. tester d'abord `legitimate`, `suspicious` et `malicious` avec des domaines
   réservés `.invalid` et des dépendances simulées ;
5. vérifier qu'un replay du même `reportId` ne crée ni transaction ni seconde
   alerte ;
6. seulement ensuite planifier un test contrôlé Polygon Amoy et Discord.
