# Guide d'intégration pour le binôme — IA & n8n

**Projet :** Anti-Phishing Web3 — IA Générative & Blockchain  
**Destinataire :** Responsable IA / n8n (Profil B)  
**But :** intégrer tes workflows n8n à la blacklist blockchain déjà opérationnelle, sans modifier les interfaces convenues ni exposer de secrets.

---

## 1. Ce qui est déjà prêt côté blockchain

Le module blockchain est terminé et fusionné dans la branche `main`.

| Élément | Statut | Détail |
|---|---|---|
| Smart contract `PhishingRegistry` | Prêt | Blacklist d'URLs hachées et d'adresses wallet |
| Réseau | Prêt | Polygon Amoy testnet — Chain ID `80002` |
| Contrat public | Déployé et vérifié | `0x8d51dB4a92c338075360A17AcA005ec282fE1f23` |
| Code source public | Vérifié | https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23#code |
| Permissions | Prêtes | Owner = administration ; Reporter = publication des signalements |
| Scripts Node.js | Prêts | `check`, `report`, `batchReport`, `listen`, `remove` |
| Tests smart contract | Prêts | 13 tests, 100 % couverture lignes, 92,31 % branches |
| Audit initial | Prêt | Slither : 0 alerte critique / haute / moyenne / faible |

**Ne redéploie pas le contrat.** Tous les workflows doivent utiliser l'adresse ci-dessus.

---

## 2. Installation minimale pour travailler avec la blockchain

Depuis la racine du dépôt :

```bash
git pull origin main
npm install
```

Pour compiler ou tester le contrat si nécessaire :

```bash
cd contracts
npm install
npm test
```

La configuration blockchain publique est déjà dans `.env.example` :

```text
AMOY_RPC_URL=https://polygon-amoy.drpc.org
REGISTRY_CONTRACT_ADDRESS=0x8d51dB4a92c338075360A17AcA005ec282fE1f23
REGISTRY_DEPLOYMENT_BLOCK=43090902
```

### Secrets : règles strictes

| Besoin | Secret requis ? | Règle |
|---|---:|---|
| WF1 déduplication | Non | Lecture blockchain seulement |
| WF4 endpoint `/check` | Non | Lecture blockchain seulement |
| WF3 publication on-chain | Oui : `REPORTER_PRIVATE_KEY` | Configurer uniquement dans un credential n8n chiffré ou un `.env` local non versionné |
| Administration / suppression d'un faux positif | Oui : `OWNER_PRIVATE_KEY` | Réservé à Profil A ; ne jamais mettre cette clé dans n8n |

Ne jamais envoyer une clé privée dans GitHub, Discord, un fichier `.txt`, un workflow exporté, une capture d'écran ou un message.

---

## 3. Contrat de données partagé : à respecter exactement

### 3.1 Types acceptés

```text
url
wallet
```

### 3.2 Catégories acceptées par la blockchain

Le champ `category` envoyé à `report.js` doit être **exactement** l'une de ces valeurs :

```text
fake_exchange
wallet_drainer
fake_airdrop
fake_support
ponzi
other
```

Correspondance on-chain :

| Catégorie IA/n8n | Enum Solidity |
|---|---:|
| `fake_exchange` | `0` |
| `wallet_drainer` | `1` |
| `fake_airdrop` | `2` |
| `fake_support` | `3` |
| `ponzi` | `4` |
| `other` | `5` |

Les valeurs comme `scam`, `phishing`, `drainer`, `legitimate` ou `unknown` ne doivent **jamais** être envoyées à `report.js`.

### 3.3 Sortie IA attendue

Ton module IA doit retourner ce schéma :

```json
{
  "verdict": "malicious",
  "confidence": 0.94,
  "category": "wallet_drainer",
  "indicators": [
    "Formulaire demandant la seed phrase",
    "Domaine typosquatté"
  ],
  "explanation": "Explication courte de la menace."
}
```

Contraintes :
- `verdict` : `malicious`, `suspicious` ou `legitimate`
- `confidence` : nombre entre `0` et `1`
- `category` : une des six catégories blockchain ci-dessus si `verdict = malicious`
- `indicators` : tableau de preuves lisibles
- `explanation` : 2–3 phrases maximum

### 3.4 Conversion du score

La décision finale définie dans le cahier des charges est :

$$score_{final}=0.7\times confidence_{LLM}+0.3\times score_{featuresURL}$$

Puis, avant la blockchain :

```text
scoreOnChain = Math.round(scoreFinal * 100)
```

| Condition | Action n8n |
|---|---|
| `verdict = malicious` ET `scoreFinal >= 0.80` | Appeler `report.js` puis envoyer l'alerte Discord |
| `scoreFinal` entre `0.50` et `0.79` | Canal Discord de revue manuelle ; pas de transaction |
| `scoreFinal < 0.50` ou `verdict = legitimate` | Journaliser seulement ; pas de transaction |

---

## 4. Règle obligatoire de normalisation des URLs

**Toujours donner l'URL brute complète au script `check.js` ou `report.js`.** Le script applique lui-même la normalisation et le hash `keccak256`. Ne calcule pas un hash différent dans n8n.

Règles appliquées par le script :

1. Accepte uniquement `http://` et `https://`.
2. Convertit le domaine en minuscules.
3. Supprime le protocole.
4. Supprime le préfixe `www.`.
5. Supprime query string, fragment et slash final.
6. Conserve le path.
7. Hash le résultat en UTF-8 avec `keccak256`.

Exemple :

```text
HTTPS://www.Blnance-Support.xyz/claim/?ref=x#top
→ blnance-support.xyz/claim
→ keccak256(...)
```

Cette règle garantit qu'une URL avec des majuscules ou paramètres différents retrouve la même entrée blacklistée.

---

## 5. Scripts disponibles et formats JSON

Les commandes suivantes s'exécutent depuis la **racine du dépôt**.

> Dans n8n, il vaut mieux appeler directement `node scripts/...` que `npm run ...`, afin d'éviter les séparateurs supplémentaires de npm.

### 5.1 Vérifier une URL ou un wallet — `check.js`

Utilisé par : **WF1 (déduplication)** et **WF4 (endpoint public)**.

```bash
node scripts/check.js --type=url --value=https://example.com/claim
node scripts/check.js --type=wallet --value=0x000000000000000000000000000000000000dEaD
```

URL non blacklistée — sortie interne :

```json
{
  "blacklisted": false,
  "type": "url",
  "normalizedValue": "example.com/claim",
  "urlHash": "0x..."
}
```

URL blacklistée — sortie interne :

```json
{
  "blacklisted": true,
  "type": "url",
  "normalizedValue": "example.com/claim",
  "urlHash": "0x...",
  "category": "fake_airdrop",
  "score": 92,
  "since": "2026-07-24T16:17:39.000Z",
  "reporter": "0x...",
  "active": true,
  "txHash": "0x..."
}
```

**Réponse publique obligatoire de WF4** — ne pas exposer `urlHash`, `reporter` ou `active` :

```json
{
  "blacklisted": true,
  "category": "fake_airdrop",
  "score": 92,
  "since": "2026-07-24T16:17:39.000Z",
  "txHash": "0x..."
}
```

Pour une entrée saine, WF4 renvoie uniquement :

```json
{ "blacklisted": false }
```

### 5.2 Publier un signalement — `report.js`

Utilisé par : **WF3 uniquement**, lorsque la condition `malicious` + score final ≥ 0,80 est remplie.

```bash
node scripts/report.js --type=url --value=https://example.com/claim --category=fake_airdrop --score=92
node scripts/report.js --type=wallet --value=0x000000000000000000000000000000000000dEaD --category=wallet_drainer --score=98
```

Sortie si une transaction est envoyée :

```json
{
  "status": "reported",
  "type": "url",
  "normalizedValue": "example.com/claim",
  "category": "fake_airdrop",
  "score": 92,
  "reporter": "0x...",
  "txHash": "0x...",
  "explorerUrl": "https://amoy.polygonscan.com/tx/0x..."
}
```

Sortie si une entrée est déjà active (aucune seconde transaction) :

```json
{
  "status": "already_blacklisted",
  "type": "url",
  "normalizedValue": "example.com/claim",
  "category": "fake_airdrop",
  "score": 92,
  "since": "..."
}
```

Dans ce second cas, traiter le résultat comme un succès de déduplication. Pour afficher le hash de la transaction historique dans Discord, appeler ensuite `check.js`.

### 5.3 Écouter les événements — `listen.js`

```bash
node scripts/listen.js
node scripts/listen.js --follow
```

Utilité : diagnostic, démonstration ou suivi des events `URLReported`, `WalletReported`, `EntryRemoved`.

### 5.4 Correction d'un faux positif — `remove.js`

```bash
node scripts/remove.js --type=url --value=https://example.com/claim
```

**Ne pas appeler cette commande dans n8n.** Elle utilise la clé Owner, est réservée à Profil A et exige une décision humaine.

---

## 6. Plan d'intégration n8n commun

### WF1 — Ingestion et déduplication

**Responsable principal :** Profil B  
**Support blockchain :** Profil A

```text
Webhook / formulaire
→ validation de type et valeur
→ appel check.js
→ blacklisted ?
   ├─ oui : répondre 409 + résultat existant, ne pas appeler l'IA
   └─ non : continuer vers WF2
```

Valider avant toute exécution :
- `type` est uniquement `url` ou `wallet` ;
- une URL a un protocole HTTP(S) ;
- un wallet est une adresse EVM valide ;
- toute donnée utilisateur est traitée comme donnée, jamais comme instruction shell.

### WF2 — Analyse IA

**Responsable principal :** Profil B  
**Support de Profil A :** vérifier les catégories et le score fournis à WF3.

```text
URL/wallet non blacklisté
→ extraction de contenu / features
→ Gemini (fallback NVIDIA si besoin)
→ validation du JSON IA
→ calcul du score final
→ décision
```

### WF3 — Publication blockchain + Discord

**Responsable :** partagé

```text
Verdict IA malicious + score final >= 0.80
→ valider category et scoreOnChain (0–100)
→ appeler report.js avec REPORTER_PRIVATE_KEY
→ attendre le JSON result
→ si reported : stocker txHash + alerte Discord
→ si already_blacklisted : appeler check.js puis alerter avec le txHash historique
→ si error : retry (3 fois avec backoff) ; notifier l'échec sans marquer l'entrée comme publiée
```

**Discord doit contenir :** URL/wallet défangé, verdict, catégorie, score, 3 indicateurs maximum, `txHash` / lien PolygonScan, `reportId`, timestamp.

### WF4 — Endpoint public de vérification

**Responsable :** partagé

```text
GET /check?type=url&value=...
→ validation
→ check.js
→ filtrer les champs internes
→ réponse JSON publique
```

La réponse publique doit respecter la section 5.1 de ce document et §8.2 du cahier des charges.

---

## 7. Tests de compatibilité à exécuter

Utiliser exclusivement des domaines réservés `.invalid`, jamais un site phishing réel.

| Test | Commande / entrée | Résultat attendu |
|---|---|---|
| URL saine | `https://safe-example.invalid/not-listed` | `{ "blacklisted": false }` |
| URL déjà blacklistée | `https://demo-phishing.invalid/wallet-drainer` | `blacklisted: true`, catégorie `other`, score `100` |
| Normalisation | `HTTPS://www.DEMO-PHISHING.invalid/wallet-drainer/?x=1#top` | Même résultat que l'URL blacklistée |
| Mauvais type | `type=email` | erreur contrôlée, aucune transaction |
| URL invalide | `value=not-a-url` | erreur contrôlée, aucune transaction |
| Mauvaise catégorie | `category=scam` | erreur contrôlée, aucune transaction |
| Score invalide | `score=101` | erreur contrôlée, aucune transaction |
| Doublon pendant WF3 | publier deux fois la même URL | seconde réponse : `already_blacklisted`, pas de nouvelle transaction |

---

## 8. Sécurité d'intégration obligatoire

1. **Owner ≠ Reporter** : n8n ne doit jamais posséder `OWNER_PRIVATE_KEY`.
2. La clé Reporter est uniquement nécessaire pour WF3 ; WF1/WF4 fonctionnent sans clé privée.
3. N'interpole pas une URL brute dans une commande shell sans validation stricte et échappement. Une valeur malveillante peut produire une injection de commande.
4. Ne jamais exposer les champs internes (`reporter`, `urlHash`, `active`) dans l'endpoint public WF4.
5. En cas d'erreur RPC ou transaction, ne jamais annoncer la blacklist comme publiée avant d'avoir reçu le `txHash` et la confirmation du script.
6. Toute modification des interfaces §8.1–§8.7 du cahier des charges doit être discutée avant d'être codée.
7. Si la clé Reporter est suspectée compromise : arrêter WF3, contacter Profil A ; le Owner révoquera cette adresse et autorisera un nouveau Reporter.

---

## 9. Ce dont Profil A a besoin de Profil B

Avant de connecter WF3, fournir :

1. Un exemple réel de sortie JSON IA valide.
2. La table finale utilisée pour convertir les verdicts/labels IA vers les six catégories blockchain.
3. La formule de calcul du score final effectivement implémentée.
4. Le mode de déploiement n8n choisi : local ou Docker, car le chemin des scripts et l'injection du credential Reporter doivent être adaptés.
5. Les noms des deux canaux / webhooks Discord : alertes et revue manuelle.

Ensuite, nous testerons ensemble le scénario complet :

```text
signalement → check → IA → score → report → transaction Amoy → Discord
```

---

## 10. Contacts et références

- Contrat vérifié : https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23#code
- Guide général du projet : [README.md](../README.md)
- Cahier des charges complet : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md)
- Contrat de données figé : section 8 du cahier des charges complet
- Cahier personnel blockchain : [CAHIER_DES_CHARGES_PROFIL_A_WEB3.md](CAHIER_DES_CHARGES_PROFIL_A_WEB3.md)
