# Évaluation RF-A9 — version de prompt `v2.4` — scope `end-to-end` — fournisseur forcé : gemini

**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.

Entrées traitées : 72 / 72. Exclues : {}.

Couverture — global : 72/72 ; phishing : 36/36 (100.0%) ; légitime : 36/36 (100.0%).

Modes d'analyse utilisés : {"url_only":30,"combined":34,"url_structural":8}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 72 | 27 | 0 | 9 | 36 | 100.0% | 75.0% | 85.7% |
| gemini | 72 | 27 | 0 | 9 | 36 | 100.0% | 75.0% | 85.7% |
