# Anti-Phishing Web3 — Bouclier communautaire par IA Générative & Blockchain

Prototype de détection, d'analyse et de blocage automatisé des menaces de phishing Web3 :
**signalement → orchestration n8n → analyse LLM (Gemini) → blacklist décentralisée on-chain (Polygon Amoy) → alertes Discord**.

Stage de 40 jours — binôme. Voir [PLAN.md](PLAN.md) et [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md).

## Structure du dépôt

```
├── contracts/   # Hardhat : smart contract PhishingRegistry, tests, déploiement
├── scripts/     # Interaction blockchain (ethers.js) : report, check, listen
├── ai/          # Templates de prompts, dataset d'évaluation, scripts d'éval
├── n8n/         # docker-compose.yml + workflows exportés (JSON)
└── docs/        # Cahiers des charges, présentation, rapport
```

## Démarrage rapide

Prérequis : Node.js ≥ 22, Docker Desktop, Git.

```bash
# 1. Cloner et installer
git clone <repo-url> && cd projet_stage

# 2. Configurer les secrets (jamais commités)
copy .env.example .env    # puis remplir les valeurs

# 3. Lancer n8n
cd n8n && docker compose up -d

# 4. Compiler et tester le contrat
cd contracts && npm install && npx hardhat test
```

## Réseau blockchain

| Paramètre | Valeur                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| Réseau    | Polygon Amoy (testnet)                                                                   |
| Chain ID  | 80002                                                                                    |
| RPC       | `https://polygon-amoy-bor-rpc.publicnode.com` (backup : `https://polygon-amoy.drpc.org`) |
| Explorer  | https://amoy.polygonscan.com                                                             |

> ⚠️ Testnet uniquement. Aucun fonds réel ne doit transiter par les wallets du projet.

## Sécurité

- Les secrets vivent dans `.env` (voir `.env.example`) — jamais dans le code ni dans Git.
- Deux adresses distinctes : **Owner** (admin du contrat) et **Reporter** (utilisée par n8n, privilèges minimaux).
- Voir la section Sécurisation du [cahier des charges](docs/CAHIER_DES_CHARGES.md).
