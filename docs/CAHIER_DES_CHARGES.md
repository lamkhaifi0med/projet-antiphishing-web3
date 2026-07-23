# Cahier des charges — Version complète

**Projet :** Intégration de l'IA Générative et de la Blockchain pour la lutte automatisée contre le Phishing et les fraudes Web3
**Durée :** 40 jours ouvrés — **Équipe :** binôme (Profil A : Web3/Blockchain — Profil B : IA/Orchestration)
**Version :** 1.0 — Juillet 2026

---

## 1. Contexte et problématique

L'écosystème Web3 subit une explosion des attaques par phishing : faux sites d'échange, dapps malveillantes, faux supports clients, wallet drainers, fake airdrops. Les listes de blocage traditionnelles (centralisées, mises à jour manuellement) sont trop lentes face à des campagnes qui durent parfois moins de 24 h.

**Problème à résoudre :** comment détecter, qualifier et partager une menace de phishing en quasi temps réel, de manière automatisée, infalsifiable et consultable par toute la communauté ?

**Réponse proposée :** un pipeline automatisé où l'IA générative qualifie la menace et où la blockchain sert de registre de blocage décentralisé et immuable.

## 2. Objectifs

### 2.1 Objectif général
Développer un prototype fonctionnel capable de détecter, analyser et bloquer en temps réel les menaces de phishing visant les utilisateurs d'actifs numériques.

### 2.2 Objectifs spécifiques mesurables
| ID | Objectif | Critère de succès |
|---|---|---|
| O1 | Capturer des signalements multi-sources | Webhook + formulaire opérationnels, réponse < 2 s |
| O2 | Qualifier automatiquement la fraude par LLM | Précision ≥ 85 % et rappel ≥ 80 % sur le dataset de test |
| O3 | Publier la blacklist on-chain | Contrat déployé et vérifié sur testnet, écriture < 30 s après verdict |
| O4 | Alerter la communauté | Notification Discord < 10 s après le verdict |
| O5 | Permettre la vérification par tous | Endpoint public "check URL/wallet" interrogeant la chaîne |
| O6 | Sécuriser l'infrastructure | 0 vulnérabilité critique (Slither + revue), clés jamais en clair dans le code |

## 3. Périmètre

### 3.1 Inclus
- Signalement d'**URLs** et d'**adresses de wallets** suspectes.
- Analyse automatisée : features de l'URL, code source HTML/JS, contenu sémantique.
- Blacklist on-chain sur **testnet** (Polygon Amoy).
- Alertes Discord ; vérification publique via endpoint n8n.
- Audit de sécurité du prototype (contrat + n8n + secrets).

### 3.2 Exclus (hors périmètre)
- Déploiement sur mainnet ; toute manipulation de fonds réels.
- Analyse dynamique de sites (exécution de JavaScript, sandbox de navigation).
- Extension navigateur complète (**bonus** si avance sur le planning).
- Prise en charge d'autres canaux que URL/wallet (SMS, e-mails bruts) — évolution future.

## 4. Acteurs et cas d'utilisation

| Acteur | Description |
|---|---|
| **Signaleur** | Utilisateur ou système qui soumet une URL/wallet suspect (formulaire ou API) |
| **Système n8n** | Orchestrateur : reçoit, analyse, décide, publie, alerte |
| **Reporter on-chain** | Adresse Ethereum contrôlée par n8n, seule autorisée à écrire dans le contrat |
| **Admin (owner)** | Adresse du binôme : gère les rôles, peut retirer une entrée (faux positif) |
| **Consommateur** | Toute personne/dapp qui interroge la blacklist (lecture publique gratuite) |

**Cas d'utilisation principaux :**
1. UC1 — Signaler une URL suspecte (formulaire ou webhook).
2. UC2 — Signaler une adresse wallet suspecte.
3. UC3 — Analyse automatique et qualification de la menace (LLM).
4. UC4 — Inscription on-chain d'une entrée malveillante.
5. UC5 — Diffusion d'une alerte communautaire (Discord).
6. UC6 — Vérifier si une URL/wallet est blacklistée.
7. UC7 — Retirer une entrée (gestion des faux positifs, admin uniquement).

## 5. Exigences fonctionnelles

### 5.1 Module Orchestration (n8n)
| ID | Exigence | Priorité |
|---|---|---|
| RF-N1 | Exposer un webhook POST `/report` acceptant `{type: "url"\|"wallet", value, context?}` | Haute |
| RF-N2 | Fournir un formulaire de signalement (n8n Form) | Haute |
| RF-N3 | Valider et normaliser les entrées (format URL, checksum adresse EVM) | Haute |
| RF-N4 | Dédupliquer : ne pas ré-analyser une entrée déjà blacklistée (vérif on-chain d'abord) | Haute |
| RF-N5 | Récupérer le HTML du site suspect (timeout 10 s, pas d'exécution JS, User-Agent générique) | Haute |
| RF-N6 | Extraire les features de l'URL : domaine, TLD, âge (whois), homoglyphes, sous-domaines | Moyenne |
| RF-N7 | Appeler le module IA et agréger le score final | Haute |
| RF-N8 | Si score ≥ seuil (0.8) : déclencher l'écriture on-chain puis l'alerte Discord | Haute |
| RF-N9 | Si score en zone grise (0.5–0.8) : file d'attente de revue manuelle (message Discord dédié) | Moyenne |
| RF-N10 | Exposer un endpoint GET `/check?value=...` qui interroge le smart contract | Haute |
| RF-N11 | Journaliser chaque signalement (statut, verdict, tx hash) | Moyenne |
| RF-N12 | Gestion d'erreurs : retries (3×, backoff), notification en cas d'échec du pipeline | Moyenne |

### 5.2 Module IA (analyse cognitive)
| ID | Exigence | Priorité |
|---|---|---|
| RF-A1 | Template de prompt « analyse d'URL » (typosquatting, homoglyphes, TLD suspects) | Haute |
| RF-A2 | Template « analyse de code source » (formulaires de seed phrase, scripts drainers, obfuscation) | Haute |
| RF-A3 | Template « analyse sémantique » (urgence artificielle, fake support, faux airdrops) | Haute |
| RF-A4 | Sortie JSON stricte validée par schéma : `{verdict, confidence, category, indicators[], explanation}` | Haute |
| RF-A5 | Catégories : `fake_exchange`, `wallet_drainer`, `fake_airdrop`, `fake_support`, `ponzi`, `other`, `legitimate` | Haute |
| RF-A6 | LLM principal : Gemini API ; fallback automatique : NVIDIA NIM en cas d'erreur/quota | Haute |
| RF-A7 | Défense anti prompt-injection : contenu du site encadré comme donnée non fiable, jamais interprété comme instruction | Haute |
| RF-A8 | Dataset d'évaluation : ≥ 30 URLs phishing (PhishTank, CryptoScamDB) + ≥ 30 légitimes | Haute |
| RF-A9 | Script d'évaluation produisant précision, rappel, F1 par modèle et par version de prompt | Moyenne |

### 5.3 Module Blockchain (smart contract `PhishingRegistry`)
| ID | Exigence | Priorité |
|---|---|---|
| RF-B1 | Stocker les URLs blacklistées sous forme de hash `keccak256(url normalisée)` | Haute |
| RF-B2 | Stocker les adresses wallet blacklistées | Haute |
| RF-B3 | Métadonnées par entrée : catégorie, score (0-100), timestamp, adresse du reporter | Haute |
| RF-B4 | Contrôle d'accès : seuls les `reporters` autorisés écrivent ; seul l'`owner` gère les rôles | Haute |
| RF-B5 | Fonctions de lecture publiques et gratuites : `isBlacklistedURL(bytes32)`, `isBlacklistedWallet(address)`, `getEntry(...)` | Haute |
| RF-B6 | `removeEntry` réservé à l'owner (faux positifs) — l'historique reste dans les events | Haute |
| RF-B7 | Events : `URLReported`, `WalletReported`, `EntryRemoved` (indexés pour l'écoute off-chain) | Haute |
| RF-B8 | Déploiement sur Polygon Amoy + vérification du code sur Polygonscan | Haute |
| RF-B9 | Scripts d'interaction (Node.js/ethers v6) : report, check, listen aux events, batch report | Haute |
| RF-B10 | Tests unitaires Hardhat, couverture ≥ 90 % des fonctions | Haute |

### 5.4 Module Sécurisation
| ID | Exigence | Priorité |
|---|---|---|
| RF-S1 | Clé privée du reporter : uniquement en variable d'environnement / credentials n8n chiffrés — jamais dans le code ni Git | Haute |
| RF-S2 | Séparation des privilèges : adresse reporter ≠ adresse owner | Haute |
| RF-S3 | Audit du contrat avec Slither + revue manuelle documentée | Haute |
| RF-S4 | n8n derrière authentification (basic auth minimum), instance non exposée publiquement sans protection | Haute |
| RF-S5 | Validation/sanitisation de toutes les entrées du webhook (anti-injection) | Haute |
| RF-S6 | Rate limiting sur le webhook de signalement | Moyenne |
| RF-S7 | `.gitignore` couvrant `.env`, clés, credentials ; scan des secrets avant chaque push | Haute |
| RF-S8 | Fetch des sites suspects isolé (conteneur), timeouts, taille max de réponse | Moyenne |

## 6. Exigences non fonctionnelles

| ID | Exigence | Cible |
|---|---|---|
| RNF-1 | Latence bout-en-bout (signalement → alerte) | < 60 s |
| RNF-2 | Coût de fonctionnement | 0 € (free tiers + testnet) |
| RNF-3 | Disponibilité du prototype en démo | Pipeline rejouable à la demande |
| RNF-4 | Reproductibilité | `docker compose up` + README suffisent pour relancer le projet |
| RNF-5 | Qualité de code | Lint, revue croisée par PR, commits conventionnels |
| RNF-6 | Documentation | README par module + rapport technique final |

## 7. Architecture technique

```
Signalement (formulaire / webhook / flux)
        │
        ▼
┌───────────────── n8n (Docker) ─────────────────┐
│ WF1 Ingestion → validation, normalisation,      │
│                 déduplication (check on-chain)  │
│ WF2 Analyse   → fetch HTML, features URL,       │
│                 appel LLM, score agrégé         │
│ WF3 Action    → écriture smart contract,        │
│                 alerte Discord                  │
│ WF4 Check     → GET /check → lecture on-chain   │
└────────┬────────────────────────┬───────────────┘
         ▼                        ▼
  Gemini API (principal)   PhishingRegistry.sol
  NVIDIA NIM (fallback)    Polygon Amoy (testnet)
                                  │
                                  ▼
                        Lecture publique (dapps,
                        scripts, extension future)
```

**Stack :** Solidity 0.8.x, Hardhat, ethers.js v6, Node.js LTS, n8n (Docker Compose), Gemini API, NVIDIA NIM API, Discord webhooks, Slither.

**Structure du repo (mono-repo Git) :**
```
projet_stage/
├── contracts/        # Hardhat : contrat, tests, scripts de déploiement
├── scripts/          # Interaction chain : report, check, listen
├── ai/               # Templates de prompts, dataset, script d'évaluation
├── n8n/              # docker-compose.yml, workflows exportés (JSON)
├── docs/             # Cahiers des charges, rapport, schémas
└── README.md
```

## 8. Spécifications d'interface (contrats entre modules)

> Ces interfaces sont **figées** : chaque membre développe son côté sans attendre l'autre. Toute modification exige l'accord des deux membres et une mise à jour de cette section.

### 8.1 API de signalement — `POST /report` (WF1)

Requête :
```json
{
  "type": "url",              // "url" | "wallet"
  "value": "https://blnance-support.xyz/claim",
  "context": "Reçu par DM Discord, promet un airdrop",   // optionnel
  "reporterContact": "user#1234"                          // optionnel
}
```
Réponse `202 Accepted` :
```json
{ "reportId": "r_20260722_0001", "status": "queued" }
```
Erreurs : `400` (format invalide), `409` (déjà blacklisté, renvoie l'entrée existante), `429` (rate limit).

### 8.2 API de vérification — `GET /check?type=url&value=...` (WF4)

Réponse `200` :
```json
{
  "blacklisted": true,
  "category": "fake_airdrop",
  "score": 92,
  "since": "2026-07-20T14:03:00Z",
  "txHash": "0xabc..."
}
```
Si non blacklisté : `{ "blacklisted": false }`.

### 8.3 Sortie du module IA (schéma JSON strict)

```json
{
  "verdict": "malicious",          // "malicious" | "suspicious" | "legitimate"
  "confidence": 0.94,              // 0.0 – 1.0
  "category": "wallet_drainer",    // cf. RF-A5
  "indicators": [
    "Formulaire demandant la seed phrase",
    "Domaine typosquatté : blnance vs binance"
  ],
  "explanation": "…"               // 2-3 phrases max
}
```
Toute réponse ne validant pas ce schéma est rejetée (max 2 retries, puis verdict `suspicious` + revue manuelle).

### 8.4 Règle de normalisation d'URL (avant hachage et déduplication)

1. Passer le scheme et le host en minuscules.
2. Supprimer le scheme (`https://` / `http://`) — on blackliste le site, pas le protocole.
3. Supprimer le préfixe `www.`.
4. Supprimer la query string, le fragment (`#…`) et le trailing slash.
5. Conserver le path restant (permet de blacklister `site.com/scam` sans bloquer tout `site.com` si besoin).
6. Encodage : UTF-8, punycode conservé tel quel (les homoglyphes sont détectés par l'IA, pas par la normalisation).

Exemple : `HTTPS://www.Blnance-Support.xyz/claim/?ref=x#top` → `blnance-support.xyz/claim`
Hash on-chain : `keccak256(bytes("blnance-support.xyz/claim"))`.

### 8.5 Interface du smart contract (signatures figées)

```solidity
enum Category { FakeExchange, WalletDrainer, FakeAirdrop, FakeSupport, Ponzi, Other }

struct Entry { Category category; uint8 score; uint40 timestamp; address reporter; bool active; }

function reportURL(bytes32 urlHash, Category category, uint8 score) external;      // onlyReporter
function reportWallet(address wallet, Category category, uint8 score) external;    // onlyReporter
function isBlacklistedURL(bytes32 urlHash) external view returns (bool);
function isBlacklistedWallet(address wallet) external view returns (bool);
function getURLEntry(bytes32 urlHash) external view returns (Entry memory);
function getWalletEntry(address wallet) external view returns (Entry memory);
function removeURL(bytes32 urlHash) external;                                       // onlyOwner
function removeWallet(address wallet) external;                                     // onlyOwner
function setReporter(address reporter, bool allowed) external;                      // onlyOwner

event URLReported(bytes32 indexed urlHash, Category category, uint8 score, address indexed reporter);
event WalletReported(address indexed wallet, Category category, uint8 score, address indexed reporter);
event EntryRemoved(bytes32 indexed key, bool isWallet);
```

### 8.6 Seuils de décision (agrégation du score)

| Score final (0–1) | Décision |
|---|---|
| ≥ 0.8 | Écriture on-chain + alerte Discord `#alerts` |
| 0.5 – 0.79 | Message Discord `#manual-review`, pas d'écriture on-chain |
| < 0.5 | Journalisé uniquement, aucune action |

Score final = `0.7 × confidence_LLM + 0.3 × score_features_URL` (pondération ajustable pendant la Phase 2, à figer au plus tard J16).

### 8.7 Message d'alerte Discord (embed)

Champs obligatoires : URL/wallet (défangé : `hxxps://blnance[.]xyz`), verdict, catégorie, score, top 3 indicateurs, tx hash (lien Polygonscan), reportId, timestamp.

## 9. Livrables

| # | Livrable | Contenu | Échéance |
|---|---|---|---|
| L1 | Workflows n8n opérationnels | 4 workflows exportés (JSON) + docker-compose + doc | J26 |
| L2 | Smart contract sur testnet | Code vérifié sur Polygonscan + tests + scripts d'interaction | J11 |
| L3 | Module IA configuré | Templates de prompts versionnés + dataset + rapport d'évaluation | J16 |
| L4 | Rapport d'audit sécurité | Résultats Slither, revue, mesures de durcissement | J31 |
| L5 | Rapport technique final | Architecture, choix, résultats, soutenabilité, limites | J40 |
| L6 | Démo bout-en-bout | Scénario rejouable + page de vérification simple | J38 |

## 10. Planning (40 jours)

| Phase | Jours | Contenu | Jalon |
|---|---|---|---|
| 0 — Setup | J1–J4 | Installations, clés API, MetaMask + faucet, repo Git, formations croisées | Environnement prêt |
| 1 — Smart contract | J5–J11 | Spéc, dev, tests, déploiement Amoy, scripts | **L2** |
| 2 — Module IA | J8–J16 | Prompts, dataset, évaluation, itérations | **L3** |
| 3 — Workflows n8n | J15–J26 | WF1→WF4, gestion erreurs, intégration chain + Discord | **L1** |
| 4 — Sécurisation | J25–J31 | Audit contrat, durcissement n8n, secrets, anti-injection | **L4** |
| 5 — Intégration & rapport | J32–J40 | Tests E2E, démo, rapport, soutenance | **L5, L6** |

**Rituels d'équipe :** point quotidien 15 min ; démo hebdomadaire à l'encadrant ; toute fusion passe par une pull request relue par l'autre membre.

## 11. Critères d'acceptation globaux

1. Un signalement soumis via le formulaire aboutit, sans intervention manuelle, à : verdict IA + inscription on-chain (si malveillant) + alerte Discord, en < 60 s.
2. `GET /check` retourne le statut on-chain correct pour une URL blacklistée et pour une URL saine.
3. Le contrat est vérifié sur Polygonscan Amoy et ses tests passent (couverture ≥ 90 %).
4. L'évaluation IA atteint précision ≥ 85 % / rappel ≥ 80 % sur le dataset.
5. Aucun secret dans le dépôt Git (vérifié par scan) ; Slither ne remonte aucune vulnérabilité critique non traitée.
6. Le rapport technique couvre : architecture, sécurité, résultats chiffrés, soutenabilité (coûts gas, scalabilité, limites free tier) et pistes d'évolution.

## 12. Risques et mitigations

| Risque | Impact | Probabilité | Mitigation |
|---|---|---|---|
| Quota free tier LLM dépassé | Pipeline bloqué | Moyenne | Fallback NVIDIA NIM, cache des analyses, rate limiting interne |
| Faucet Amoy épuisé/limité | Pas de déploiement/tx | Moyenne | Collecter des POL test dès J1, multiplier les faucets, économiser le gas |
| Sites de phishing dangereux à fetcher | Compromission | Faible | Fetch serveur only, pas d'exécution JS, conteneur isolé, timeouts |
| Prompt injection via contenu du site | Faux verdict | Moyenne | Contenu balisé non fiable, sortie validée par schéma JSON, double analyse si incohérence |
| Faux positifs on-chain | Perte de confiance | Moyenne | Zone grise → revue manuelle, `removeEntry` admin, seuil de score élevé |
| Retard planning | Livrables incomplets | Moyenne | Phases 1/2 parallèles, périmètre bonus sacrifiable (extension navigateur) |
| Indisponibilité d'un membre | Perte de vélocité | Faible | Revue croisée systématique = connaissance partagée du code |

## 13. Glossaire

- **Dapp** : application décentralisée s'exécutant via des smart contracts.
- **Wallet drainer** : script malveillant qui vide le portefeuille après signature d'une transaction piégée.
- **Testnet** : réseau blockchain de test, tokens sans valeur réelle.
- **Faucet** : service distribuant gratuitement des tokens de testnet.
- **keccak256** : fonction de hachage utilisée par Ethereum.
- **Prompt injection** : attaque consistant à insérer des instructions dans les données analysées par un LLM.
- **Défangage** : réécriture d'une URL malveillante pour la rendre non cliquable (hxxps, [.]).

## 14. Gestion des évolutions du document

Ce cahier des charges est la référence contractuelle du stage. Les sections 1 à 8 sont figées après validation par l'encadrant. Toute évolution (changement de périmètre, d'interface, de seuil) doit être : proposée par écrit, acceptée par les deux membres et l'encadrant, tracée dans le tableau ci-dessous, puis répercutée dans les versions individuelles.

| Version | Date | Modification | Auteur | Validée par |
|---|---|---|---|---|
| 1.0 | 22/07/2026 | Version initiale | Binôme | — |
| 1.1 | 22/07/2026 | Ajout section 8 (spécifications d'interface) | Binôme | — |
