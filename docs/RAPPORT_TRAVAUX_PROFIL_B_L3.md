# Rapport des travaux réalisés — Profil B / Livrable L3

> **Mise à jour du 25 août 2026 :** le protocole d'évaluation décrit dans
> ce rapport (§6, section 10) mesurait uniquement les captures
> `status=ok` — 11 URLs phishing sur 36 (30,6 %). Un protocole
> end-to-end existe désormais (`ai/eval/evaluate.js --scope=end-to-end`),
> qui mesure 29 à 35 URLs phishing sur 36 (80,6–97,2 %) en appelant
> toujours le LLM (modes `combined`/`url_structural`/`url_only`, voir
> `ai/lib/contentQuality.js`). Voir
> `ai/eval/comparison-v2.1-endtoend.md` pour les résultats à jour, une
> analyse des faux positifs, et un avertissement sur la clé Gemini de cet
> environnement. Le §6 ci-dessous reste exact pour ce qu'il décrit
> (protocole content-only du 9 août), il n'est pas corrigé rétroactivement.

**Projet :** Détection de phishing Web3 par IA  
**Rôle :** Profil B — IA générative et orchestration n8n  
**Date :** 9 août 2026  
**Livrable concerné :** L3 — prompts optimisés et évaluation comparative

## 1. Objectif des travaux

Les travaux avaient trois objectifs :

1. produire une évaluation avec Gemini puis NVIDIA NIM ;
2. améliorer les prompts afin d'obtenir un rappel supérieur ou égal à 80 % ;
3. générer le tableau comparatif final et figer la version validée des prompts.

## 2. Audit de l'évaluation existante

Le premier rapport présentait un rappel global de 46,2 %. L'analyse du
script a montré que ce résultat mélangeait deux situations différentes :

- les pages réellement analysées par un LLM ;
- les captures vides ou techniquement inexploitables, transformées en
  verdict `suspicious` sans appel au modèle.

Le protocole a été corrigé pour respecter la documentation du dataset :
seules les captures avec le statut `ok` entrent dans les métriques. Les
statuts `dead`, `empty`, `refused` et `challenged` sont maintenant exclus et
documentés séparément.

Les erreurs techniques du fournisseur, par exemple un timeout ou une
réponse HTTP 429, sont également classées comme `provider_error`. Elles ne
sont plus comptées comme des faux négatifs du modèle.

## 3. Amélioration des prompts

Une version v2 a été créée avec les améliorations suivantes :

- règle de décision explicite entre `malicious`, `suspicious` et
  `legitimate` ;
- verdict `malicious` lorsqu'au moins une preuve forte est réellement
  observée ;
- détection de l'usurpation d'une marque Web3 sur un domaine non officiel ;
- prise en compte des hébergements génériques comme `vercel.app`,
  `pages.dev`, `web.app`, `gitbook.io` et `godaddysites.com` ;
- détection des chemins trompeurs contenant `login`, `verify`, `wallet`,
  `claim`, `reward`, `earn` ou `support` ;
- rappel que HTTPS et une apparence professionnelle ne prouvent pas la
  légitimité d'un site ;
- contrat JSON décrit explicitement dans le message système ;
- contrôle de cohérence entre le verdict, les indicateurs et l'explication.

Une réponse `suspicious` qui affirme simultanément avoir observé une preuve
forte, par exemple un typosquatting ou une demande de seed phrase, est
désormais rejetée. Le client demande alors au modèle de corriger sa réponse.

## 4. Sorties JSON structurées

La génération structurée a été renforcée pour les deux fournisseurs :

- Gemini reçoit directement le schéma JSON dans `responseJsonSchema` ;
- NVIDIA NIM utilise `guided_json` afin de contraindre la structure ;
- la validation locale reste obligatoire après chaque réponse ;
- deux nouvelles tentatives sont autorisées après le premier échec ;
- les erreurs de validation sont transmises au modèle dans la demande de
  correction ;
- un backoff progressif est appliqué entre les tentatives techniques.

Cette modification corrige notamment les réponses NVIDIA qui utilisaient
des mots comme `"high"` pour `confidence` ou des objets à la place de chaînes
dans `indicators`.

## 5. Protocole final d'évaluation

Le benchmark utilise le jeu final figé et ne refait aucune requête vers les
sites évalués.

- 36 URLs phishing sélectionnées ;
- 36 URLs légitimes sélectionnées ;
- 72 entrées au total avant contrôle de la capture ;
- 34 captures réellement mesurables ;
- 11 phishing mesurables ;
- 23 légitimes mesurables.

### Exclusions

| Statut | Nombre | Explication |
|---|---:|---|
| `dead` | 11 | Domaine ou page injoignable pendant la capture figée |
| `empty` | 21 | Contenu insuffisant, souvent une application nécessitant JavaScript |
| `refused` | 5 | Serveur ayant refusé la capture |
| `challenged` | 1 | Page de challenge anti-bot |

Ces 38 entrées ne sont pas utilisées pour calculer la précision ou le
rappel. En production, elles doivent être envoyées en revue manuelle.

## 6. Résultats comparatifs

| Fournisseur | Modèle réellement utilisé | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Gemini | `gemini-flash-lite-latest` | 11 | 0 | 0 | 23 | 100,0 % | 100,0 % | 100,0 % |
| NVIDIA NIM | `meta/llama-3.1-8b-instruct` | 11 | 0 | 0 | 23 | 100,0 % | 100,0 % | 100,0 % |

### Performances techniques

| Fournisseur | Latence moyenne | P95 | Corrections effectuées |
|---|---:|---:|---:|
| Gemini | 1 332 ms | 1 881 ms | 3 |
| NVIDIA NIM | 1 539 ms | 4 275 ms | 3 |

Les deux fournisseurs dépassent les critères d'acceptation :

- précision demandée : au moins 85 % ;
- rappel demandé : au moins 80 % ;
- résultat obtenu : 100 % de précision et 100 % de rappel sur les 34
  captures exploitables.

Le modèle `gemini-flash-latest` avait épuisé son quota pendant les essais.
Le benchmark Gemini final utilise donc `gemini-flash-lite-latest`, déjà
prévu comme modèle léger dans la configuration du projet. Le modèle exact
est enregistré dans les résultats pour assurer la traçabilité.

## 7. Gel des prompts

La version v2 est figée depuis le 9 août 2026. Le manifeste
`ai/prompts/FROZEN_V2.md` contient les empreintes SHA-256 des prompts, du
schéma, de l'assembleur et du validateur.

Toute modification d'un fichier figé doit produire une nouvelle version de
prompt et déclencher une nouvelle évaluation Gemini et NVIDIA.

## 8. Fichiers produits ou modifiés

### Rapports et résultats

- `ai/eval/comparison-v2-final.md` : tableau comparatif final ;
- `ai/eval/report-v2-gemini.md` : métriques Gemini ;
- `ai/eval/report-v2-nvidia.md` : métriques NVIDIA ;
- `ai/eval/results-v2-gemini.json` : prédictions détaillées Gemini ;
- `ai/eval/results-v2-nvidia.json` : prédictions détaillées NVIDIA.

### Prompts et gel de version

- `ai/prompts/system.md` ;
- `ai/prompts/url-analysis.md` ;
- `ai/prompts/README.md` ;
- `ai/prompts/FROZEN_V2.md`.

### Client et évaluation

- `ai/client/lib/prompts.js` ;
- `ai/client/lib/providers.js` ;
- `ai/client/lib/validateOutput.js` ;
- `ai/client/llmClient.js` ;
- `ai/eval/evaluate.js`.

## 9. Vérifications réalisées

- validation de la syntaxe de tous les fichiers JavaScript du dossier `ai` ;
- test du fallback Gemini vers NVIDIA : 1 test réussi sur 1 ;
- tests de capture HTML et de protection SSRF : 21 tests réussis sur 21 ;
- recalcul des matrices de confusion depuis les fichiers JSON détaillés ;
- contrôle Git des erreurs de format avec `git diff --check`.

## 10. Limites du résultat

Le score de 100 % concerne uniquement les 34 captures exploitables du jeu
figé. Seulement 11 pages phishing étaient encore accessibles avec un contenu
suffisant au moment de la capture. Ce résultat valide le seuil du Livrable
L3, mais il ne prouve pas une performance universelle sur toutes les fraudes
Web3.

Une prochaine collecte devra augmenter le nombre de pages phishing avec le
statut `ok`, tout en conservant le jeu actuel intact comme jeu de test final.

## 11. État du livrable

Le Livrable L3 est terminé :

- prompts RF-A1, RF-A2 et RF-A3 améliorés et figés ;
- sortie RF-A4/RF-A5 validée et corrigée automatiquement ;
- Gemini et NVIDIA évalués sur le même jeu ;
- précision, rappel et F1 calculés ;
- rappel supérieur au seuil de 80 % ;
- tableau comparatif final disponible et reproductible.

La prochaine grande étape du Profil B est la réalisation des workflows n8n
WF1 à WF4.
