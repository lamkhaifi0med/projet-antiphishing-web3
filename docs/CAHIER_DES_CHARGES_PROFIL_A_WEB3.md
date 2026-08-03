# Cahier des charges individuel — Profil A : Web3 / Blockchain & Sécurité

> Version individuelle dérivée du [cahier des charges complet](CAHIER_DES_CHARGES.md). Vous êtes responsable de la chaîne **blockchain** et co-responsable de la **sécurisation**. Votre binôme (Profil B) couvre l'IA et l'orchestration n8n — vous relisez tout son code, il relit tout le vôtre.

> **Mise à jour d'avancement — 03/08/2026 :** la contribution autonome du Profil A est estimée à **environ 95 %**. Le contrat, les scripts, le bridge blockchain sécurisé, WF3, WF4, le durcissement Docker et les tests sont livrés sur `main`. Les workflows restent volontairement inactifs jusqu'à l'intégration de WF1–WF2, la configuration locale des credentials et le test E2E commun.

## 0. État d'avancement vérifié

| Lot Profil A                  | État au 03/08/2026                     | Preuves principales                                                                                                               |
| ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Contrat `PhishingRegistry`    | **Terminé**                            | Déployé et vérifié sur Polygon Amoy ; 13/13 tests ; 100 % lignes et 92,31 % branches                                              |
| Scripts blockchain            | **Terminé**                            | `check`, `report`, `remove`, `batchReport`, `listen`, normalisation, erreurs sûres et réconciliation des publications incertaines |
| Bridge blockchain interne     | **Terminé**                            | Authentification timing-safe, schémas JSON fermés, `spawn` avec `shell: false`, clé Reporter uniquement, aucun port public        |
| WF3 action                    | **Implémenté et validé hors ligne**    | Décision, report/recheck/retry, persistance SQLite, ownership d'exécution, claim Discord et settlement ; export inactif           |
| WF4 check                     | **Implémenté et validé hors ligne**    | `GET /check`, validation stricte, lecture seule du registre et filtrage de la réponse publique ; export inactif                   |
| Sécurité et qualité           | **Terminé pour le périmètre autonome** | Slither sans finding critique/haut/moyen/faible ; 118/118 tests Node ; CI GitHub verte ; smoke test Docker durci réussi           |
| Intégration finale et rapport | **À terminer en binôme**               | Connexion WF1 → WF2 → WF3, credentials locaux, test Polygon Amoy/Discord contrôlé, preuves de démo et sections du rapport final   |

La livraison a été fusionnée dans `main` via la PR GitHub **#1** le 03/08/2026 (merge `cfc85cf`). Elle transforme le verdict probabiliste de l'IA en une action contrôlée, persistante et auditable : l'IA ne possède aucune clé blockchain et ne peut jamais publier directement.

## 1. Votre mission

Concevoir, développer, tester, déployer et sécuriser le smart contract `PhishingRegistry` (blacklist décentralisée d'URLs et de wallets) sur le testnet Polygon Amoy, ainsi que tous les scripts d'interaction utilisés par n8n.

## 2. Vos responsabilités (RACI simplifié)

| Tâche                                               | Vous                                         | Binôme                    |
| --------------------------------------------------- | -------------------------------------------- | ------------------------- |
| Smart contract + tests + déploiement                | **Responsable**                              | Relecteur                 |
| Scripts d'interaction ethers.js                     | **Responsable**                              | Relecteur                 |
| Workflow n8n WF3 (écriture on-chain) et WF4 (check) | **Responsable**                              | Support                   |
| Audit sécurité du contrat + gestion des clés        | **Responsable**                              | Relecteur                 |
| Prompts IA, dataset, évaluation                     | Relecteur                                    | Responsable               |
| Workflows n8n WF1 (ingestion) et WF2 (analyse)      | Support                                      | Responsable               |
| Durcissement n8n + anti prompt-injection            | Relecteur                                    | Responsable               |
| Rapport final                                       | Sections 1 (archi blockchain) & 4 (sécurité) | Sections 2 (IA) & 3 (n8n) |

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

### Extensions de sécurité et de fiabilité effectivement livrées

Le périmètre réalisé dépasse l'appel direct à un script initialement envisagé :

- **Bridge HTTP interne authentifié** — n8n ne monte ni `scripts/` ni `contracts/` et ne reçoit aucune clé privée. Le bridge valide les requêtes puis exécute les scripts avec des arguments séparés et `shell: false`.
- **Principe du moindre privilège** — seule la clé Reporter testnet est injectée dans le bridge. La clé Owner reste hors de n8n et du bridge.
- **Taxonomie d'erreurs fermée** — les messages RPC bruts ne remontent jamais à n8n ; seuls des codes sûrs déterminent si une erreur est transitoire ou permanente.
- **Publication incertaine réconciliée** — après un timeout ou une erreur réseau de publication, WF3 relit la chaîne avant toute nouvelle transaction.
- **Retries bornés** — trois tentatives au maximum, backoff exponentiel d'environ 1 s puis 2 s, jitter ±25 %, aucun retry d'une erreur permanente.
- **Persistance et concurrence** — SQLite conserve le cycle de vie, l'empreinte du contexte et le propriétaire d'exécution. Les transitions et claims utilisent un compare-and-swap atomique.
- **Alerte finale protégée** — un seul claim persistant autorise Discord ; une réponse ambiguë est fermée `uncertain` sans renvoi automatique.
- **Conteneur durci** — utilisateur non-root, système de fichiers en lecture seule, capacités Linux supprimées, `no-new-privileges` et aucun réseau/port public pour le bridge.

La spécification opérationnelle complète se trouve dans le [guide n8n](../n8n/README.md), notamment les sections consacrées au contrat d'erreur, au cycle de vie WF3, à Discord et à l'activation contrôlée.

## 4. Votre planning

| Jours   | Tâches                                                                                                                                                                                                                | Jalon                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| J1–J4   | Installer Node LTS, Git, VS Code + ext. Solidity ; MetaMask (2 comptes : owner, reporter) ; POL test via faucets Amoy ; init Hardhat dans `contracts/` ; se former : Solidity basics, CryptoZombies/Speedrun Ethereum | Env prêt, faucet OK            |
| J5–J6   | Spéc détaillée du contrat (structs, mappings, events) validée avec le binôme                                                                                                                                          | Spéc signée                    |
| J7–J9   | Développement + tests unitaires                                                                                                                                                                                       | Tests verts, couverture ≥ 90 % |
| J10–J11 | Déploiement Amoy + vérification Polygonscan + scripts ethers.js                                                                                                                                                       | **Livrable L2**                |
| J12–J16 | Support binôme : relecture prompts, aide dataset ; script `batchReport` ; écoute d'events                                                                                                                             | —                              |
| J15–J20 | WF4 (check) + fonction de déduplication pour WF1                                                                                                                                                                      | /check opérationnel            |
| J21–J26 | WF3 (écriture on-chain + gestion erreurs + tx hash dans les logs)                                                                                                                                                     | **Livrable L1** (avec binôme)  |
| J25–J31 | Audit Slither, revue manuelle, doc de gestion des clés                                                                                                                                                                | **Livrable L4** (avec binôme)  |
| J32–J40 | Tests E2E, démo, rapport (sections blockchain + sécurité), soutenance                                                                                                                                                 | **L5, L6**                     |

### 4.1 Plan d'exécution détaillé — votre feuille de route

#### Bloc A — Fondations et contrat local (J1–J4)

| Jour | Travail précis                                                                                                                                                              | Résultat vérifiable                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| J1   | Installer/vérifier Node.js, Git, Docker ; créer le dépôt privé et la branche `feat/phishing-registry` ; créer les comptes MetaMask `Owner` et `Reporter`.                   | Outils disponibles, branch créée, transaction Amoy Owner → Reporter confirmée.           |
| J2   | Ajouter Polygon Amoy (chain ID `80002`), obtenir des POL de test ; renseigner `AMOY_RPC_URL` dans `.env` ; relire les sections 8.4 et 8.5 du cahier complet avec le binôme. | Réseau Amoy utilisable ; accord commun sur la normalisation URL et l'interface Solidity. |
| J3   | Initialiser Hardhat TypeScript dans `contracts/` ; installer OpenZeppelin ; écrire la configuration Amoy ; coder le squelette de `PhishingRegistry.sol`.                    | `npm run compile` passe localement.                                                      |
| J4   | Écrire les tests unitaires : rôles, URL, wallets, doublons, suppressions, scores ; lancer la couverture ; soumettre une PR de revue au binôme.                              | `npm test` vert ; couverture lignes ≥ 90 %.                                              |

**État vérifié (03/08/2026) :** les blocs A et B sont terminés. Le côté blockchain du bloc C est également livré : scripts réutilisables, bridge interne, WF3 et WF4, persistance et tests. La baseline sécurité du bloc D est réalisée. Restent les activités communes dépendantes de WF1–WF2 : activation locale, test E2E réel contrôlé, démo et rapport final.

#### Bloc B — Finaliser et déployer le registre (J5–J11)

| Jour | Travail précis                                                                                                                                                                                                     | Commande / preuve attendue                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| J5   | Relire le contrat ligne par ligne avec le binôme : vérifier les rôles, le score `0–100`, les events, l'interdiction d'écrire sans rôle et le comportement des faux positifs. Appliquer les corrections approuvées. | PR revue et fusionnée vers `main`.                                              |
| J6   | Préparer le déploiement : exporter **uniquement** les clés privées `Owner` et `Reporter` dans `.env` ; créer une clé API Polygonscan ; ne jamais copier la phrase de récupération. Vérifier `.gitignore`.          | `.env` complet mais non suivi : `git ls-files` ne doit jamais afficher `.env`.  |
| J7   | Déployer via `npm run deploy:amoy`. Le script déploie avec Owner puis autorise Reporter. Noter l'adresse du contrat, les hashes de transactions et les liens Polygonscan.                                          | `PhishingRegistry` visible dans l'explorer ; `reporters(reporter)` vaut `true`. |
| J8   | Vérifier le code source sur Polygonscan, automatiquement ou avec `npm run verify:amoy -- <ADRESSE> <OWNER_ADDRESS>`. Tester lecture et écriture depuis un script local.                                            | Contrat marqué **Contract Source Code Verified**.                               |
| J9   | Écrire les scripts root `scripts/report.js` et `scripts/check.js` avec ethers v6 : ils appliquent la normalisation, calculent `keccak256`, lisent ou écrivent et retournent du JSON.                               | Une URL de démo peut être reportée puis trouvée par `check.js`.                 |
| J10  | Écrire `scripts/listen.js` (events `URLReported` / `WalletReported`) et documenter les transactions, gas et erreurs réseau.                                                                                        | Listener affiche un event de test.                                              |
| J11  | Préparer le paquet de livraison L2 : URL du contrat, ABI/artefact, commandes, résultats tests/couverture, captures Polygonscan et court guide d'intégration pour le binôme.                                        | **L2 terminé** ; binôme capable d'appeler `check` sans aide.                    |

#### Bloc C — Intégration avec n8n (J12–J26)

| Période | Votre travail                                                                                                                                                                            | Dépendance / sortie                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| J12–J14 | Relire les prompts/dataset du binôme et vérifier que chaque catégorie IA correspond exactement à l'enum `Category`. Ajouter la table de conversion texte → enum dans le script `report`. | Convention de catégories partagée.                         |
| J15–J18 | Stabiliser `check.js` pour produire le contrat de réponse §8.2 : `{blacklisted, category, score, since, txHash}`. Fournir au binôme la commande et l'adresse Amoy.                       | Son WF1 peut dédupliquer avant l'analyse.                  |
| J19–J20 | Ajouter `batchReport.js`, gestion d'erreurs RPC, délai de confirmation et JSON d'erreur sans secret.                                                                                     | Plusieurs signalements peuvent être traités de façon sûre. |
| J21–J23 | Intégrer l'appel à `report.js` dans le WF3 n8n avec le binôme ; valider catégorie, score et hash ; capturer le `txHash`.                                                                 | Signalement IA malveillant → transaction Amoy.             |
| J24–J26 | Test bout-en-bout et gestion des incidents : RPC indisponible, score invalide, doublon, reporter révoqué, fonds test insuffisants.                                                       | **L1** : pipeline relié et rejouable.                      |

#### Bloc D — Audit, rapport et démonstration (J25–J40)

| Période | Votre travail                                                                                                                                             | Preuve                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| J25–J28 | Installer/exécuter Slither ; produire une checklist manuelle : access control, réentrance, validation, DoS/gas, front-running, événements et dépendances. | Rapport d'audit avec chaque alerte : corrigée, acceptée ou non applicable et justification. |
| J29–J31 | Vérifier les secrets (gitleaks ou scan Git), les permissions Owner/Reporter et l'isolation de la clé Reporter dans n8n.                                   | **L4** sécurité terminé.                                                                    |
| J32–J35 | Participer aux tests E2E, vérifier chaque lien `txHash` Discord/Polygonscan et relever gas/latence.                                                       | Scénario démo stable en < 60 s.                                                             |
| J36–J38 | Rédiger vos sections du rapport : architecture blockchain, modèle de données, déploiement, sécurité, coût gas, limites.                                   | Brouillon relu par le binôme.                                                               |
| J39–J40 | Répéter la démo et la soutenance ; expliquer le cycle complet d'une URL jusqu'au event on-chain.                                                          | Démo et rapport final livrés.                                                               |

### 4.2 État vérifié de l'audit du contrat (03/08/2026)

Un premier passage de **Slither 0.11.5** a été exécuté sur le projet Hardhat, avec les dépendances exclues. Résultat : **aucune alerte critique, haute, moyenne ou faible** ; une seule alerte informative `pragma`.

| Contrôle           | Résultat                                                                                | Décision / justification                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versions de pragma | Informationnelle : `PhishingRegistry` utilise `^0.8.24`, OpenZeppelin utilise `^0.8.20` | Acceptée. Les deux plages sont compatibles avec le compilateur Hardhat verrouillé en `0.8.24`. Le pragma du contrat déployé est conservé afin que le dépôt corresponde exactement au code vérifié sur PolygonScan. |
| Contrôle d'accès   | Vérifié par tests                                                                       | `onlyOwner` protège la gestion des reporters et les suppressions ; `onlyReporter` protège les publications.                                                                                                        |
| Réentrance         | Non applicable                                                                          | Le contrat ne fait aucun appel externe et ne transfère aucun fonds.                                                                                                                                                |
| DoS / gas          | Risque faible                                                                           | Aucun tableau itéré ni boucle non bornée ; toutes les écritures sont $O(1)$.                                                                                                                                       |
| Front-running      | Risque faible / accepté                                                                 | Un reporter autorisé peut publier avant un autre, mais il ne modifie ni le verdict stocké ni des fonds.                                                                                                            |
| Faux positifs      | Couvert                                                                                 | Le Owner peut désactiver une entrée ; les events conservent l'historique on-chain.                                                                                                                                 |

Le rapport JSON généré localement par Slither est volontairement ignoré par Git (`contracts/slither-report.json`). La version de l'outil est figée dans `contracts/requirements-audit.txt` pour reproduire le scan. La baseline du contrat est donc terminée ; le scan devra être relancé si le Solidity, OpenZeppelin ou la configuration du compilateur changent. Le rapport technique final devra joindre cette conclusion aux preuves de sécurité du bridge et du test E2E.

#### 4.2.1 Architecture de sécurité du bridge

Le bridge dans `n8n/services/chain-bridge/` constitue la frontière de confiance entre n8n et la blockchain :

1. `/health` ne révèle aucune configuration et les autres routes exigent un bearer token d'au moins 32 caractères comparé de manière timing-safe ;
2. les corps JSON sont bornés, stricts et refusent tout champ inattendu ;
3. `check.js` et `report.js` sont lancés sans shell, avec une allowlist d'arguments et de codes d'erreur ;
4. les erreurs retournées ne contiennent ni détail RPC, ni clé, ni donnée interne non nécessaire ;
5. la clé Reporter est limitée aux publications et la clé Owner est explicitement absente du conteneur ;
6. le service n'expose aucun port hôte et son état SQLite est le seul emplacement persistant en écriture.

#### 4.2.2 Fiabilité de WF3 et unicité des effets externes

WF3 applique une machine à états immuable et persistante. Chaque `reportId` est lié à un contexte SHA-256 exact et, tant qu'un effet reste ouvert, à un seul `executionId` n8n. Une réutilisation incohérente produit un conflit sûr au lieu d'une nouvelle transaction.

Une erreur de publication transitoire déclenche obligatoirement un recheck on-chain avant un retry. Une entrée retrouvée active termine en `already_blacklisted` avec une preuve de transaction historique ; aucune seconde publication n'est envoyée. Pour Discord, seul le gagnant d'un claim SQLite atomique reçoit le payload. La livraison n'est déclarée `sent` qu'après réception d'un identifiant de message Discord valide ; un résultat vide ou ambigu devient `uncertain` sans resend automatique.

### 4.3 Routine de travail et règles de synchronisation

1. Avant de commencer : `git switch feat/phishing-registry`, puis `git pull origin main`.
2. À chaque unité finie : exécuter `npm test` et `npm run coverage`, puis faire un commit atomique.
3. Envoyer une pull request courte ; votre binôme relit le contrat, vous relisez ses changements IA/n8n.
4. Ne modifiez jamais seul les sections 8.1 à 8.7 du cahier complet : elles constituent votre contrat d'intégration.
5. Ne partagez jamais `.env`, clés privées ou seed phrase dans Git, Discord, capture d'écran ou ticket. Seules les adresses publiques et les hashes de transaction peuvent circuler.

### 4.4 Prochaines actions immédiates (dans cet ordre)

- [x] Créer la branche `feat/phishing-registry`.
- [x] Installer Hardhat, OpenZeppelin et les outils de test.
- [x] Implémenter et tester localement `PhishingRegistry`.
- [x] Configurer localement les clés Owner/Reporter et la clé de vérification, sans les commiter.
- [x] Déployer et vérifier le contrat sur Amoy ; fournir l'adresse et les scripts JSON au binôme.
- [x] Valider un flux on-chain : report URL → event → check URL.
- [x] Fusionner le module blockchain dans `main`.
- [x] Valider le cycle de faux positif : report URL → remove URL par Owner → check = non blacklisté.
- [x] Envoyer au binôme l'adresse du registre, le lien Polygonscan et les commandes `chain:check` du README.
- [x] Fournir la pré-vérification blockchain réutilisable destinée à la déduplication de WF1.
- [x] Implémenter le bridge sécurisé, WF3 et WF4 ; conserver les exports inactifs jusqu'à la configuration locale.
- [x] Ajouter les tests hors ligne, la validation des exports, la CI et le smoke test du conteneur durci.
- [ ] Relire et connecter le contrat de sortie de WF2 à l'entrée stricte de WF3 lorsque Profil B livre WF1–WF2.
- [ ] Configurer localement les credentials n8n/Discord et exécuter un E2E contrôlé avec preuves PolygonScan et mesure de latence.
- [ ] Rédiger les sections blockchain et sécurité du rapport final, puis préparer la démonstration commune.

## 5. Vos critères d'acceptation

1. Contrat déployé et **vérifié** sur Polygonscan Amoy.
2. `npx hardhat test` : 100 % des tests passent, couverture ≥ 90 %.
3. Une adresse non-reporter qui appelle `reportURL` est rejetée (test dédié).
4. `check.js` retourne le bon statut pour une entrée blacklistée et une entrée saine.
5. Slither : aucune vulnérabilité critique/haute non justifiée par écrit.
6. Aucun secret dans l'historique Git.

### 5.1 Résultat au 03/08/2026

| Critère individuel                 | Résultat                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Contrat déployé et vérifié         | **Atteint** — Polygon Amoy, adresse `0x8d51dB4a92c338075360A17AcA005ec282fE1f23`, bloc `43090902`                                |
| Tests et couverture du contrat     | **Atteint** — 13/13 tests, 100 % lignes, 92,31 % branches                                                                        |
| Accès non-reporter refusé          | **Atteint** — cas dédié dans les tests Hardhat                                                                                   |
| Lecture blacklistée et saine       | **Atteint** — tests unitaires des entrées URL/wallet et script `check`                                                           |
| Audit Slither                      | **Atteint** — aucune alerte critique, haute, moyenne ou faible ; une information `pragma` justifiée                              |
| Hygiène des secrets                | **Atteint sur l'état courant** — fichiers sensibles ignorés, audit des changements avant PR, aucun secret réel dans la livraison |
| Qualité de la couche d'intégration | **Atteint hors ligne** — 118/118 tests Node et deux jobs CI passés sur la PR #1                                                  |

Ces critères valident le périmètre autonome du Profil A. Ils ne remplacent pas les critères globaux du projet : le pipeline WF1 → WF2 → WF3, Discord, WF4 et la démonstration chronométrée doivent encore être validés ensemble après livraison de Profil B.

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
