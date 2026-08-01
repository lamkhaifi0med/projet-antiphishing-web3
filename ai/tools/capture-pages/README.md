# capture-pages

Outil **one-shot** de capture du contenu des URLs du dataset final
(`ai/dataset/final/phishing.json`, `legitimate.json`, `historical.json`).
Prototype de RF-S8/RF-N5 bis (décision de portée **DP-5**), construit en
avance sur le planning (Phase 2/3 au lieu de Phase 5) parce que sans lui,
`ai/eval/evaluate.js` ne peut mesurer que RF-A1 (analyse d'URL) — RF-A2
(code source) et RF-A3 (sémantique) ont besoin d'un vrai contenu de page.

**Ce n'est pas** le service de fetch permanent de WF2
(`n8n/fetch-service/`, prévu Phase 5) : c'est un outil batch, lancé une
fois (ou incrémentalement), qui écrit un cache local que `evaluate.js`
lira ensuite sans jamais refetcher (RF-A10).

## ⚠️ Rappel sécurité

Cet outil se connecte réellement aux URLs de `final/phishing.json` (menaces
actives). Il ne doit **jamais** tourner ailleurs que dans le conteneur
dédié décrit ci-dessous — jamais en exécution directe sur la machine hôte
en dehors d'un test avec des URLs sûres (`legitimate`), jamais avec
`--network host`.

## Ce qu'il fait

1. Pour chaque URL du dataset, vérifie si un cache existe déjà
   (`<CACHE_DIR>/<sha256>.json`, clé = URL normalisée §8.4) — si oui,
   renvoie le statut historique sans repasser par le réseau (RF-A10 :
   jamais de refetch).
2. Sinon, capture **une seule fois** :
   - protection SSRF (`lib/ssrfGuard.js`) : résolution DNS puis validation
     de chaque IP (refuse loopback/privé/link-local/CGNAT/metadata/
     IPv4-mapped IPv6), IP validée épinglée pour la connexion (pas de
     second lookup DNS, protection contre le DNS rebinding) ;
   - fetch (`lib/fetcher.js`) : HTTP(S) uniquement, `text/html` uniquement
     accepté, **délai absolu** de 10 s (`AbortController`, pas un simple
     timeout d'inactivité socket — voir bug corrigé plus bas), taille max
     2 Mo (lecture en flux, résolution immédiate dès dépassement),
     User-Agent générique documenté, pas d'exécution JS (pas de
     navigateur, fetch brut) ; redirections revalidées à chaque saut
     (même contrôle DNS/IP), 3 maximum ;
   - conversion (`lib/htmlToDigest.js`) en **deux représentations
     bornées** :
     - `textExcerpt` (max **20 000 caractères**) : texte lisible, tags/
       scripts/styles retirés — pour le prompt sémantique RF-A3 ;
     - `structuralDigest` (max **5 000 caractères** sérialisés) : champs
       de formulaire (`name`/`type`/`placeholder`, max 20, chaque valeur
       tronquée à 100 caractères), domaines de scripts externes (max 20),
       extraits autour des motifs Web3 `eth_sign`, `personal_sign`,
       `eth_requestAccounts`, `approve`, `setApprovalForAll`, `permit`,
       `transferFrom`, `window.ethereum` (max 15 extraits, ±80 caractères
       de contexte chacun) — pour le prompt RF-A2, que la conversion en
       texte pur effacerait entièrement (formulaires, scripts).
   - classification post-capture : `challenged` si une page de défi
     anti-bot est détectée, `empty` si `textExcerpt` < 200 caractères
     (voir « Confondant SPA/anti-bot » ci-dessous).
3. Écrit un enregistrement JSON par URL dans le cache **et** met à jour
   `ai/dataset/final/cache-index.json` (versionné — voir « Cache et
   Git »), avec le statut :
   - `"ok"` — capturé, contenu exploitable ;
   - `"dead"` — injoignable (DNS, timeout, connexion refusée...), `error`
     renseigné, **aucun retry automatique** ;
   - `"blocked"` — bloqué par la protection SSRF (ex. domaine parqué
     résolvant vers une IP privée). **Jamais compté comme mortalité** :
     c'est la preuve que RF-N5 bis fonctionne, pas un échec ;
   - `"skipped"` — réponse reçue mais pas de type `text/html` ;
   - `"challenged"` — page de défi anti-bot détectée ("Just a moment",
     "Attention Required", "Enable JavaScript and cookies", "Checking
     your browser") ;
   - `"empty"` — `textExcerpt` < 200 caractères (coquille SPA vide, souvent
     sans JS exécuté).
4. En fin de run, affiche pour chaque jeu (`phishing`/`legitimate`/
   `historical`) la **distribution des statuts** et la **longueur
   médiane de `textExcerpt`** — séparément par jeu, jamais agrégées, pour
   pouvoir comparer le profil phishing vs legitimate.

Seul `"ok"` entre dans le jeu de mesure officiel d'`evaluate.js` ;
`dead`/`blocked`/`challenged`/`empty` en sont exclus.

`historical.json` est capturé aussi (permet de **confirmer par la donnée**
que ces domaines sont bien morts — voir `ai/dataset/README.md` §4), mais
reste hors du jeu de mesure officiel quel que soit le résultat.

## Confondant SPA/anti-bot — risque confirmé par un run réel

Sans exécution JS et avec un User-Agent déclaré robot, une application
JavaScript moderne ou un site derrière protection anti-bot peut renvoyer
une coquille quasi vide ou une page de défi, alors que le phishing est
souvent du HTML statique complet — un modèle pourrait alors apprendre
« contenu vide = légitime » plutôt que détecter du phishing. D'où les
statuts `challenged`/`empty` (exclus de la mesure comme `dead`).

**Run réel du 2026-07-31** (`--only=legitimate --limit=40`, avant toute
capture du jeu `phishing`, comme prévu pour vérifier ce risque avant de
consommer des URLs qui meurent vite) :

| Statut | n | % |
|---|---:|---:|
| `ok` | 26 | 65,0 % |
| `empty` | 12 | 30,0 % |
| `challenged` | 1 | 2,5 % |
| `dead` | 1 | 2,5 % |

Longueur médiane de `textExcerpt` (n=39) : **4171 caractères**. Détail et
décision en attente (rééquilibrer ou accepter la perte) : voir
`ai/dataset/README.md` §7.

## Bug corrigé : capture bloquée indéfiniment sur une page dépassant 2 Mo

Constaté en pratique sur `lido.fi` (page réelle plus grosse que 2 Mo) :
`res.destroy()`, appelé pour arrêter la lecture au-delà de `MAX_BYTES`
(RF-N5), n'émet ni `'end'` ni `'error'` de façon fiable — la promesse de
capture ne se résolvait donc jamais, indépendamment du timeout. Corrigé
en deux temps :
1. **Résoudre immédiatement** au moment de la troncature (`fetcher.js`),
   au lieu d'attendre un événement qui peut ne jamais arriver.
2. Remplacer le timeout d'inactivité socket (`{ timeout }`, qui se
   réinitialise tant que des données arrivent, même au compte-goutte) par
   un **délai absolu** via `AbortController` + `setTimeout`, qui coupe la
   requête après 10 s quoi qu'il arrive.

Vérifié après correction : `lido.fi` capturé en 796 ms, `truncated: true`,
2 097 123 octets (borne 2 Mo respectée).

## Priorité de troncature de `structuralDigest` (si le budget de 5 000 caractères est dépassé)

Les `web3PatternSnippets` sont le signal le plus discriminant pour RF-A2
(formulaire de seed phrase, `approve` illimité, `setApprovalForAll`...) et
sont donc réduits **en tout dernier recours** :

1. `externalScriptDomains` réduits en premier (le moins discriminant seul).
2. `formFields` sans `name` ni `placeholder` retirés (peu informatifs).
   Ce plafond est appliqué dès l'extraction (pas seulement ici) : un champ
   nommé placé après des champs vides dans le HTML ne perd jamais sa place
   au profit de l'ordre d'apparition.
3. Contexte de chaque `web3PatternSnippets` raccourci (le motif lui-même
   reste intact).
4. `web3PatternSnippets` supprimés entièrement, un par un — dernier recours.
5. Filet de sécurité final sur les `formFields` restants (ne devrait pas
   être atteint en pratique).

Voir `test.js` pour la vérification de cet ordre.

## Cache et Git — décision prise : option C (hybride)

- Le cache lui-même (`ai/dataset/final/.cache/`) reste **hors Git**
  (`.gitignore`) : il contient du texte extrait de vraies pages, y compris
  de phishing actif.
- **`ai/dataset/final/cache-index.json` est versionné** : une entrée par
  URL avec `url`, `normalizedUrl`, `status`, `httpStatus`, `fetchedAt`,
  `textLength` et le **SHA-256** du contenu (`textExcerpt` +
  `structuralDigest` sérialisés) — calculé par
  `ai/dataset/lib/cacheIndex.js`. Rend l'évaluation vérifiable sans
  publier de contenu hostile dans le dépôt.
- **`ai/eval/evaluate.js` (Phase 2/3) doit appeler
  `verifyIndexIntegrity()` au démarrage et refuser de tourner en cas de
  divergence** (fichier de cache modifié, supprimé, ou restauré depuis une
  sauvegarde différente de celle indexée).
- **Sauvegarde** : voir `ai/dataset/README.md` §6 (archive `.zip` datée,
  hors dépôt, revérifiée avec `verifyIndexIntegrity()` après restauration).

## Build & run

Depuis la racine du dépôt :

```bash
docker build -t capture-pages ai/tools/capture-pages
docker volume create capture_pages_cache
```

PowerShell / cmd.exe (Windows) :

```powershell
docker run --rm `
  --cap-drop=ALL `
  --security-opt=no-new-privileges `
  -v "${PWD}/ai/dataset/final:/data:ro" `
  -v capture_pages_cache:/cache `
  -e DATASET_DIR=/data `
  -e CACHE_DIR=/cache `
  capture-pages
```

Git Bash / macOS / Linux :

```bash
docker run --rm \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  -v "$(pwd)/ai/dataset/final:/data:ro" \
  -v capture_pages_cache:/cache \
  -e DATASET_DIR=/data \
  -e CACHE_DIR=/cache \
  capture-pages
```

Le dataset (`/data`) est monté **en lecture seule** : l'outil ne peut pas
modifier `phishing.json`/`legitimate.json`/`historical.json`. Le cache vit
dans un **volume Docker nommé distinct** (`capture_pages_cache`, monté sur
`/cache`), pas dans le dossier du dataset. `cache-index.json` (versionné)
est en revanche écrit directement dans `/data` — nécessite que le montage
dataset soit accessible en écriture pour ce seul fichier, ou un montage
séparé si `:ro` bloque aussi l'écriture du nouvel index (à vérifier au
premier run réel : si `:ro` empêche l'écriture de `cache-index.json`,
monter `ai/dataset/final/cache-index.json` individuellement en `:rw`
plutôt que tout `ai/dataset/final`).

**Ne jamais ajouter `--network host`** : le réseau bridge par défaut de
Docker suffit et isole le conteneur du réseau de l'hôte (RF-N5 bis/RF-S8).

Options : `--only=phishing|legitimate|historical` (un seul jeu),
`--limit=N` (les N premières entrées, utile pour un premier test rapide).

### Sortir le cache du volume nommé (pour qu'`evaluate.js` y accède depuis l'hôte)

Un volume Docker nommé n'est pas un dossier visible directement par un
script Node lancé hors conteneur :

```bash
docker run --rm -v capture_pages_cache:/cache -v "$(pwd)/ai/dataset/final/.cache/pages:/export" alpine \
  sh -c "cp -r /cache/. /export/"
```

## Exécution directe Node (débogage, et jeu `legitimate` uniquement — jamais `phishing`/`historical` hors conteneur)

```bash
node ai/tools/capture-pages/capture.js --only=legitimate --limit=40
```

Sans `DATASET_DIR`/`CACHE_DIR`, l'outil utilise `ai/dataset/final` et
`ai/dataset/final/.cache/pages` par chemin relatif. C'est ainsi qu'a été
obtenu le run réel documenté ci-dessus (jeu `legitimate`, sans risque).

## Tests

Suite de tests commise et rejouable (`assert` natif Node, aucune
dépendance) :

```bash
node ai/tools/capture-pages/test.js
```

**Résultat vérifié à la dernière exécution : 21/21 tests passés, code de
sortie 0.** Un run précédent avait échoué (17/21) à cause de deux bugs
réels détectés par le test, corrigés depuis :
- `extractFormFields` tronquait par ordre d'apparition dans le HTML — un
  champ nommé après des champs vides pouvait perdre sa place. Corrigé :
  priorité aux champs porteurs d'information, indépendamment de l'ordre.
- `extractPatternSnippets` pouvait épuiser tout le budget sur un seul
  motif très répété avant de chercher les autres. Corrigé par une
  répartition round-robin entre motifs distincts.

Couvre : `ssrfGuard` (blocage des plages privées/loopback/metadata,
autorisation d'un domaine public réel), isolation script/texte visible,
et l'ordre de troncature ci-dessus. **Non couvert** par cette suite (limite
assumée, pas simulée avec les constantes actuelles) : le palier 2 (champs
sans name/placeholder) et le palier 5 (filet de sécurité final) de
`buildStructuralDigest`, difficiles à déclencher isolément une fois le
plafond `MAX_FORM_FIELDS` appliqué dès l'extraction ; le bug de troncature
2 Mo (corrigé après un vrai run, pas encore couvert par un test dédié —
à ajouter).

## Ce qui a été vérifié en dehors de test.js

- `fetcher.captureUrl` récupère bien une page réelle (`example.com`,
  `lido.fi` après correction) et bloque bien une cible `127.0.0.1`.
- **Run réel effectué** : `--only=legitimate --limit=40` (40 vraies URLs
  légitimes, résultats ci-dessus).
- **Non fait** : le build/run Docker lui-même (Docker Desktop indisponible
  pendant cette session), et toute capture réelle sur `final/phishing.json`
  (36 URLs) — en attente de ta décision sur le rééquilibrage du jeu
  légitime (voir `ai/dataset/README.md` §7) avant de continuer.

## Limite connue (à durcir en Phase 5)

L'extraction HTML utilise des expressions régulières, pas un vrai parseur
— suffisant pour un prototype borné, mais moins robuste face à du HTML
volontairement malformé (fréquent sur des pages de phishing). À
remplacer par un vrai parseur (ex. `node-html-parser`) lors de la reprise
de cette logique dans `n8n/fetch-service/` (Phase 5, RF-S8 définitif).
