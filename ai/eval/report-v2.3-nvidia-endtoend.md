# Évaluation RF-A9 — version de prompt `v2.3` — scope `end-to-end` — fournisseur forcé : nvidia

**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.

Entrées traitées : 71 / 72. Exclues : {"provider_error":1}.

Couverture — global : 71/72 ; phishing : 36/36 (100.0%) ; légitime : 35/36 (97.2%).

Modes d'analyse utilisés : {"url_only":29,"combined":34,"url_structural":8}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 71 | 13 | 0 | 23 | 35 | 100.0% | 36.1% | 53.1% |
| nvidia | 71 | 13 | 0 | 23 | 35 | 100.0% | 36.1% | 53.1% |
