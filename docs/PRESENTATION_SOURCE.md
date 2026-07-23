# Anti-Phishing Web3 — Bouclier communautaire par IA Générative & Blockchain

> Document source pour génération de slides (Gamma / Tome / SlidesAI).
> Public : encadrant de stage + jury technique. Ton : professionnel, technique mais accessible. Langue : français.
> ~15 slides. Chaque section H2 = 1 slide. Les instructions visuelles sont entre [crochets].

---

## Slide 1 — Titre

**Lutte automatisée contre le Phishing et les fraudes Web3**
Intégration de l'IA Générative et de la Blockchain

Stage de 40 jours — Binôme — Juillet-Septembre 2026
[Visuel : bouclier numérique, thème sombre, accents violet/cyan Web3]

## Slide 2 — Le problème

- Explosion du phishing Web3 : faux exchanges, dapps malveillantes, faux supports, wallet drainers, fake airdrops
- Des campagnes qui durent **moins de 24 h** — les blacklists traditionnelles, centralisées et manuelles, arrivent trop tard
- En 2025 : des milliards de dollars perdus en actifs numériques à cause de l'ingénierie sociale
- Une victime signale… mais l'information ne protège personne d'autre

[Visuel : chronologie d'une attaque vs délai de blocage classique]

## Slide 3 — Notre réponse

Un **bouclier communautaire, automatisé et infalsifiable** :

- **L'IA générative** qualifie la menace en quelques secondes (agilité)
- **La blockchain** publie le verdict dans un registre décentralisé, immuable, consultable par tous (confiance)
- **L'orchestration** relie tout sans intervention humaine (vitesse)

Un signalement → une analyse → une protection pour toute la communauté.

## Slide 4 — Le pipeline en un coup d'œil

1. **Signalement** : formulaire public ou webhook API
2. **Orchestration n8n** : validation, déduplication, récupération du site suspect
3. **Analyse IA (Gemini)** : URL + code source + contenu sémantique → verdict JSON
4. **Blockchain (Polygon testnet)** : inscription dans la blacklist décentralisée
5. **Alerte** : notification Discord à la communauté en < 60 secondes
6. **Vérification** : n'importe qui peut interroger la blacklist on-chain

[Visuel : diagramme de flux horizontal avec ces 6 étapes]

## Slide 5 — Architecture technique

```
Signalement (formulaire / webhook)
        ↓
n8n (Docker) — 4 workflows : ingestion, analyse, action, vérification
        ↓                              ↓
Gemini API (+ fallback NVIDIA)    PhishingRegistry.sol
Analyse cognitive                 Polygon Amoy (testnet)
        ↓                              ↓
Alerte Discord                    Lecture publique gratuite
```

Stack : Solidity + Hardhat, ethers.js, n8n, Gemini API, NVIDIA NIM, Docker
Coût de fonctionnement : **0 €** (free tiers + testnet)

## Slide 6 — Axe 1 : Orchestration (n8n)

- **WF1 Ingestion** : webhook `POST /report` + formulaire — validation, normalisation, déduplication on-chain
- **WF2 Analyse** : fetch sécurisé du site (sans exécution JS), extraction de features URL, appel LLM, score agrégé
- **WF3 Action** : écriture sur le smart contract + alerte Discord enrichie
- **WF4 Vérification** : `GET /check` — statut on-chain de n'importe quelle URL/wallet

Gestion d'erreurs : retries, file de revue manuelle pour les cas ambigus

## Slide 7 — Axe 2 : Analyse cognitive (IA générative)

Trois angles d'analyse par prompts spécialisés :
- **URL** : typosquatting (blnance vs binance), homoglyphes, TLD suspects
- **Code source** : formulaires de seed phrase, scripts drainers, clones de sites
- **Sémantique** : urgence artificielle, faux support, promesses de rendement

Sortie JSON stricte : verdict, confiance, catégorie, indicateurs, explication
Gemini en principal, modèles NVIDIA en fallback — évalués sur un dataset de 60+ URLs
**Objectif : précision ≥ 85 %, rappel ≥ 80 %**

## Slide 8 — Axe 3 : Partage immuable (Blockchain)

Smart contract **PhishingRegistry** (Solidity, Polygon Amoy testnet) :
- Blacklist d'URLs (hash keccak256) et d'adresses de wallets
- Métadonnées : catégorie de fraude, score, horodatage, reporter
- Contrôle d'accès : seuls les reporters autorisés écrivent, l'admin gère les faux positifs
- **Lecture publique et gratuite** — toute dapp, wallet ou extension peut consulter la liste
- Events indexés : tout l'historique est auditable

[Visuel : icône de chaîne + cadenas, capture Polygonscan]

## Slide 9 — Axe 4 : Sécurisation

Le projet protège les autres — il doit d'abord se protéger lui-même :
- **Clés privées** : jamais dans le code, credentials chiffrés, séparation reporter/admin
- **Audit du smart contract** : Slither + revue manuelle documentée
- **Anti prompt-injection** : le contenu des sites analysés est traité comme donnée hostile — un site piégé ne peut pas manipuler son propre verdict
- **Durcissement n8n** : authentification, validation des entrées, rate limiting

## Slide 10 — Scénario démo

1. Un utilisateur reçoit un DM : « Claim your Binance airdrop → blnance-support.xyz »
2. Il colle l'URL dans notre formulaire (10 secondes)
3. L'IA détecte : typosquatting + formulaire de seed phrase → **wallet_drainer, confiance 94 %**
4. L'URL est hashée et inscrite on-chain — transaction visible sur Polygonscan
5. Alerte Discord : URL défangée, catégorie, indicateurs, lien de vérification
6. Toute personne qui vérifie cette URL est désormais avertie — **en moins de 60 secondes**

## Slide 11 — Livrables (40 jours)

| Livrable | Échéance |
|---|---|
| Smart contract déployé et vérifié sur testnet + scripts | J11 |
| Module IA : prompts optimisés + rapport d'évaluation | J16 |
| 4 workflows n8n opérationnels interconnectés | J26 |
| Audit de sécurité et durcissement | J31 |
| Rapport technique + démo bout-en-bout | J40 |

## Slide 12 — Planning et organisation

[Visuel : frise Gantt simplifiée]
- **Phase 0** (J1-J4) : environnement, clés API, formation croisée
- **Phases 1 & 2 en parallèle** (J5-J16) : smart contract ↔ module IA
- **Phase 3** (J15-J26) : workflows n8n, intégration
- **Phases 4 & 5** (J25-J40) : sécurisation, tests E2E, rapport

Binôme complémentaire : un profil **Web3/Blockchain**, un profil **IA/Orchestration** — revue croisée systématique par pull requests

## Slide 13 — Mesure du succès

- Signalement → alerte en **< 60 secondes**, sans intervention humaine
- Précision IA **≥ 85 %**, rappel **≥ 80 %** sur dataset réel (PhishTank, CryptoScamDB)
- Contrat vérifié publiquement, tests avec couverture **≥ 90 %**
- **Zéro vulnérabilité critique** non traitée, zéro secret exposé
- Reproductible en une commande : `docker compose up`

## Slide 14 — Perspectives d'évolution

- **Extension navigateur** : blocage en temps réel pendant la navigation
- **Flux automatiques** : ingestion de sources publiques (PhishTank, certstream)
- **Gouvernance communautaire** : réputation des reporters, votes de contestation
- **Mainnet** : déploiement réel avec modèle économique (staking anti-spam)
- Le registre étant public et on-chain : **n'importe qui peut construire dessus**

## Slide 15 — Conclusion

Un prototype qui prouve qu'on peut combiner :
- la **vitesse** de l'IA générative,
- la **confiance** de la blockchain,
- l'**automatisation** de l'orchestration moderne,

pour transformer chaque signalement individuel en protection collective.

**Merci — questions ?**
[Visuel : reprise du bouclier du slide 1]
