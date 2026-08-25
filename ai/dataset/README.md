> ⚠️ **Les URLs de `final/phishing.json`, `final/historical.json` et
> `candidates.json` sont des menaces réelles et actives (sources publiques
> vérifiées).** Ne jamais les ouvrir dans un navigateur, ni cliquer
> dessus, sous aucun prétexte. Elles ne servent qu'à des appels
> programmatiques via `ai/tools/capture-pages/` (conteneur isolé, voir
> §6) — jamais en exécution directe sur la machine hôte.
> Les entrées de `dev/` en revanche pointent vers des domaines `.invalid`
> (RFC 2606, non résolvables) : sans risque.

# Dataset — v1 (Phase 1)

Trois jeux distincts, jamais mélangés (RF-A10) :

- **`dev/`** — jeu de **développement**, uniquement pour itérer sur les
  prompts (Phase 1-3). Entrées **synthétiques/documentées**, domaines
  `.invalid` non résolvables, chacune avec son contenu de page
  (`pageTextExcerpt`) déjà inclus en clair : aucun fetch réseau nécessaire.
  Jamais utilisé comme mesure finale (RF-A8/RF-A9).
- **`final/phishing.json` (36) + `final/legitimate.json` (260)** — jeu de
  **test officiel**, utilisé par `ai/eval/evaluate.js` (Phase 2/3) pour la
  mesure précision/rappel/F1 (critère d'acceptation n°1, ≥85 %/≥80 %) —
  voir §3 pour les biais contrôlés dans `legitimate.json`.
- **`final/historical.json` (10)** — URLs phishing réelles mais **exclues
  du jeu de mesure officiel** (voir §4).

Chaque entrée `final/phishing.json`/`final/historical.json` a d'abord
transité par **`candidates.json`** (étape de validation obligatoire, voir
§2) avant d'être copiée dans `final/`.

## 1. Schéma unifié (partout : `dev/`, `final/`, `candidates.json`)

```json
{
  "url": "string — URL complète",
  "label": "phishing | legitimate",
  "category": "fake_exchange | wallet_drainer | fake_airdrop | fake_support | ponzi | other | null",
  "source": "synthetic | manual-well-known | ScamSniffer | PhishTank | CryptoScamDB",
  "collectedAt": "YYYY-MM-DD",
  "sourceRef": "string | null — référence précise et datée de la source (voir ci-dessous), null si non applicable",
  "notes": "string — contexte"
}
```

Deux champs additionnels, propres à un sous-ensemble seulement :

- **`pageTextExcerpt`** (`dev/` uniquement) — texte représentatif écrit à
  la main pour tester les prompts hors ligne, jamais une copie d'un site
  réel.
- **`categoryConfidence`** (`final/` uniquement, voir §4).

### `sourceRef` — pourquoi c'est nécessaire (RF-A10)

Un dépôt comme `scamsniffer/scam-database` change **tous les jours**
(commit du jour constaté lors de cette collecte). Sans figer *quel*
commit a produit chaque entrée, le dataset n'est pas reproductible.
`sourceRef` fixe cette référence :

- **ScamSniffer** : `"<owner>/<repo>@<sha du commit> (<chemin du fichier>)"`.
- **PhishTank** : `"PhishTank phish_id <id>, submission_time <ISO 8601>"`.
- **CryptoScamDB** : même format que ScamSniffer (dépôt Git + SHA).
- **`dev/` (synthétique) et `manual-well-known`** : `null` — pas de
  référence externe ponctuelle applicable.

## 2. `candidates.json` — étape de validation obligatoire

Avant toute écriture dans `final/phishing.json` ou `final/historical.json`,
chaque URL réelle est d'abord listée ici avec sa source, sa catégorie
proposée et sa fraîcheur, **sans jamais visiter la page**.

**Vérification de fraîcheur des sources** :

| Source | Dernière mise à jour vérifiée | Verdict |
|---|---|---|
| **ScamSniffer** (`scamsniffer/scam-database`) | Commit `196dbbc2` du 2026-07-31 (jour de la collecte) | ✅ Récente — blacklist Web3 active, mise à jour quotidienne constatée |
| **PhishTank** (`verified_online.csv`) | Entrées filtrées sur cible clairement crypto (`target` = Coinbase/Binance/MyEtherWallet), `verified=yes`/`online=yes`, de 2026-01 à 2026-07-31 | ✅ Récente pour la totalité des entrées retenues |
| **CryptoScamDB** (`CryptoScamDB/blacklist`) | Commit `2208d2e9` du **2022-06-28** — dépôt non maintenu depuis ~4 ans, contenu lui-même ~2017-2018 | ⚠️ **Périmée** — voir §4, entrées écartées du jeu de mesure |
| Chainabuse | — | Non utilisée : pas d'export public/API sans authentification trouvé |

## 3. Biais contrôlés dans `final/legitimate.json`

### 3.1 Confondant structurel (page d'accueil vs page d'action)

Risque identifié : les 32 premières entrées légitimes étaient toutes des
**pages d'accueil**, alors que les entrées phishing sont des pages de
**connexion, de claim ou de vérification** — un modèle pourrait apprendre
« page d'accueil = légitime » sans rien détecter des signaux réels de
phishing.

**Correctif** : 15 entrées légitimes **structurellement comparables**
ajoutées (marquées `[Type structurel: ...]` dans `notes`) :

| Type | Entrées | Exemples |
|---|---|---|
| `login` | 5 | pages de connexion réelles Binance, Coinbase, Kraken, Binance.US |
| `support` | 4 | pages de support officielles Binance, Coinbase, Kraken, MetaMask |
| `airdrop-announcement` | 3 | annonces officielles réelles (UNI, ARB, OP) |
| `wallet-connect` | 3 | interfaces dapp réelles avec bouton de connexion wallet (Uniswap, OpenSea, Aave) |

Chaque URL a été vérifiée par recherche web avant inclusion (voir `notes`
de chaque entrée).

### 3.2 Déséquilibre de catégories dans `final/phishing.json`

Distribution réelle (n=36) :

| category | n | % |
|---|---:|---:|
| `fake_exchange` | 19 | 52,8 % |
| `wallet_drainer` | 7 | 19,4 % |
| `fake_support` | 3 | 8,3 % |
| `fake_airdrop` | 3 | 8,3 % |
| `ponzi` | 3 | 8,3 % |
| `other` | 0 | 0 % |
| `null` (indéterminée) | 1 | 2,8 % |

Fortement dominé par `fake_exchange` (majoritairement des clones
Coinbase issus de PhishTank), **aucune** entrée `other`. Conséquence
explicite : **aucune mesure par catégorie n'est exploitable** sur ce jeu
(F1 par catégorie non significatif, en particulier pour `other`,
`fake_support`, `fake_airdrop`, `ponzi` — effectifs trop faibles et
non représentatifs). Seule la mesure binaire globale
(phishing vs legitimate, RF-A9) est présentée comme résultat validé dans
le rapport ; toute lecture par catégorie reste indicative (voir aussi §4).

## 4. `final/historical.json` — pourquoi ces 10 entrées sont exclues de la mesure

Les 10 entrées CryptoScamDB (typosquats MyEtherWallet, incident Coindash,
faux ICO District0x...) sont **documentées mais volontairement écartées
de `final/phishing.json`** :

- Domaines actifs vers **2017-2018**, très probablement morts aujourd'hui
  (dépôt source non maintenu depuis 2022) — les inclure dans le jeu de
  mesure officiel **fausserait précision et rappel** (un domaine mort
  renvoie une erreur réseau, pas un contenu à qualifier).
- `ai/tools/capture-pages/` les capture quand même (voir §6), ce qui
  **confirme empiriquement par la donnée** (`status: "dead"`, taux de
  mortalité) plutôt que par simple présomption la justification de cette
  exclusion.
- Utiles comme **illustration de patterns** (typosquatting, homoglyphes)
  dans le rapport technique, pas comme donnée de test.

## 5. `categoryConfidence` — les catégories du jeu final ne sont PAS une vérité terrain

Toutes les entrées de `final/phishing.json`, `final/historical.json` et
`final/legitimate.json` portent un champ `categoryConfidence` :

- `"unverified"` — la `category` proposée est **déduite du seul nom de
  domaine**, **jamais observée** en visitant la page. Cas de la
  quasi-totalité des entrées `phishing`.
- `null` — aucune catégorie proposée, ou non applicable (`legitimate`).

**Conséquence pour l'évaluation (RF-A9)** : seul le **label binaire
`phishing`/`legitimate`** est fiable comme vérité terrain. Voir §3.2.

## 6. Contenu de page : capturé par `ai/tools/capture-pages/` (DP-5)

`final/phishing.json` et `final/legitimate.json` ne contiennent pas
directement le contenu des pages : **`ai/tools/capture-pages/`**
(prototype de RF-S8/RF-N5 bis, construit en Phase 2/3 au lieu de Phase 5
— voir son README, DP-5) capture chaque URL **une seule fois**, dans un
conteneur Docker dédié isolé, et écrit deux représentations bornées par
entrée dans un cache local :

- `textExcerpt` (max 20 000 caractères) — pour le prompt sémantique RF-A3 ;
- `structuralDigest` (max 5 000 caractères) — champs de formulaire,
  domaines de scripts externes, extraits autour de motifs Web3
  (`eth_sign`, `approve`, `setApprovalForAll`, `window.ethereum`...) —
  pour le prompt de code source RF-A2, que la conversion en texte pur
  effacerait entièrement.

**Statuts possibles** par entrée : `ok`, `dead` (injoignable), `blocked`
(protection SSRF déclenchée — **jamais compté comme mortalité**, c'est la
preuve que RF-N5 bis fonctionne), `skipped` (réponse non-HTML),
`challenged` (page de défi anti-bot détectée : "Just a moment",
"Attention Required", "Checking your browser"...), `empty` (`textExcerpt`
< 200 caractères — coquille vide, souvent une SPA sans JS exécuté). Seul
`ok` entre dans le jeu de mesure officiel ; `dead`/`blocked`/`challenged`/
`empty` en sont exclus.

**Cache et Git — décision (option C, hybride)** :
- Le cache lui-même (`ai/dataset/final/.cache/`) reste **hors Git**
  (`.gitignore`) : il contient du texte extrait de vraies pages, y
  compris de phishing actif.
- **`ai/dataset/final/cache-index.json` est versionné** : une entrée par
  URL (`url`, `normalizedUrl`, `status`, `httpStatus`, `fetchedAt`,
  `textLength`, `contentSha256`). Rend l'évaluation **vérifiable** (on
  peut prouver ce qui a été mesuré) sans publier de contenu hostile.
- `ai/dataset/lib/cacheIndex.js` fournit `verifyIndexIntegrity()` —
  **`ai/eval/evaluate.js` (Phase 2/3) doit l'appeler au démarrage et
  refuser de tourner en cas de divergence** (fichier de cache modifié,
  supprimé, ou restauré depuis une sauvegarde différente de celle
  indexée).
- **Sauvegarde du cache (hors dépôt)** : archiver périodiquement
  `ai/dataset/final/.cache/` en `.zip` daté (ex.
  `capture-cache-2026-07-31.zip`), stocké hors du dépôt Git (espace
  personnel, stockage privé de l'équipe) — le volume Docker nommé seul ne
  suffit pas comme sauvegarde, il ne vit que sur une seule machine. Après
  restauration d'une archive, relancer `verifyIndexIntegrity()` pour
  confirmer qu'elle correspond bien à `cache-index.json`.

**RDAP gelé (AI recall v2, REVIEW_COMMIT_57747F0.md §5/§7)** :
`ai/dataset/final/rdap-cache.json` gèle l'âge de domaine (métadonnées
RDAP publiques, jamais le contenu d'une page) pour chaque domaine unique
du jeu final, avec un horodatage de référence unique (`frozenAt`).
Contrairement au cache de pages, **ce fichier est versionné dans Git** —
il ne contient aucune donnée sensible ni contenu hostile, uniquement des
dates d'enregistrement de domaine publiques. `ai/eval/evaluate.js`
l'injecte systématiquement dans `calculateUrlFeatures()` : aucune requête
RDAP en direct pendant une évaluation, résultat reproductible quel que
soit le jour d'exécution. Régénérer avec
`node ai/dataset/lib/buildRdapCache.js` uniquement quand le jeu final
change (nouvelles URLs) — pas à chaque évaluation.

`ai/eval/evaluate.js` (Phase 2/3) lira exclusivement ce cache — jamais de
refetch (RF-A10). Le **taux de mortalité** (`dead`) et le **taux de
blocage SSRF** (`blocked`) sont documentés séparément dans le rapport
technique : chaque jour de retard sur la capture réduit le nombre de
pages réellement évaluables.

## 7. Résultat réel — capture complète des trois jeux (2026-07-31)

Ordre volontairement inversé : phishing/historical capturés **avant**
legitimate, car les URLs légitimes sont stables et recapturables à volonté
alors que les 36 URLs de phishing meurent vite (certaines déjà mortes au
moment de la capture).

| Jeu | n | ok | dead | empty | challenged | refused | skipped | Taux "ok" |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `phishing` | 36 | 11 | 10 | 10 | 0 | 5 | 0 | **30,6 %** |
| `legitimate` | 260 | 187 | 10 | 45 | 1 | 16 | 1 | **71,9 %** |
| `historical` | 10 | 0 | 8 | 2 | 0 | 0 | 0 | 0 % |

Longueur de `textExcerpt` (entrées avec contenu, `ok`+`empty`) :

| Jeu | n | min | Q1 | médiane | Q3 | max |
|---|---:|---:|---:|---:|---:|---:|
| `phishing` | 21 | 16 | 86 | **285** | 3348 | 20001 |
| `legitimate` | 233 | 0 | 565 | **3756** | 7623 | 20001 |

**Deux constats, pas un seul** :
1. Le confondant SPA/anti-bot est réel des deux côtés (`empty`+`challenged`
   = 27,8 % du jeu phishing, 17,7 % du jeu legitimate) — pas propre au jeu
   légitime.
2. Même en ignorant `empty`/`challenged`, le contenu phishing capturé est
   structurellement **beaucoup plus court** que le contenu légitime
   (médiane 285 vs 3756 caractères — un facteur ~13). C'est cohérent avec
   la nature des pages (landing page à but unique vs site corporate avec
   navigation/marketing), mais c'est aussi un signal que le modèle
   pourrait apprendre involontairement ("court = phishing") plutôt que les
   indicateurs réels (RF-A1/A2/A3). À garder en tête pour l'analyse
   d'erreurs en Phase 2/3.

**`dead` vs `refused` vs géoblocage plausible** (voir aussi §4) :

| Jeu | Codes des `dead` | Codes HTTP des `refused` |
|---|---|---|
| `phishing` | `ENOTFOUND` ×9, `DEPTH_ZERO_SELF_SIGNED_CERT` ×1 | `403` ×5 |
| `legitimate` | `TIMEOUT` ×7, `ENOTFOUND` ×3 | `403` ×16 |
| `historical` | `ENOTFOUND` ×7, `ERR_TLS_CERT_ALTNAME_INVALID` ×1 | — |

Le phishing meurt presque exclusivement par `ENOTFOUND` (domaine qui ne
résout plus — mortalité au sens propre). Le legitimate, à l'inverse, meurt
à 7/10 par `TIMEOUT` (aucune réponse, ni refus explicite ni échec DNS) sur
des sites d'entreprises réelles et actives : `bybit.com`, `bithumb.com`,
`imtoken.com`, `cryptocompare.com`, `monero.org`, `zcash.foundation`,
`okcoin.com`. Plusieurs sont des exchanges/wallets soumis à des
restrictions géographiques connues (Bybit, Bithumb, OKCoin, imToken) ou
des projets de coins de confidentialité parfois filtrés par certains
réseaux (Monero, Zcash) — un `TIMEOUT` silencieux (pas de RST, pas de 403)
est la signature typique d'un blocage réseau/géographique plutôt que d'un
site réellement hors service. **Hypothèse plausible, non confirmée** (pas
de test depuis un autre réseau effectué) — à traiter comme telle dans le
rapport, pas comme un fait établi.

Les `refused` (403/451) sont fréquents des deux côtés (souvent une
protection anti-bot générique, ex. Cloudflare, qui renvoie 403 à un
User-Agent non-navigateur plutôt qu'un géoblocage ciblé).

**Confondant structurel (§3.1) — retour avec les chiffres** : sur les 45
`empty` du jeu légitime, la majorité sont bien les pages de connexion SPA
ajoutées pour contrôler ce confondant (`accounts.binance.com/en/login`,
`login.coinbase.com/signin`, `accounts.coinbase.com/signin`,
`kraken.com/sign-in`, `support.binance.com`...) plus des sites DeFi/infra
modernes. **Décision (utilisateur) : ne pas rééquilibrer pour l'instant**
— le jeu légitime est stable et recapturable à volonté, contrairement au
phishing ; le rééquilibrage, si nécessaire, se fera après l'analyse
Approche A/B (voir capture-pages README, section évaluation vs
production) sans risquer de contenu déjà perdu.

## 8. Jeu déséquilibré pour l'évaluation réaliste (DP-2)

Avec 36 phishing / 260 légitimes (296 au total), la part de phishing est
**≈ 12,2 %** — proche de la cible ~10 % du jeu déséquilibré prévu (DP-2,
Phase 2), suffisant pour produire une mesure de taux de faux positifs
réaliste en plus du jeu équilibré 30/30. Les 260 URLs légitimes
proviennent d'une **compilation manuelle** de projets Web3 réels et
connus (exchanges, L1/L2, DeFi, wallets, NFT, infrastructure, médias
crypto) — pas d'un export Tranco littéral (accès à une liste Tranco
figée non trouvé de façon simple lors de cette recherche) ; à
considérer comme un jeu de sites publics réels, gratuit et sans risque,
mais non issu d'un classement de trafic tiers vérifiable.

## 9. Reproductibilité (RF-A10) — répartition de l'information

- `source` + `collectedAt` + `sourceRef` : figent **où** et **quand**
  chaque entrée a été collectée (voir §1).
- Le **modèle et la version de prompt** utilisés lors d'une évaluation ne
  sont pas stockés dans le dataset lui-même : `ai/eval/evaluate.js`
  (Phase 2/3) les journalise dans son propre rapport de sortie, par run,
  en référençant l'`url` de chaque entrée.
