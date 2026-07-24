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

## Contrat déployé — Polygon Amoy

Le registre `PhishingRegistry` est déployé et vérifié publiquement :

| Élément                    | Valeur                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Adresse                    | `0x8d51dB4a92c338075360A17AcA005ec282fE1f23`                                                       |
| Code vérifié               | https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23#code               |
| Transaction de déploiement | https://amoy.polygonscan.com/tx/0x8e2e4e3c73ca2a7a5dd1f35372945c8462c8b6c194db6b36ccc2e93dc46de2dc |
| Bloc de déploiement        | `43090902`                                                                                         |

L'adresse `Reporter` est autorisée à publier les signalements. L'adresse `Owner` reste réservée au déploiement, à la gestion des reporters et à la correction des faux positifs.

Test bout-en-bout on-chain réalisé avec l'URL réservée `demo-phishing.invalid/wallet-drainer` : https://amoy.polygonscan.com/tx/0x208b9ccdfe1f0daf464321e571b341b280694c4bfc364d590267794c50a33943. Cette entrée est volontairement une donnée de démonstration, pas une URL de phishing réelle.

Le cycle de correction d'un faux positif a aussi été validé avec `false-positive.invalid/remove-me` : [signalement](https://amoy.polygonscan.com/tx/0xde03a89b43467363178faf145a0b74bb96a5a599b1f0af875d3c83dae1d4b459) puis [désactivation par Owner](https://amoy.polygonscan.com/tx/0x55cad45e7f376143dbaf67cb53546fef805a5e026d64151419c6cac303ade17c). Cette URL réservée `.invalid` n'est pas une menace réelle.

## Scripts blockchain (intégration n8n)

À la racine, exécuter une fois `npm install`. Tous les scripts renvoient **un JSON sur stdout**, pour une utilisation directe depuis un nœud n8n `Execute Command`.

```bash
# Vérification sans écriture : à utiliser par WF1 et WF4
npm run chain:check -- -- --type=url --value=https://blnance-support.xyz/claim
npm run chain:check -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD

# Publication (WF3) — uniquement si le score final est ≥ 0.8
npm run chain:report -- -- --type=url --value=https://blnance-support.xyz/claim --category=fake_airdrop --score=92
npm run chain:report -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD --category=wallet_drainer --score=98

# Correction d'un faux positif — action Owner uniquement, jamais exécutée par n8n
npm run chain:remove -- -- --type=url --value=https://blnance-support.xyz/claim
npm run chain:remove -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD

# Publication séquentielle à partir d'un fichier JSON contenant [{"type", "value", "category", "score"}]
npm run chain:batch-report -- -- --file=./reports.json

# Events passés depuis le bloc de déploiement ; ajouter --follow pour écouter les nouveaux
npm run chain:listen
npm run chain:listen -- -- --follow
```

> Avec npm, les trois séparateurs `-- -- --` sont nécessaires pour transmettre des options commençant par `--` au script Node.js. Dans un nœud n8n `Execute Command`, appeler directement `node scripts/check.js --type=url --value=...` évite cette particularité de npm.

`chain:remove` est une commande d'administration réservée au Owner. Elle désactive une entrée active et renvoie le hash de transaction ; l'event on-chain conserve l'historique du signalement. Une entrée qui n'est déjà plus blacklistée retourne `not_blacklisted` sans envoyer de transaction.

Exemple de contenu pour `reports.json` :

```json
[
  {
    "type": "url",
    "value": "https://blnance-support.xyz/claim",
    "category": "fake_airdrop",
    "score": 92
  }
]
```

Catégories autorisées : `fake_exchange`, `wallet_drainer`, `fake_airdrop`, `fake_support`, `ponzi`, `other`. Le score est un entier de `0` à `100` et doit venir du workflow après conversion de la confiance IA.

La normalisation URL appliquée avant `keccak256` suit le cahier des charges : schéma supprimé, domaine en minuscules, préfixe `www.` supprimé, query string/fragment/trailing slash supprimés, path conservé. Ex. `HTTPS://www.Blnance-Support.xyz/claim/?ref=x#top` devient `blnance-support.xyz/claim`.

## Réseau blockchain

| Paramètre | Valeur                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| Réseau    | Polygon Amoy (testnet)                                                                   |
| Chain ID  | 80002                                                                                    |
| RPC       | `https://polygon-amoy.drpc.org` (backup : `https://polygon-amoy-bor-rpc.publicnode.com`) |
| Explorer  | https://amoy.polygonscan.com                                                             |

> ⚠️ Testnet uniquement. Aucun fonds réel ne doit transiter par les wallets du projet.

## Sécurité

- Les secrets vivent dans `.env` (voir `.env.example`) — jamais dans le code ni dans Git.
- Deux adresses distinctes : **Owner** (admin du contrat) et **Reporter** (utilisée par n8n, privilèges minimaux).
- Voir la section Sécurisation du [cahier des charges](docs/CAHIER_DES_CHARGES.md).
