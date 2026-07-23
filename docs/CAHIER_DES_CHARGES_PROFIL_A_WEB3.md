# Cahier des charges individuel — Profil A : Web3 / Blockchain & Sécurité

> Version individuelle dérivée du [cahier des charges complet](CAHIER_DES_CHARGES.md). Vous êtes responsable de la chaîne **blockchain** et co-responsable de la **sécurisation**. Votre binôme (Profil B) couvre l'IA et l'orchestration n8n — vous relisez tout son code, il relit tout le vôtre.

## 1. Votre mission

Concevoir, développer, tester, déployer et sécuriser le smart contract `PhishingRegistry` (blacklist décentralisée d'URLs et de wallets) sur le testnet Polygon Amoy, ainsi que tous les scripts d'interaction utilisés par n8n.

## 2. Vos responsabilités (RACI simplifié)

| Tâche | Vous | Binôme |
|---|---|---|
| Smart contract + tests + déploiement | **Responsable** | Relecteur |
| Scripts d'interaction ethers.js | **Responsable** | Relecteur |
| Workflow n8n WF3 (écriture on-chain) et WF4 (check) | **Responsable** | Support |
| Audit sécurité du contrat + gestion des clés | **Responsable** | Relecteur |
| Prompts IA, dataset, évaluation | Relecteur | Responsable |
| Workflows n8n WF1 (ingestion) et WF2 (analyse) | Support | Responsable |
| Durcissement n8n + anti prompt-injection | Relecteur | Responsable |
| Rapport final | Sections 1 (archi blockchain) & 4 (sécurité) | Sections 2 (IA) & 3 (n8n) |

## 3. Vos exigences à implémenter

### Smart contract `PhishingRegistry` (Phase 1, J5–J11)
- **RF-B1** — URLs blacklistées stockées en `keccak256(url normalisée)` — règle de normalisation figée en §8.4 du cahier des charges complet.
- **RF-B2** — Blacklist d'adresses wallet (`address`).
- **RF-B3 à RF-B7** — Implémenter exactement l'interface Solidity figée en §8.5 du cahier des charges complet (enum `Category`, struct `Entry`, signatures des fonctions et events).
- **RF-B8** — Déploiement Amoy + vérification du code source sur Polygonscan.
- **RF-B9** — Scripts Node.js/ethers v6 : `report.js`, `check.js`, `listen.js`, `batchReport.js`.
- **RF-B10** — Tests Hardhat, couverture ≥ 90 % (cas nominaux + accès refusés + doublons + suppression).

### Intégration n8n côté chaîne (Phase 3, J15–J26)
- **RF-N8 (partie chain)** — WF3 : nœud qui appelle votre script/endpoint pour écrire on-chain, récupère le tx hash, gère l'échec (retry, alerte).
- **RF-N10** — WF4 : endpoint `GET /check` conforme à la spéc §8.2 du cahier des charges complet.
- **RF-N4 (partie chain)** — fournir au WF1 de votre binôme la fonction de pré-vérification "déjà blacklisté ?".

### Sécurité (Phase 4, J25–J31)
- **RF-S1** — Clé privée du reporter en `.env` / credentials n8n uniquement ; vérifier le `.gitignore` dès J1.
- **RF-S2** — Deux adresses distinctes : owner (vous, MetaMask) ≠ reporter (n8n).
- **RF-S3** — Audit Slither + revue manuelle : access control, réentrance, DoS par gas, front-running (documenter pourquoi il est ou non applicable).
- **RF-S7** — Scan de secrets avant chaque push (ex. gitleaks).

## 4. Votre planning

| Jours | Tâches | Jalon |
|---|---|---|
| J1–J4 | Installer Node LTS, Git, VS Code + ext. Solidity ; MetaMask (2 comptes : owner, reporter) ; POL test via faucets Amoy ; init Hardhat dans `contracts/` ; se former : Solidity basics, CryptoZombies/Speedrun Ethereum | Env prêt, faucet OK |
| J5–J6 | Spéc détaillée du contrat (structs, mappings, events) validée avec le binôme | Spéc signée |
| J7–J9 | Développement + tests unitaires | Tests verts, couverture ≥ 90 % |
| J10–J11 | Déploiement Amoy + vérification Polygonscan + scripts ethers.js | **Livrable L2** |
| J12–J16 | Support binôme : relecture prompts, aide dataset ; script `batchReport` ; écoute d'events | — |
| J15–J20 | WF4 (check) + fonction de déduplication pour WF1 | /check opérationnel |
| J21–J26 | WF3 (écriture on-chain + gestion erreurs + tx hash dans les logs) | **Livrable L1** (avec binôme) |
| J25–J31 | Audit Slither, revue manuelle, doc de gestion des clés | **Livrable L4** (avec binôme) |
| J32–J40 | Tests E2E, démo, rapport (sections blockchain + sécurité), soutenance | **L5, L6** |

## 5. Vos critères d'acceptation

1. Contrat déployé et **vérifié** sur Polygonscan Amoy.
2. `npx hardhat test` : 100 % des tests passent, couverture ≥ 90 %.
3. Une adresse non-reporter qui appelle `reportURL` est rejetée (test dédié).
4. `check.js` retourne le bon statut pour une entrée blacklistée et une entrée saine.
5. Slither : aucune vulnérabilité critique/haute non justifiée par écrit.
6. Aucun secret dans l'historique Git.

## 6. Compétences à monter (ordre de priorité)

1. **Solidity** : types, mappings, modifiers, events, patterns d'access control.
2. **Hardhat** : tests (chai/mocha), fixtures, déploiement, verify.
3. **ethers.js v6** : providers, wallets, contrats, écoute d'events.
4. **Sécurité smart contracts** : OWASP SC Top 10, Slither, bonnes pratiques OpenZeppelin.

## 7. Ressources

- Docs Solidity + OpenZeppelin Contracts (Ownable, AccessControl)
- Hardhat docs (test, deploy, verify)
- Faucets Polygon Amoy (Alchemy, officiel Polygon)
- Slither (Trail of Bits), Speedrun Ethereum, Secureum (sécurité)
