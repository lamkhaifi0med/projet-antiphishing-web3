# Handoff binôme — vérification du pipeline complet

> Doc pour Profil B (IA/n8n). État au 31/08/2026 : **pipeline E2E terminé et
> prouvé en réel** (commit `3339b91` sur `main`). Les secrets ne sont PAS dans
> ce fichier ni dans Git — je te les envoie par canal privé (voir section 5).

---

## 1. Ce qui a changé depuis ton dernier passage

| Nouveauté | Où | Commit |
| --- | --- | --- |
| E2E natif prouvé en réel (3 publications on-chain sur vrais phishings) | voir README, tableau des tx | — |
| Explication du score en langage simple dans les alertes manual-review | [n8n/lib/wf3Discord.js](../n8n/lib/wf3Discord.js) (`explainScore`) | checkpoint `3d38bb3` |
| **Feature brand-proximity** : détection déterministe de typosquat (22 marques Web3, Levenshtein ≤2), poids recalibrés — publications auto 3→15 sur le benchmark, zéro faux positif | [ai/features/urlFeatures.js](../ai/features/urlFeatures.js), calibration [ai/eval/replay-brand-weights.js](../ai/eval/replay-brand-weights.js) | `9f36933` |
| **Bot Discord de résolution** : les cas manual_review ont des boutons admin ✅ Publier / ❌ Rejeter dans #manual-review. Zéro dépendance npm. Nouveau statut journal `dismissed`. | [n8n/services/discord-bot/](../n8n/services/discord-bot/) | `3339b91` |
| README entièrement réécrit (état final, preuves, quick start) | [README.md](../README.md) | `3339b91` |

**Important côté IA (ta partie)** : le prompt v2.2 reste gelé et intouché.
L'essai v2.4 (injection des features dans le prompt) a été rejeté — le modèle
s'ancre sur le signal déterministe et le rappel chute. Le gain de rappel vient
uniquement du score de features post-modèle. Détails : `ai/prompts/FROZEN_V2_2.md`
et les rapports `ai/eval/report-v2.4-trial*.md`.

---

## 2. Revue de code demandée (priorités)

1. [n8n/services/discord-bot/lib.js](../n8n/services/discord-bot/lib.js) —
   surtout `resolveReport()` : c'est le seul chemin de publication on-chain
   déclenché par un humain. Vérifie : relecture d'état avant action
   (anti double-clic), refang, gestion `already_blacklisted` sans txHash,
   journal jamais modifié sans confirmation blockchain.
2. [n8n/services/discord-bot/bot.js](../n8n/services/discord-bot/bot.js) —
   gateway Discord brut (WebSocket natif), autorisation Administrator
   (bitfield 0x8), réponses éphémères différées.
3. Diff de [n8n/bridge/lib/validation.js](../n8n/bridge/lib/validation.js)
   (statut `dismissed`) et de [n8n/docker-compose.yml](../n8n/docker-compose.yml)
   (service `discord-bot` durci : read-only, cap_drop ALL, réseaux internes).
4. [ai/features/urlFeatures.js](../ai/features/urlFeatures.js) — la map BRANDS
   et les nouveaux poids de `combineComponents`.

Ouvre des issues GitHub pour tout ce qui te semble louche.

---

## 3. Vérifier SANS rien installer (~5 min)

- README → tableau des preuves : 3 transactions Polygonscan cliquables.
- Contrat : https://amoy.polygonscan.com/address/0x8d51dB4a92c338075360A17AcA005ec282fE1f23
  → onglet Events, tu verras les `URLReported` récents.
- Résultats IA gelés : `ai/prompts/FROZEN_V2_2.md` (précision 100 %,
  rappel 80,6 %, F1 89,2 % — critères ≥85 %/≥80 % atteints).

## 4. Vérifier HORS LIGNE (~10 min, Node ≥ 22 suffit)

```bash
git pull origin main
npm install
npm run test:all
# Attendu : 133/133 racine, bridge, capture 5/5, analysis 24/24,
#           Discord bot 7/7 groupes, workflows 19/19 — aucun réseau requis.

cd contracts && npm install && npx hardhat test
# Attendu : 13/13.
```

Envoie-moi une capture si un test échoue chez toi.

## 5. Faire tourner la stack complète (~20 min, Docker requis)

Il te faut les deux fichiers de secrets (jamais commités). Je t'envoie les
valeurs par **canal privé** (Signal/WhatsApp — pas Discord, pas Git) :

**Racine `.env`** (copie de `.env.example`) — valeurs que je t'envoie :

| Clé | Qui la fournit |
| --- | --- |
| `REPORTER_PRIVATE_KEY` | moi (clé Reporter testnet uniquement — jamais l'Owner) |
| `GEMINI_API_KEY` / `NVIDIA_API_KEY` | toi (tes propres clés) ou moi |
| `DISCORD_WEBHOOK_ALERTS` / `DISCORD_WEBHOOK_MANUAL_REVIEW` | moi |
| `OWNER_PRIVATE_KEY`, `POLYGONSCAN_API_KEY` | pas nécessaires pour exécuter la stack |

**`n8n/.env`** (copie de `n8n/.env.example`) — valeurs que je t'envoie :

| Clé | Note |
| --- | --- |
| `N8N_ENCRYPTION_KEY` | obligatoire : doit être EXACTEMENT la mienne, sinon les credentials n8n du volume sont illisibles |
| `CHAIN_BRIDGE_TOKEN` / `BRIDGE_SHARED_SECRET` | secrets internes services |
| `REPORTER_PRIVATE_KEY` | même clé Reporter que ci-dessus |
| `GEMINI_API_KEY` / `NVIDIA_API_KEY` | idem racine |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_MANUAL_REVIEW_CHANNEL_ID` | moi ; `DISCORD_ADMIN_ROLE_ID` reste vide (mode Administrator) |

Puis :

```bash
cd n8n
docker compose up -d
docker compose ps           # 7 conteneurs "healthy"
curl http://localhost:8080/health
```

**Test de bout en bout :**

```bash
# Soumettre un signalement (autres exemples dans n8n/test-urls.txt)
curl -X POST http://localhost:8080/webhook/report \
  -H "Content-Type: application/json" \
  -d '{"type":"url","value":"https://demo-phishing.invalid/claim","reporterContact":"toi@example.com"}'

# Suivre : portail http://localhost:8080/ (statuts en direct)
# Un cas en zone grise apparaît dans #manual-review avec les boutons.
# Une publication auto (score >= 0.80) donne un txHash Amoy vérifiable.
```

Je t'ajoute sur le serveur Discord (demande-moi une invitation) — il te faut
la permission Administrator pour cliquer Publier/Rejeter.

## 6. Ce que j'attends de toi en retour

1. **Ta revue de code** (section 2) — issues GitHub ou notes.
2. Confirmation que `npm run test:all` et les tests Hardhat passent chez toi.
3. **Tes sections du rapport technique final** (parties 2 & 3 selon PLAN.md :
   module IA, prompts, évaluation, workflows WF1/WF2). C'est le dernier
   livrable manquant — `docs/rapports/` est vide. Je rédige les parties 1 & 4
   (architecture blockchain, audit, soutenabilité).
4. Tes dispos pour préparer la démo de soutenance ensemble.
