# Évaluation RF-A9 — version de prompt `v2.1` — scope `end-to-end`

**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.

Entrées traitées : 58 / 72. Exclues : {"provider_error":14}.

Couverture — global : 58/72 ; phishing : 29/36 (80.6%) ; légitime : 29/36 (80.6%).

Modes d'analyse utilisés : {"url_only":23,"combined":27,"url_structural":8}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 58 | 29 | 7 | 0 | 22 | 80.6% | 100.0% | 89.2% |
| nvidia | 58 | 29 | 7 | 0 | 22 | 80.6% | 100.0% | 89.2% |
