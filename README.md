# Anti-Phishing Web3 — Bouclier communautaire par IA Générative & Blockchain

Pipeline complet de détection, d'analyse et de blocage automatisé des menaces de phishing Web3 :
**signalement → orchestration n8n → analyse LLM (Gemini, fallback NVIDIA) → blacklist décentralisée on-chain (Polygon Amoy) → alertes Discord → vérification publique**.

Stage de 40 jours — binôme. Voir [PLAN.md](PLAN.md).

## État du projet — 31/08/2026 : pipeline complet opérationnel ✅

Le pipeline E2E est **prouvé en conditions réelles**, plusieurs fois, sur des URLs de phishing actives :

1. **WF1 — Ingestion** : webhook + formulaire, validation stricte, rate limiting, déduplication on-chain (une URL déjà blacklistée ne repart pas en analyse).
2. **WF2 — Analyse** : fetch sandboxé (conteneur dédié, sans exécution JS), features URL déterministes (TLD, âge WHOIS, homoglyphes, **proximité de marque / typosquat** sur 22 marques Web3), analyse LLM structurée (Gemini primaire, NVIDIA NIM fallback), score combiné `0.7×IA + 0.3×features`.
3. **WF3 — Action** : verdict `malicious` avec score ≥ 0,80 → publication on-chain automatique via le chain-bridge ; zone grise → **revue manuelle** ; alerte Discord détaillée avec explication du score en langage simple.
4. **Bot Discord de résolution** : les cas en revue manuelle sont postés dans `#manual-review` avec les boutons **✅ Publier on-chain / ❌ Rejeter**, réservés aux administrateurs. Un clic publie (ou rejette) et met à jour le journal — plus aucun cul-de-sac opérationnel.
5. **WF4 — Vérification** : `GET /check` public (lecture seule on-chain) + portail web de consultation.

Preuves on-chain récentes (URLs de phishing réelles) :

| Cas                                          | Score  | Transaction                                                                                                           |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Phishing Ledger (OpenPhish)                  | 0,865  | [0xf77442ad…86af](https://amoy.polygonscan.com/tx/0xf77442ad3a4a5c447ae0f012b06835e4ae10ca67c7d523a8dd1e0d90ad1c86af) |
| icueoe.top (Ledger phish)                    | ≥ 0,80 | [0x9c73fa5d…77d5](https://amoy.polygonscan.com/tx/0x9c73fa5dd41ff44b30dbbea3c141e6bbee7ba6d64e4991754b2828019e9977d5) |
| pancakeswapo.finance (typosquat PancakeSwap) | 0,803  | [0x56a78903…6949](https://amoy.polygonscan.com/tx/0x56a789033632451c74827e654684efe6e9868720633633f6c40093323fd96949) |

Résultats IA (prompt v2.2 gelé, dataset 72 entrées, Gemini) : **précision 100 %, rappel 80,6 %, F1 89,2 %** — critères d'acceptation atteints (≥ 85 % / ≥ 80 %). Détails dans [ai/prompts/FROZEN_V2_2.md](ai/prompts/FROZEN_V2_2.md) et [ai/eval](ai/eval).

Instructions d'exploitation : [n8n/README.md](n8n/README.md).

## Structure du dépôt

```
├── contracts/   # Hardhat : smart contract PhishingRegistry, tests, déploiement, audit
├── scripts/     # Interaction blockchain (ethers.js) : report, check, listen, remove
├── ai/          # Prompts (v2.2 gelé), client LLM, dataset 72 entrées, évaluations
├── n8n/         # docker-compose (7 services), workflows WF1-WF4, bridge, portail
│   ├── bridge/         # Journal des signalements (JSONL, API authentifiée)
│   ├── capture/        # Fetch sandboxé des sites suspects
│   ├── analysis/       # Features URL + appel LLM
│   ├── proxy/          # Point d'entrée public (nginx, :8080)
│   ├── portal/         # Page web de vérification
│   └── services/
│       ├── chain-bridge/   # Frontière n8n ↔ blockchain (clé Reporter isolée)
│       └── discord-bot/    # Boutons admin de résolution des revues manuelles
├── test/        # Tests Node racine (133) : bridge, lifecycle, WF3, Discord…
└── docs/        # Documents internes au binôme (non versionnés)
```

## Démarrage rapide

Prérequis : Node.js ≥ 22, Docker Desktop, Git.

```bash
# 1. Cloner et installer
git clone <repo-url> && cd projet_stage
npm install

# 2. Configurer les secrets (jamais commités)
copy .env.example .env            # clés RPC + wallets (racine)
copy n8n\.env.example n8n\.env    # clés API IA, secrets services, Discord

# 3. Lancer la stack complète (7 conteneurs)
cd n8n && docker compose up -d

# 4. Vérifier
docker compose ps                  # tous les services doivent être "healthy"
curl http://localhost:8080/health

# 5. Tester le pipeline (URL de démonstration)
curl -X POST http://localhost:8080/webhook/report -H "Content-Type: application/json" ^
  -d "{\"type\":\"url\",\"value\":\"https://demo-phishing.invalid/claim\",\"reporterContact\":\"demo@example.com\"}"

# Tests hors ligne (aucun réseau requis)
cd .. && npm run test:all          # 133 tests racine + suites de tous les services
cd contracts && npm install && npx hardhat test   # 13 tests contrat
```

Le portail de vérification est servi sur `http://localhost:8080/` ; l'interface n8n sur `http://localhost:5678`.

## Contrat déployé — Polygon Amoy

Le registre `PhishingRegistry` est déployé et vérifié publiquement :

| Élément                    | Valeur                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Adresse                    | `0x8d51dB4a92c338075360A17AcA005ec282fE1f23`                                                       |
| Code vérifié               | https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23#code               |
| Transaction de déploiement | https://amoy.polygonscan.com/tx/0x8e2e4e3c73ca2a7a5dd1f35372945c8462c8b6c194db6b36ccc2e93dc46de2dc |
| Bloc de déploiement        | `43090902`                                                                                         |

L'adresse `Reporter` est autorisée à publier les signalements. L'adresse `Owner` reste réservée au déploiement, à la gestion des reporters et à la correction des faux positifs.

Test d'intégration du cycle on-chain réalisé avec l'URL réservée `demo-phishing.invalid/wallet-drainer` : https://amoy.polygonscan.com/tx/0x208b9ccdfe1f0daf464321e571b341b280694c4bfc364d590267794c50a33943. Le test E2E commun WF1 → WF2 → WF3 → Discord → WF4 a depuis été réalisé plusieurs fois sur des cas réels (voir les preuves en tête de ce document). Cette entrée est une donnée de démonstration, pas une URL de phishing réelle.

Le cycle de correction d'un faux positif a aussi été validé avec `false-positive.invalid/remove-me` : [signalement](https://amoy.polygonscan.com/tx/0xde03a89b43467363178faf145a0b74bb96a5a599b1f0af875d3c83dae1d4b459) puis [désactivation par Owner](https://amoy.polygonscan.com/tx/0x55cad45e7f376143dbaf67cb53546fef805a5e026d64151419c6cac303ade17c). Cette URL réservée `.invalid` n'est pas une menace réelle.

## Architecture d'intégration

n8n n'exécute jamais directement un shell blockchain et ne monte pas les scripts de l'hôte. Il appelle un service `chain-bridge` interne authentifié, qui valide des schémas JSON fermés puis lance les scripts avec `spawn` et `shell: false`. Seule la clé Reporter testnet entre dans ce conteneur ; la clé Owner reste hors de n8n.

| Composant          | Rôle                                                                     | État                         |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------- |
| `PhishingRegistry` | Registre on-chain vérifiable des URLs et wallets actifs                  | Déployé, vérifié, alimenté   |
| Proxy nginx        | Point d'entrée public unique (:8080), rate limiting                      | En production locale         |
| WF1 / WF2          | Ingestion, déduplication, capture sandboxée et analyse IA                | Opérationnels (live E2E)     |
| WF3                | Décision, publication/recheck/retry, cycle persistant et alertes Discord | Opérationnel (live E2E)      |
| WF4                | `GET /check`, lecture seule on-chain et réponse publique filtrée         | Opérationnel (live E2E)      |
| Chain bridge       | Frontière sécurisée entre n8n, les clés et les scripts ethers.js         | Opérationnel (SQLite CAS)    |
| Bridge journal     | Journal JSONL des signalements, API authentifiée + flux public borné     | Opérationnel                 |
| Bot Discord        | Résolution des revues manuelles par boutons admin (publier / rejeter)    | Opérationnel (testé en réel) |
| Portail            | Page web publique de vérification d'URL/wallet                           | Opérationnel                 |

WF3 applique les seuils suivants : verdict `malicious` avec `scoreFinal ≥ 0,80` → publication ; `suspicious` ou `malicious` entre `0,50` et `0,79` → revue manuelle ; `legitimate` ou score inférieur à `0,50` → journalisation sans transaction.

### Revue manuelle — bot Discord

Chaque cas en zone grise est posté dans le canal `#manual-review` avec le détail complet (cible défangée, verdict IA, indicateurs, explication du score en langage simple) et deux boutons réservés aux administrateurs :

- **✅ Publier on-chain** : refang de l'URL, publication via le chain-bridge (mêmes garanties que WF3 : retries, relecture on-chain), puis mise à jour du journal avec le hash de transaction. Une cible déjà au registre est reconnue (`already_blacklisted`) sans double transaction.
- **❌ Rejeter** : statut `dismissed` dans le journal, aucune transaction.

Le bot est un service autonome **sans dépendance npm** (WebSocket et fetch natifs Node 22), protégé contre le double-clic (relecture de l'état avant chaque action) et ne postant jamais deux fois le même cas.

## Scripts blockchain (intégration n8n)

À la racine, exécuter une fois `npm install`. Tous les scripts renvoient **un JSON sur stdout**. En production locale, ils sont consommés uniquement par le bridge interne ; n8n ne doit pas utiliser de nœud `Execute Command` pour les lancer.

```bash
# Vérification sans écriture : à utiliser par WF1 et WF4
npm run chain:check -- -- --type=url --value=https://demo-phishing.invalid/claim
npm run chain:check -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD

# Publication (WF3) — uniquement si le score final est ≥ 0.8
npm run chain:report -- -- --type=url --value=https://demo-phishing.invalid/claim --category=fake_airdrop --score=92
npm run chain:report -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD --category=wallet_drainer --score=98

# Correction d'un faux positif — action Owner uniquement, jamais exécutée par n8n
npm run chain:remove -- -- --type=url --value=https://demo-phishing.invalid/claim
npm run chain:remove -- -- --type=wallet --value=0x000000000000000000000000000000000000dEaD

# Publication séquentielle à partir d'un fichier JSON contenant [{"type", "value", "category", "score"}]
npm run chain:batch-report -- -- --file=./reports.json

# Events passés depuis le bloc de déploiement ; ajouter --follow pour écouter les nouveaux
npm run chain:listen
npm run chain:listen -- -- --follow
```

> Avec npm, les trois séparateurs `-- -- --` sont nécessaires pour transmettre des options commençant par `--` au script Node.js dans cet environnement. Le bridge appelle directement le fichier Node avec des arguments séparés ; ne pas recréer cet appel avec un nœud n8n `Execute Command`.

`chain:remove` est une commande d'administration réservée au Owner. Elle désactive une entrée active et renvoie le hash de transaction ; l'event on-chain conserve l'historique du signalement. Une entrée qui n'est déjà plus blacklistée retourne `not_blacklisted` sans envoyer de transaction.

Exemple de contenu pour `reports.json` :

```json
[
  {
    "type": "url",
    "value": "https://demo-phishing.invalid/claim",
    "category": "fake_airdrop",
    "score": 92
  }
]
```

Catégories autorisées : `fake_exchange`, `wallet_drainer`, `fake_airdrop`, `fake_support`, `ponzi`, `other`. Le score est un entier de `0` à `100` et doit venir du workflow après conversion de la confiance IA.

La normalisation URL appliquée avant `keccak256` suit le cahier des charges : schéma supprimé, domaine en minuscules, préfixe `www.` supprimé, query string/fragment/trailing slash supprimés, path conservé. Ex. `HTTPS://www.Demo-Phishing.invalid/claim/?ref=x#top` devient `demo-phishing.invalid/claim`.

## Qualité vérifiée

- **13/13 tests Hardhat** ; couverture du contrat : **100 % lignes / 92,31 % branches**.
- **133/133 tests Node racine** + suites dédiées par service (bridge, capture, analyse, bot Discord, workflows) — tous hors ligne, aucun réseau requis.
- **Évaluation IA gelée et reproductible** : dataset 72 entrées, prompt v2.2, précision 100 % / rappel 80,6 % / F1 89,2 % (Gemini primaire) ; fallback NVIDIA benchmarké. Test automatisé de résistance au prompt-injection (RF-A7).
- **Slither 0.11.5** : aucune alerte critique, haute, moyenne ou faible ; une information `pragma` justifiée.
- **CI GitHub** : compilation, tests/couverture Hardhat, syntaxe JavaScript, tests Node et audit des dépendances.
- **Conteneurs durcis** : non-root, lecture seule, capabilities supprimées, `no-new-privileges`, réseaux internes segmentés (le journal et les clés ne sont jamais exposés publiquement).

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
- La clé **Owner** n'entre jamais dans n8n ni dans le bridge ; seule la clé **Reporter** testnet est injectée dans le service interne.
- Le bridge refuse les champs inconnus, borne les requêtes, masque les erreurs RPC et exécute les scripts sans shell.
- SQLite impose l'idempotence et un compare-and-swap atomique pour éviter les transactions ou alertes Discord concurrentes.
- Une publication blockchain incertaine est toujours relue on-chain avant toute nouvelle tentative.
