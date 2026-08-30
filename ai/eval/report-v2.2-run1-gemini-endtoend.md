# Évaluation RF-A9 — version de prompt `v2.2` — scope `end-to-end` — fournisseur forcé : gemini

**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.

Entrées traitées : 60 / 72. Exclues : {"provider_error":12}.

Couverture — global : 60/72 ; phishing : 31/36 (86.1%) ; légitime : 29/36 (80.6%).

Modes d'analyse utilisés : {"url_only":27,"combined":26,"url_structural":7}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 60 | 25 | 0 | 6 | 29 | 100.0% | 80.6% | 89.3% |
| gemini | 60 | 25 | 0 | 6 | 29 | 100.0% | 80.6% | 89.3% |
