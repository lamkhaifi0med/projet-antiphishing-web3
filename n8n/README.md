# n8n - déploiement local, WF1-WF4

Instance n8n self-hosted, liée à `127.0.0.1` uniquement, gratuite. Ce
dossier contient l'infrastructure n8n complète :

- `workflows/WF1_Ingestion.json` : webhook `POST /report`, validation,
  rate limiting, déduplication on-chain et journalisation ;
- `workflows/WF1_Form.json` : formulaire public qui réutilise le même
  webhook ;
- `workflows/WF2_Analyse.json` : capture HTML protégée SSRF, features URL,
  analyse LLM (Gemini + fallback NVIDIA) et score final ;
- `workflows/WF3-action.json` : sous-workflow interne de publication
  blockchain et d'alerte Discord ;
- `workflows/WF4-check.json` : endpoint public `GET /check` de lecture du
  registre.

La stack épingle n8n `2.31.6` — version testée pour les imports WF1/WF2 ;
les imports WF3/WF4 (précédemment testés sur `2.32.7`) doivent être
revalidés après ce changement.

**n8n tourne dans un conteneur Docker et ne voit pas le système de
fichiers de l'hôte.** Il n'a donc aucun accès direct à `scripts/` ni à
`contracts/`. Deux bridges HTTP séparés font l'intermédiaire :

- `n8n/bridge/` (WF1/WF2) : normalisation commune, lance `scripts/check.js`
  avec `execFile`, `shell: false` et des arguments séparés ;
- `n8n/services/chain-bridge/` (WF3) : valide un schéma JSON fermé, exige
  un bearer token, puis lance les scripts blockchain avec `spawn`,
  `shell: false` et des arguments séparés. Seule la clé Reporter y est
  injectée ; la clé Owner doit en rester strictement absente.

Aucun des deux bridges n'expose de port sur l'hôte. n8n ne monte jamais
`scripts/`, et aucun workflow ne contient de node `Execute Command`.

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

Un troisième mécanisme sépare en plus l'accès public de l'administration :
un service **`proxy`** (nginx, voir `n8n/proxy/`) ne relaie que
`POST /webhook/report` et `GET /webhook/check` vers n8n ; toute autre
requête (`/`, `/rest/*`, `/webhook-test/*`, mauvaise méthode HTTP sur les
deux routes ci-dessus) reçoit `403` sans jamais atteindre n8n. En local,
`proxy` écoute aussi sur `127.0.0.1` (port `8080`) — en déploiement
réel, c'est uniquement ce port qu'on exposerait publiquement, jamais
`5678`, qui resterait joignable seulement en interne (VPN/tunnel SSH pour
l'administration).

## 1. Configuration

Copier le modèle si `n8n/.env` n'existe pas :

```bash
cp n8n/.env.example n8n/.env
```

Générer une clé de chiffrement n8n une seule fois :

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Générer séparément les deux secrets de bridge (distincts l'un de l'autre
et de `N8N_ENCRYPTION_KEY`) :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Renseigner ensuite dans `n8n/.env` :

```env
N8N_ENCRYPTION_KEY=<clé stable, jamais régénérée>
CHAIN_BRIDGE_TOKEN=<secret WF3, 32 caractères minimum>
BRIDGE_SHARED_SECRET=<secret WF1/WF2, 32 caractères minimum, distinct>
AMOY_RPC_URL=https://polygon-amoy.drpc.org
REGISTRY_CONTRACT_ADDRESS=0x8d51dB4a92c338075360A17AcA005ec282fE1f23
REGISTRY_DEPLOYMENT_BLOCK=43090902
REPORTER_PRIVATE_KEY=<clé Reporter testnet uniquement>
```

Ne jamais ajouter `OWNER_PRIVATE_KEY` dans `n8n/.env`. Dans l'interface
n8n, créer deux credentials chiffrées de type **Header Auth**, chacune
avec le header `Authorization` :

- `Chain Bridge Header Auth` → valeur `Bearer <CHAIN_BRIDGE_TOKEN>`, pour
  WF3/WF4 ;
- `Bridge Shared Secret` → valeur `Bearer <BRIDGE_SHARED_SECRET>`, pour
  WF1/WF2 (webhook interne WF2 et tous les appels vers `bridge`/`capture`/
  `analysis`).

Ni l'une ni l'autre valeur n'est jamais exportée dans le JSON des
workflows : seuls un nom de credential et un identifiant y figurent. n8n
n'a donc plus besoin d'accéder aux variables d'environnement du conteneur
depuis les workflows (`N8N_BLOCK_ENV_ACCESS_IN_NODE` reste à sa valeur
sûre par défaut).

`n8n/.env` est ignoré par Git. Ne jamais régénérer `N8N_ENCRYPTION_KEY`
après le premier démarrage : tous les credentials déjà enregistrés
deviendraient illisibles.

## 2. Démarrage

Depuis `n8n/` :

```bash
docker compose up -d --build
docker compose ps
```

Résultat attendu :

- `anti-phishing-n8n` démarré sur `127.0.0.1:5678` ;
- `anti-phishing-bridge`, `anti-phishing-capture`, `anti-phishing-analysis`,
  `anti-phishing-chain-bridge` et `anti-phishing-proxy` tous `healthy` ;
- aucun port de service interne n'est publié sur l'hôte (`proxy` est le
  seul autre port publié, sur `127.0.0.1:8080`, en plus de `5678`).

Si `n8n/.env` est absent ou qu'une variable obligatoire est vide, la
commande **échoue immédiatement** avec le message `manquante - voir
n8n/README.md`, plutôt que de démarrer avec une configuration incomplète.

Au premier accès à http://127.0.0.1:5678, n8n demande la création du
compte propriétaire. L'éditeur et les credentials restent inaccessibles
sans ce compte.

Réseaux : `bridge`, `capture`, `analysis` et `chain-bridge` sont tous sur
le réseau interne `bridge_internal` (non joignable depuis l'extérieur du
Compose) ; `bridge` et `chain-bridge` rejoignent en plus `blockchain_egress`
pour sortir vers le RPC Amoy, `capture`/`analysis` rejoignent
`analysis_egress`. n8n et `proxy` partagent le réseau `frontend` — `proxy`
n'a accès à aucun autre réseau et ne peut donc joindre que n8n, jamais le
bridge, capture, analysis ou chain-bridge directement.

Vérifications complémentaires :

- http://0.0.0.0:5678 ou l'IP locale de la machine (ex. `http://192.168.x.x:5678`)
  **ne doit pas répondre** depuis un autre appareil du réseau — seul
  `127.0.0.1` doit être joignable ;
- http://127.0.0.1:3001, :8787, :8788 et :8789 **ne doivent pas répondre** :
  aucun de ces services n'a de port publié, ils ne sont joignables que par
  les autres conteneurs Compose ;
- `curl -X POST http://127.0.0.1:8080/webhook/report -d '{}'` doit être
  relayé vers n8n (donc échouer plus loin sur la validation du corps, pas
  sur une erreur de proxy) ;
- `curl http://127.0.0.1:8080/` et `curl http://127.0.0.1:8080/rest/login`
  **doivent répondre `403`** : le proxy ne donne jamais accès à l'éditeur.

## 3. Import et activation de WF1 et WF2

Importer WF2 avant WF1 (WF1 en dépend au moment de l'analyse) :

```bash
docker compose exec n8n n8n import:workflow --input=/export/WF2_Analyse.json
docker compose exec n8n n8n publish:workflow --id=wf2Analysis2026
docker compose exec n8n n8n import:workflow --input=/export/WF1_Ingestion.json
docker compose exec n8n n8n publish:workflow --id=wf1Ingestion2026
docker compose exec n8n n8n import:workflow --input=/export/WF1_Form.json
```

Chaque import contient un placeholder d'identifiant de credential (pas un
secret) sur les nœuds HTTP internes et sur le déclencheur webhook de WF2 :
ouvrir chacun de ces nœuds et sélectionner la credential locale
`Bridge Shared Secret` créée en §1 avant d'activer.

Dans l'interface, activer manuellement dans cet ordre :

1. **WF2 - Capture et analyse IA** ;
2. **WF1 - Ingestion et deduplication** ;
3. **WF1 - Formulaire public de signalement**.

Le formulaire appelle le webhook de production ; il ne fonctionne pas si
le workflow d'ingestion est inactif.

Formulaire local après activation :

`http://127.0.0.1:5678/form/64724547-5ddd-4646-bf07-8dbd2f38be30`

## 4. Test du webhook WF1

```bash
curl -i -X POST http://127.0.0.1:5678/webhook/report \
  -H "Content-Type: application/json" \
  -d '{"type":"url","value":"https://safe-example.invalid/not-listed"}'
```

Réponse attendue pour une entrée absente du registre :

```json
{ "reportId": "r_20260809T120000Z_42", "status": "queued" }
```

Codes gérés :

- `202` : signalement validé, non blacklisté et journalisé ;
- `400` : type, valeur, taille ou champ invalide ;
- `409` : entrée déjà active, avec résultat public filtré ;
- `429` : plus de 10 requêtes par minute pour la même IP ;
- `503` : bridge RPC ou journal temporairement indisponible après 3 essais.

Le rate limiting utilise l'état en mémoire de l'unique instance n8n
locale (RF-S6, seuil 10/minute/IP) ; il reste par-processus, pas
distribué. Le webhook public passe par le reverse proxy `proxy` (voir
§0 Protection de l'instance) mais n'en hérite aujourd'hui aucune limite
supplémentaire — le proxy ne fait que router/bloquer par chemin et
méthode.

La réponse `409` de WF1 peut contenir `txHash: null` : le bridge désactive
la recherche `eth_getLogs` historique, refusée sur de grandes plages par
certains RPC gratuits. La présence active, la catégorie, le score et la
date viennent toujours directement du contrat. La récupération historique
du hash sera traitée dans WF4.

## 5. Comportement de WF1

```text
POST /report
  -> validation du JSON et limite 8 Ko
  -> rate limiting 10 requêtes/minute/IP
  -> validation URL HTTP(S) ou wallet EVM
  -> POST bridge:8787/check
  -> déjà blacklisté : réponse 409 filtrée
  -> absent : création reportId + statut queued
  -> journal JSONL idempotent
  -> réponse 202 (+ déclenchement WF2 en arrière-plan)
```

n8n transmet l'URL brute complète au bridge. Seul `scripts/check.js`
applique la normalisation et calcule le hash partagé avec le smart
contract.

Le workflow ne contient aucun node `Execute Command`, aucune clé privée et
aucun secret exporté. L'authentification vers le bridge passe par la
credential chiffrée `Bridge Shared Secret` (voir §1) ; aucun node
n'accède à `$env` pour ce secret.

## 6. WF2 - capture et analyse IA

`workflows/WF2_Analyse.json` est déclenché en arrière-plan par WF1. Les
deux services internes sont `capture:8788` et `analysis:8789` ; aucun port
n'est publié sur l'hôte. Ajouter dans `n8n/.env` :

```env
GEMINI_API_KEY=<clé Gemini>
GEMINI_MODEL_PRIMARY=gemini-flash-lite-latest
NVIDIA_API_KEY=<clé NVIDIA NIM>
NVIDIA_MODEL_FALLBACK=openai/gpt-oss-20b
```

Flux appliqué : capture HTTP(S) bornée et protégée SSRF, extraction texte
et digest, features URL/RDAP, Gemini avec fallback NVIDIA, score 70/30,
puis `reporting`, `manual_review`, `logged_only` ou `failed`. Le HTML brut
ne sort jamais du service capture.

Tests WF2 :

```bash
npm run capture:test
npm run analysis:test
node ai/tools/capture-pages/test.js
node ai/client/test.js
```

## 7. Journal RF-N11 (WF1/WF2)

Le volume `anti_phishing_bridge_data` contient `/data/reports.jsonl`.
Chaque ligne initiale possède :

- `reportId`, date, type, valeur défangée et statut `queued` ;
- verdict, score final, modèle, catégorie, indicateurs, tx hash et erreur
  initialisés à `null` ou à un tableau vide.

Le journal ne stocke ni URL cliquable, ni contact utilisateur, ni secret.
Un même `reportId` ne produit pas une seconde ligne.

Diagnostic :

```bash
docker compose exec bridge sh -c "tail -n 20 /data/reports.jsonl"
```

## 8. Tests sans Docker (WF1/WF2)

```bash
npm run bridge:test
npm run n8n:test
```

Le test du bridge utilise une lecture blockchain simulée. Le test des
workflows contrôle les connexions, les codes HTTP et l'absence de node
`Execute Command` ou de clé privée.

## 9. Logs et arrêt

```bash
docker compose logs -f n8n bridge chain-bridge
docker compose down
```

Les volumes `anti_phishing_n8n_data`, `anti_phishing_bridge_data` et
`anti_phishing_chain_bridge_state` ne sont pas supprimés par `down` : les
workflows, credentials, journal WF1/WF2 et cycles de vie WF3 persistent.
Pour tout effacer (rare, ex. réinitialisation complète) :
`docker compose down -v` — **irréversible**, à utiliser en connaissance de
cause. Supprimer le volume `chain_bridge_state` efface notamment les
claims Discord et rend impossible leur audit.

## 10. Exporter les workflows en JSON (pour les versionner)

```bash
docker compose exec n8n n8n export:workflow --all --output=/export/workflows.json
```

Le fichier apparaît directement sur l'hôte dans `n8n/workflows/` (monté
sur `/export`), prêt à être commité.

**Les credentials ne sont jamais exportés ni versionnés** : ils restent
uniquement dans le volume interne `anti_phishing_n8n_data`, chiffrés avec
`N8N_ENCRYPTION_KEY`.

## 11. Importer et configurer WF4 `/check`

Le fichier `workflows/WF4-check.json` expose le endpoint public demandé :

```text
GET /webhook/check?type=url&value=https%3A%2F%2Fsafe-example.invalid
```

Importer le fichier depuis l'interface n8n ou avec la CLI, puis ouvrir le
nœud **Call Internal Chain Bridge** et sélectionner le credential Header
Auth créé en §1. Le placeholder d'identifiant présent dans le JSON n'est
pas un secret et doit être remplacé par ce credential local avant
activation.

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

## 12. Contrat d'erreur blockchain pour WF3 (RF-N12)

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

## 13. Cycle de vie et unicité de l'alerte finale WF3 (RF-N10)

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

## 14. Construction sûre de l'alerte Discord

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

## 15. Importer et configurer WF3

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

1. utiliser l'image n8n unifiée `2.31.6` (voir en tête de ce document) et
   revalider les imports WF3/WF4 avec cette version ;
2. reconstruire le bridge et vérifier `/health` ;
3. remplacer les trois placeholders de credentials ;
4. tester d'abord `legitimate`, `suspicious` et `malicious` avec des domaines
   réservés `.invalid` et des dépendances simulées ;
5. vérifier qu'un replay du même `reportId` ne crée ni transaction ni seconde
   alerte ;
6. seulement ensuite planifier un test contrôlé Polygon Amoy et Discord.
