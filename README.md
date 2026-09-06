# Anti-Phishing Web3 — Bouclier communautaire par IA générative & Blockchain

**Un site de phishing signalé, analysé par IA et inscrit dans un registre public infalsifiable — en quelques minutes, sans intervention humaine pour les cas évidents.**

Anti-Phishing Web3 est un pipeline complet de détection, d'analyse et de blocage des menaces ciblant l'écosystème crypto (faux exchanges, wallet drainers, faux airdrops, faux supports). Chaque signalement traverse une chaîne automatisée :

```
Signalement  →  Orchestration n8n  →  Analyse LLM + features déterministes
             →  Blacklist on-chain (Polygon)  →  Alerte Discord  →  Vérification publique
```

Le résultat : une **blacklist décentralisée, vérifiable par n'importe qui**, alimentée par une IA dont les décisions sont expliquées, bornées et auditées — et une frontière de sécurité stricte entre l'automatisation et les clés blockchain.

---

## Pourquoi ce projet

Les blacklists anti-phishing existantes sont centralisées, opaques et lentes à propager. Dans le Web3, une URL malveillante vide des wallets en quelques heures. Ce projet répond à trois exigences :

| Exigence         | Réponse                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| **Réactivité**   | Analyse et publication automatiques dès qu'un signalement franchit le seuil de confiance      |
| **Transparence** | Registre public on-chain, code de contrat vérifié, chaque décision tracée avec son score      |
| **Fiabilité**    | Précision IA de 100 % sur le jeu d'évaluation : aucun site légitime n'a jamais été blacklisté |

---

## Ce que fait le pipeline

### WF1 — Ingestion

Webhook et formulaire public, validation stricte des entrées, rate limiting, **déduplication on-chain** : une URL déjà blacklistée est reconnue immédiatement sans relancer d'analyse.

### WF2 — Analyse

- **Capture sandboxée** de la page suspecte dans un conteneur dédié (sans exécution JavaScript, protection SSRF complète : IPv6, plages privées, métadonnées cloud, redirections).
- **Features URL déterministes** : TLD à risque, âge du domaine (RDAP/WHOIS), homoglyphes, sous-domaines, raccourcisseurs, et **proximité de marque / typosquat** sur 22 marques Web3 (Ledger, MetaMask, PancakeSwap, Uniswap…).
- **Analyse LLM structurée** : sortie JSON validée par schéma, Gemini en primaire avec bascule automatique vers NVIDIA NIM ; résistance au prompt-injection testée.
- **Score combiné** : `0,7 × confiance IA + 0,3 × features`, pour que ni l'IA seule ni les heuristiques seules ne déclenchent une publication.

### WF3 — Décision et action

| Verdict IA                   | Score final | Action                                                     |
| ---------------------------- | ----------- | ---------------------------------------------------------- |
| `malicious`                  | ≥ 0,80      | **Publication on-chain automatique** + alerte Discord      |
| `suspicious` / `malicious`   | 0,50 – 0,79 | **Revue manuelle** dans Discord, avec explication du score |
| `legitimate` ou score < 0,50 | —           | Journalisation, aucune transaction                         |

La publication passe par un **chain-bridge** isolé (retries, relecture on-chain avant toute nouvelle tentative, idempotence garantie par compare-and-swap SQLite).

### Bot Discord de résolution

Les cas en zone grise sont postés dans `#manual-review` avec le détail complet (cible défangée, verdict, indicateurs, explication en langage simple) et deux boutons réservés aux administrateurs : **Publier on-chain** ou **Rejeter**. Un clic suffit ; le journal est mis à jour ; aucun cas ne reste sans issue. Service autonome sans dépendance npm, protégé contre les doubles-clics.

### WF4 — Vérification publique

`GET /check?type=url&value=…` : lecture seule on-chain, réponse filtrée, portail web de consultation. N'importe qui peut vérifier une URL ou un wallet avant d'interagir.

---

## Résultats

### Preuves en conditions réelles

Le pipeline a été exécuté de bout en bout sur des URLs de phishing **actives**, collectées via OpenPhish et des signalements communautaires :

| Cas                                          | Score  | Transaction Polygon Amoy                                                                                              |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Phishing Ledger (OpenPhish)                  | 0,865  | [0xf77442ad…86af](https://amoy.polygonscan.com/tx/0xf77442add68ef73f7a0ff9e78c7c80a1de9bb07dc4148c584258a451352286af) |
| Phishing Ledger (icueoe.top)                 | ≥ 0,80 | [0x9c73fa5d…77d5](https://amoy.polygonscan.com/tx/0x9c73fa5d1b8b74a4820c0cbcaf80c1f2eeb6a3ba3e79476983dba95094c877d5) |
| Typosquat PancakeSwap (pancakeswapo.finance) | 0,803  | [0x56a78903…6949](https://amoy.polygonscan.com/tx/0x56a789039a8b63f85f6633829d8fa0d46ac2ee130d4cb36c1fdeda1d98196949) |

### Évaluation IA (prompt v2.2 gelé, reproductible)

Dataset de 72 entrées (36 phishing réels, 36 sites légitimes Web3), Gemini primaire :

| Métrique  | Résultat   | Cible  |
| --------- | ---------- | ------ |
| Précision | **100 %**  | ≥ 85 % |
| Rappel    | **80,6 %** | ≥ 80 % |
| F1        | **89,2 %** | —      |

Zéro faux positif : aucun site légitime n'atteint le seuil de publication (score légitime maximal observé : 0,138). Méthodologie, hashes des entrées et rapports complets dans [ai/prompts/FROZEN_V2_2.md](ai/prompts/FROZEN_V2_2.md) et [ai/eval](ai/eval).

### Qualité logicielle

- **Smart contract** : 13/13 tests Hardhat, couverture 100 % lignes / 92 % branches, audit Slither sans alerte critique, haute, moyenne ou faible.
- **Services** : 133 tests Node racine + suites dédiées par service (bridge, capture, analyse, bot Discord, workflows) — tous hors ligne, aucun réseau requis.
- **CI GitHub Actions** : compilation, tests et couverture Hardhat, syntaxe JavaScript, tests Node, audit des dépendances.
- **Conteneurs durcis** : non-root, système de fichiers en lecture seule, capabilities supprimées, `no-new-privileges`, réseaux internes segmentés.

---

## Contrat déployé — Polygon Amoy

Le registre `PhishingRegistry` est déployé et son code source vérifié publiquement :

| Élément                    | Valeur                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Adresse                    | `0x8d51dB4a92c338075360A17AcA005ec282fE1f23`                                                       |
| Code vérifié               | https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23#code               |
| Transaction de déploiement | https://amoy.polygonscan.com/tx/0x8e2e4e3c73ca2a7a5dd1f35372945c8462c8b6c194db6b36ccc2e93dc46de2dc |
| Réseau                     | Polygon Amoy (testnet), chain ID 80002                                                             |

Deux rôles distincts : **Owner** (déploiement, gestion des reporters, correction des faux positifs) et **Reporter** (publication des signalements, privilèges minimaux). Les entrées sont indexées par `keccak256` de l'URL normalisée ; la désactivation d'un faux positif conserve l'historique via les events.

> Testnet uniquement. Aucun fonds réel ne transite par les wallets du projet.

---

## Architecture

```
                         ┌──────────────────────── réseau public ─────────────────────────┐
  Utilisateur ──HTTP──►  │  nginx (:8080)  ──►  n8n  ──►  capture (sandbox)  ──►  analysis  │
                         └───────────────────────┬────────────────────────────────────────┘
                                                 │ réseaux internes (jamais exposés)
                    ┌────────────────────────────┼───────────────────────────────┐
                    ▼                            ▼                               ▼
             bridge (journal JSONL)     chain-bridge (clé Reporter)        discord-bot
                                                 │
                                                 ▼
                                    PhishingRegistry (Polygon Amoy)
```

**Principe central : n8n ne touche jamais aux clés ni au shell.** Il appelle un service `chain-bridge` authentifié qui valide des schémas JSON fermés, puis exécute les scripts ethers.js avec `spawn` et `shell: false`. Seule la clé Reporter testnet entre dans ce conteneur ; la clé Owner reste hors de toute la stack.

| Composant          | Rôle                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `PhishingRegistry` | Registre on-chain vérifiable des URLs et wallets malveillants           |
| Proxy nginx        | Point d'entrée public unique, rate limiting                             |
| WF1 / WF2          | Ingestion, déduplication, capture sandboxée, analyse IA                 |
| WF3                | Décision, publication / retry, cycle de vie persistant, alertes Discord |
| WF4                | Vérification publique en lecture seule                                  |
| Chain bridge       | Frontière sécurisée entre n8n, les clés et les scripts blockchain       |
| Bridge journal     | Journal des signalements, API authentifiée + flux public borné          |
| Bot Discord        | Résolution des revues manuelles par boutons administrateur              |
| Portail            | Page web publique de vérification d'URL / wallet                        |

---

## Démarrage rapide

Prérequis : Node.js ≥ 22, Docker Desktop, Git.

```bash
# 1. Cloner et installer
git clone <repo-url> && cd projet_stage
npm install

# 2. Configurer les secrets (jamais commités)
copy .env.example .env            # RPC + wallets (racine)
copy n8n\.env.example n8n\.env    # clés API IA, secrets services, Discord

# 3. Lancer la stack complète (7 conteneurs)
cd n8n && docker compose up -d

# 4. Vérifier
docker compose ps                  # tous les services doivent être "healthy"
curl http://localhost:8080/health

# 5. Envoyer un signalement de démonstration
curl -X POST http://localhost:8080/webhook/report -H "Content-Type: application/json" ^
  -d "{\"type\":\"url\",\"value\":\"https://demo-phishing.invalid/claim\",\"reporterContact\":\"demo@example.com\"}"

# Tests hors ligne (aucun réseau requis)
cd .. && npm run test:all
cd contracts && npm install && npx hardhat test
```

Portail de vérification : `http://localhost:8080/` — interface n8n : `http://localhost:5678`.
Guide d'exploitation détaillé : [n8n/README.md](n8n/README.md).

---

## Scripts blockchain

Tous les scripts renvoient un JSON sur stdout. En production, ils sont consommés uniquement par le chain-bridge ; n8n n'utilise jamais de nœud `Execute Command`.

```bash
# Lecture seule (WF1, WF4)
npm run chain:check -- -- --type=url --value=https://demo-phishing.invalid/claim
npm run chain:check -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD

# Publication (WF3) — score entier 0–100 issu du pipeline
npm run chain:report -- -- --type=url --value=https://demo-phishing.invalid/claim --category=fake_airdrop --score=92

# Correction d'un faux positif — Owner uniquement, jamais depuis n8n
npm run chain:remove -- -- --type=url --value=https://demo-phishing.invalid/claim

# Publication en lot depuis un fichier JSON [{"type","value","category","score"}]
npm run chain:batch-report -- -- --file=./reports.json

# Events depuis le bloc de déploiement ; --follow pour écouter en continu
npm run chain:listen -- -- --follow
```

> Les trois séparateurs `-- -- --` sont nécessaires pour transmettre des options commençant par `--` au script Node via npm.

Catégories : `fake_exchange`, `wallet_drainer`, `fake_airdrop`, `fake_support`, `ponzi`, `other`.

Normalisation appliquée avant `keccak256` : schéma supprimé, domaine en minuscules, `www.` supprimé, query string / fragment / slash final supprimés, path conservé.
Ex. `HTTPS://www.Demo-Phishing.invalid/claim/?ref=x#top` → `demo-phishing.invalid/claim`.

---

## Structure du dépôt

```
├── contracts/   # Hardhat : PhishingRegistry, tests, déploiement, audit Slither
├── scripts/     # Interaction blockchain (ethers.js) : report, check, listen, remove
├── ai/          # Prompts (v2.2 gelé), client LLM multi-fournisseur, dataset, évaluations
├── n8n/         # docker-compose (7 services), workflows WF1–WF4, bridge, portail
│   ├── bridge/         # Journal des signalements (JSONL, API authentifiée)
│   ├── capture/        # Fetch sandboxé des sites suspects (anti-SSRF)
│   ├── analysis/       # Features URL + appel LLM
│   ├── proxy/          # Point d'entrée public (nginx, :8080)
│   ├── portal/         # Page web de vérification
│   └── services/
│       ├── chain-bridge/   # Frontière n8n ↔ blockchain (clé Reporter isolée)
│       └── discord-bot/    # Boutons admin de résolution des revues manuelles
├── test/        # Tests Node racine : bridge, lifecycle, WF3, Discord, workflows
└── .github/     # CI GitHub Actions
```

---

## Sécurité

- **Secrets** : uniquement dans `.env` (voir `.env.example`), jamais dans le code ni dans Git ; historique du dépôt vérifié.
- **Séparation des rôles** : la clé Owner n'entre jamais dans n8n ni dans le bridge ; seule la clé Reporter testnet est injectée dans un service interne isolé.
- **Chain-bridge** : schémas JSON fermés, requêtes bornées, erreurs RPC masquées, exécution sans shell.
- **Idempotence** : SQLite avec compare-and-swap atomique — aucune transaction ni alerte Discord en double, même sous concurrence.
- **Publication sûre** : toute écriture blockchain incertaine est relue on-chain avant une nouvelle tentative.
- **Capture** : conteneur dédié sans exécution JS, garde SSRF (IPv6, CGNAT, métadonnées cloud, épinglage IP, redirections).
- **IA** : sortie structurée validée par schéma, test automatisé de résistance au prompt-injection, retries bornés.

---

## Stack technique

| Domaine       | Technologies                                                       |
| ------------- | ------------------------------------------------------------------ |
| Blockchain    | Solidity, Hardhat, ethers.js v6, Polygon Amoy, Slither             |
| IA            | Gemini (primaire), NVIDIA NIM (fallback), sorties JSON structurées |
| Orchestration | n8n, Docker Compose (7 services), nginx                            |
| Services      | Node.js 22 (sans framework), SQLite, WebSocket Discord natif       |
| Qualité       | node:test, Hardhat coverage, GitHub Actions, npm audit             |

---

## Réseau

| Paramètre | Valeur                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| Réseau    | Polygon Amoy (testnet)                                                                   |
| Chain ID  | 80002                                                                                    |
| RPC       | `https://polygon-amoy.drpc.org` (backup : `https://polygon-amoy-bor-rpc.publicnode.com`) |
| Explorer  | https://amoy.polygonscan.com                                                             |
