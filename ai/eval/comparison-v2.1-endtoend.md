# Comparatif end-to-end RF-A9 — prompts v2.1 (AI recall v2)

**Date :** 2026-08-25
**Scope :** `--scope=end-to-end` (toute entrée avec un enregistrement de
cache est mesurée, mode `combined`/`url_structural`/`url_only` choisi
automatiquement, RDAP gelé — voir `ai/eval/evaluate.js`)
**Jeu d'entrée :** 36 phishing + 36 légitimes (`--limit=36`)
**Commande :** `node ai/eval/evaluate.js --limit=36 --scope=end-to-end --delay-ms=300 --prompt-version=v2.1`

## ⚠️ Ce comparatif n'oppose pas réellement Gemini et NVIDIA

`GEMINI_API_KEY` dans cet environnement ne ressemble pas à une clé API
Gemini Developer valide (format attendu `AIzaSy...`, 39 caractères ; la
valeur configurée fait 53 caractères et commence par `AQ.`). Un appel
`generateContent` réel ne renvoie ni succès ni erreur claire : il reste
bloqué jusqu'au timeout (20 s), pour chacune des 3 tentatives. Le fallback
automatique RF-A6 fonctionne comme prévu et bascule vers NVIDIA — mais
concrètement, **la quasi-totalité du trafic de ces deux runs a été servie
par NVIDIA (`meta/llama-3.1-8b-instruct`)**, pas par Gemini. Les deux runs
ci-dessous démontrent que le pipeline de recours fonctionne (RF-A6), pas
un comparatif Gemini vs NVIDIA loyal. Corriger `GEMINI_API_KEY` puis
relancer avant de considérer ce comparatif final.

## Résultats (deux runs indépendants, même code)

`meta/llama-3.1-8b-instruct` n'est pas déterministe à température par
défaut ; deux runs consécutifs avec throttling NVIDIA (429) différent
donnent une couverture et des faux positifs légèrement différents. Les
deux sont conservés pour la traçabilité plutôt que de n'en garder qu'un.

| Run | n mesuré | Couverture phishing | Couverture légitime | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **1 (primaire)** — `report-v2.1-endtoend.md` | 61/72 | 35/36 (97,2 %) | 26/36 (72,2 %) | 35 | 6 | 0 | 20 | **85,4 %** | **100,0 %** | 92,1 % |
| 2 (confirmatoire) — `report-v2.1-endtoend-run2.md` | 58/72 | 29/36 (80,6 %) | 29/36 (80,6 %) | 29 | 7 | 0 | 22 | 80,6 % | 100,0 % | 89,2 % |

Les entrées non mesurées dans les deux runs sont exclusivement des
`provider_error` (NVIDIA HTTP 429 après 3 tentatives) — jamais une
exclusion silencieuse de contenu comme dans l'ancien protocole
content-only.

## Comparaison au protocole content-only précédent

| | Content-only (`comparison-v2-final.md`, 2026-08-09) | End-to-end (ce document) |
|---|---:|---:|
| Couverture phishing | 11/36 (30,6 %) | 29 à 35/36 (80,6–97,2 %) |
| Rappel mesuré | 100,0 % (sur 11 entrées) | 100,0 % (sur 29 à 35 entrées) |
| Précision mesurée | 100,0 % (sur 34 entrées) | 80,6–85,4 % (sur 58 à 61 entrées) |

Le rappel de 100 % ne change pas de valeur, mais son sens change
complètement : il portait sur moins d'un tiers des URLs phishing avant, il
en couvre maintenant l'écrasante majorité. La précision baisse en
apparaissant enfin dans la mesure : elle était invisible avant parce que
les cas difficiles (contenu absent) n'étaient jamais soumis au modèle.

## Critères d'acceptation (cahier des charges Profil B §5)

- Précision ≥ 85 % : **atteinte sur le run 1** (85,4 %), **manquée sur le
  run 2** (80,6 %).
- Rappel ≥ 80 % : **atteint sur les deux runs** (100,0 %).

Au minimum un des deux runs satisfait les deux critères simultanément ;
l'autre reste proche. Ce n'est pas un résultat stable et figé comme le
100 %/100 % content-only l'affichait — c'est un résultat honnête sur un
jeu beaucoup plus difficile.

## Analyse des faux positifs — un schéma clair et actionnable

Les 6 et 7 faux positifs des deux runs suivent le même schéma dans les
deux cas :

1. **Domaines légitimes avec un chemin `login`/`signin`/`sign-in`**
   (`accounts.coinbase.com/signin`, `login.coinbase.com/signin`,
   `www.kraken.com/sign-in`) — le modèle semble réagir au chemin plutôt
   qu'à la légitimité réelle du domaine.
2. **`indicators` recopie des noms de catégorie de la checklist**
   (`"Typosquatting"`, `"Homoglyphes"`, `"Demande de seed phrase/clé
   privée"`) au lieu d'une observation concrète — exactement ce que la
   règle de décision finale interdit explicitement
   (`ai/client/lib/prompts.js`, règle 1 : « Ne recopie jamais les
   familles de la checklist »). NVIDIA `llama-3.1-8b-instruct` (8B
   paramètres) suit cette contrainte moins bien qu'un modèle plus grand.
3. **Impossible en mode `url_only` par construction** : sur
   `accounts.coinbase.com/signin` et `www.kraken.com/sign-in`, le modèle
   affirme une « demande de seed phrase/clé privée » alors qu'aucun texte
   de page ni digest structurel n'est fourni dans ce mode — il ne peut
   matériellement pas avoir observé cette demande. C'est une hallucination
   pure, pas une preuve mal interprétée.

### Piste corrective concrète pour la prochaine itération

Le point 3 est le plus actionnable : ajouter une règle de validation
explicite interdisant les indicateurs `"Demande de seed phrase/clé
privée"` et `"Scripts obfusqués/tiers suspects"` en mode `url_only` (ces
preuves nécessitent structurellement du contenu de page), et renforcer la
note de mode dans `ai/client/lib/prompts.js` pour NVIDIA spécifiquement.
Non fait dans ce cycle par manque de temps — c'est le candidat naturel
pour la prochaine PR.

## Fichiers

- `report-v2.1-endtoend.md` / `results-v2.1-endtoend.json` : run primaire (n=61)
- `report-v2.1-endtoend-run2.md` / `results-v2.1-endtoend-run2.json` : run confirmatoire (n=58)
- `comparison-v2-final.md`, `report-v2-gemini.md`, `report-v2-nvidia.md` : protocole content-only précédent (2026-08-09), conservé pour traçabilité historique, marqué brouillon
