# Plan de travail — Stage (40 jours, binôme)

**Sujet :** Intégration de l'IA Générative et de la Blockchain pour la lutte automatisée contre le Phishing et les fraudes Web3

---

## 1. Vision d'ensemble

Un utilisateur (ou un flux automatique) **signale** une URL / adresse wallet suspecte → **n8n** orchestre l'analyse → le **LLM (Gemini)** qualifie la fraude → si malveillant, l'entrée est **inscrite sur la blockchain** (blacklist décentralisée sur testnet) et des **alertes** sont envoyées (Discord). N'importe qui peut ensuite **consulter la blacklist** on-chain.

## 2. Architecture technique

```
┌─────────────────────┐
│  Signalements        │  Formulaire web / Webhook API / flux (PhishTank, etc.)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  n8n (Docker)        │  Workflow : réception → enrichissement → décision
│                      │  - Fetch HTML du site suspect
│                      │  - Extraction features URL (domaine, âge, TLD…)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Module IA           │  Gemini API (principal) + NVIDIA NIM (fallback)
│                      │  Prompts : analyse URL + code source + sémantique
│                      │  Sortie JSON : {verdict, score, catégorie, raisons}
└─────────┬───────────┘
          ▼ (si score > seuil)
┌──────────────────────────────┐      ┌──────────────────┐
│  Smart Contract (Solidity)    │      │  Alertes           │
│  PhishingRegistry sur          │      │  Discord webhook   │
│  Polygon Amoy (testnet)        │      │  (+ Slack option)  │
│  - blacklist URLs (hash)       │      └──────────────────┘
│  - blacklist wallets           │
│  - rôles reporter/admin        │
└──────────────┬───────────────┘
               ▼
┌─────────────────────┐
│  Consultation        │  Script/API de vérification : "cette URL est-elle blacklistée ?"
└─────────────────────┘
```

## 3. Choix techniques

| Brique | Choix | Justification |
|---|---|---|
| Blockchain | **Polygon Amoy** (testnet) | Gratuit (faucet), rapide, EVM-compatible, demandé dans le sujet |
| Smart contract | **Solidity + Hardhat** | Standard industrie, tests intégrés, déploiement facile |
| Interaction chain | **ethers.js v6** (Node.js/TS) | Léger, bien documenté |
| Orchestration | **n8n via Docker Compose** | Self-hosted gratuit, nodes HTTP/Webhook/Discord natifs |
| LLM principal | **Gemini API** (gemini-2.x-flash, free tier) | Gratuit, rapide, bon en analyse de texte/code, sortie JSON structurée |
| LLM fallback | **NVIDIA NIM** (Llama, etc., free tier) | Redondance + comparaison de performances pour le rapport |
| Wallet | **MetaMask** + clé dédiée testnet | Jamais de vrais fonds ; clé stockée en variable d'environnement |
| Secrets | `.env` + n8n credentials store (+ chapitre durcissement) | Exigence "Sécurisation" du sujet |

## 4. Planning — 40 jours

### Phase 0 — Setup & montée en compétences (J1 → J4)
- [ ] Installer : Git, Node.js LTS, Docker Desktop, VS Code (+ extensions Solidity, Docker)
- [ ] Créer les comptes/clés : Gemini API key, NVIDIA NIM key, MetaMask, faucet Amoy (POL test)
- [ ] Créer le repo Git (mono-repo : `contracts/`, `n8n/`, `ai/`, `docs/`)
- [ ] Mini-formations croisées : bases Solidity, bases n8n, mécanismes du phishing
- **Livrable :** environnement fonctionnel + repo initialisé

### Phase 1 — Smart Contract `PhishingRegistry` (J5 → J11)
- [ ] Spécifier le contrat : stockage de hash d'URL (keccak256) et d'adresses wallet, avec métadonnées (catégorie, score, timestamp, reporter)
- [ ] Rôles : `owner` (admin), `reporters` autorisés (l'adresse utilisée par n8n)
- [ ] Fonctions : `reportURL`, `reportWallet`, `isBlacklistedURL`, `isBlacklistedWallet`, `removeEntry`, events
- [ ] Tests unitaires Hardhat (couverture des cas limites)
- [ ] Déploiement sur Amoy + vérification sur l'explorer (Polygonscan)
- [ ] Scripts d'interaction ethers.js (report / check / listen aux events)
- **Livrable :** contrat déployé sur testnet + scripts (livrable n°2 du sujet)

### Phase 2 — Module IA (J8 → J16, en parallèle de la fin de Phase 1)
- [ ] Concevoir les templates de prompts : analyse d'URL, analyse de HTML/JS, analyse sémantique (faux support, fake airdrop, wallet drainer…)
- [ ] Imposer une sortie JSON stricte : `{verdict, confidence, category, indicators[], explanation}`
- [ ] Constituer un mini-dataset de test : ~30 URLs phishing connues (PhishTank/CryptoScamDB) + ~30 légitimes
- [ ] Évaluer : précision/rappel Gemini vs modèle NVIDIA, itérer sur les prompts
- [ ] Petit service ou nodes n8n réutilisables pour appeler les LLM
- **Livrable :** templates de prompts optimisés + résultats d'évaluation (livrable n°3)

### Phase 3 — Workflows n8n (J15 → J26)
- [ ] Déployer n8n en Docker Compose
- [ ] **Workflow 1 — Ingestion :** webhook de signalement + formulaire n8n
- [ ] **Workflow 2 — Analyse :** fetch du site (avec sandbox/timeout), features URL, appel LLM, agrégation du score
- [ ] **Workflow 3 — Action :** écriture sur le smart contract (via script/HTTP), alerte Discord avec le verdict détaillé
- [ ] **Workflow 4 — Vérification :** endpoint public "check URL" qui interroge la blockchain
- [ ] Gestion des erreurs, retries, déduplication (URL déjà blacklistée)
- **Livrable :** workflows n8n opérationnels interconnectés (livrable n°1)

### Phase 4 — Sécurisation & audit (J25 → J31)
- [ ] Gestion de la clé privée : variables d'environnement, credentials n8n chiffrés, principe du moindre privilège (adresse reporter ≠ owner)
- [ ] Audit du smart contract : Slither + revue manuelle (reentrancy, access control, gas)
- [ ] Durcissement n8n : authentification, HTTPS, validation des entrées du webhook (anti-injection dans les prompts !)
- [ ] Protection contre le prompt injection : le contenu des sites analysés est **non fiable** → séparation données/instructions dans les prompts
- [ ] Rate limiting sur le webhook de signalement
- **Livrable :** rapport d'audit + infrastructure durcie

### Phase 5 — Intégration, démo & rapport (J32 → J40)
- [ ] Tests bout-en-bout : signalement → analyse → blockchain → alerte, sur cas réels
- [ ] Démo : page web simple de vérification d'URL (ou extension navigateur si le temps le permet — bonus)
- [ ] Rapport technique : architecture, choix, résultats d'évaluation IA, soutenabilité (coûts gas, scalabilité, limites free tier)
- [ ] Préparation de la soutenance / démo à l'encadrant
- **Livrable :** rapport technique (livrable n°4) + démo fonctionnelle

## 5. Répartition binôme (suggestion)

| | Étudiant A | Étudiant B |
|---|---|---|
| Dominante | **Web3 / Blockchain** | **IA / Orchestration** |
| Phase 1 | Smart contract + tests + déploiement | Relit les tests, prépare le dataset phishing |
| Phase 2 | Scripts ethers.js, aide à l'évaluation | Prompts + évaluation LLM |
| Phase 3 | Workflow 3 (blockchain) + workflow 4 | Workflows 1 & 2 (ingestion + analyse) |
| Phase 4 | Audit smart contract + clés | Durcissement n8n + anti prompt-injection |
| Phase 5 | Rapport (parties 1 & 4) + démo | Rapport (parties 2 & 3) + démo |

> Règle d'or : chacun fait la revue de code de l'autre (pull requests), pour que les deux maîtrisent tout le pipeline avant la soutenance.

## 6. Risques identifiés

| Risque | Mitigation |
|---|---|
| Quota free tier Gemini dépassé | Fallback NVIDIA NIM + cache des analyses déjà faites |
| Faucet Amoy limité | Récupérer des POL test dès la semaine 1, plusieurs faucets |
| Fetch de sites phishing dangereux | Fetch côté serveur uniquement, timeout, pas d'exécution de JS, containerisé |
| Prompt injection via le contenu du site | Contenu balisé comme données non fiables, sortie JSON validée par schéma |
| Retard sur une phase | Les phases 1/2 sont parallélisables ; l'extension navigateur est un bonus sacrifiable |
