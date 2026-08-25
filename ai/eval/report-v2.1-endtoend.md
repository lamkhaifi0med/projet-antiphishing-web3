# Évaluation RF-A9 — version de prompt `v2.1` — scope `end-to-end`

**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.

Entrées traitées : 61 / 72. Exclues : {"provider_error":11}.

Couverture — global : 61/72 ; phishing : 35/36 (97.2%) ; légitime : 26/36 (72.2%).

Modes d'analyse utilisés : {"url_only":27,"combined":27,"url_structural":7}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 61 | 35 | 6 | 0 | 20 | 85.4% | 100.0% | 92.1% |
| nvidia | 61 | 35 | 6 | 0 | 20 | 85.4% | 100.0% | 92.1% |
