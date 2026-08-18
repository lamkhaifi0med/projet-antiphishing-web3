# Évaluation RF-A9 — version de prompt `v2` — fournisseur forcé : gemini

Protocole : jeu final fige, au plus le meme nombre d'entrees de chaque label, captures `status=ok` uniquement, aucun refetch. Les autres statuts sont exclus avant tout appel LLM.

Entrées traitées : 34 / 72. Exclues (non mesurables) : {"dead":11,"empty":21,"refused":5,"challenged":1}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 34 | 11 | 0 | 0 | 23 | 100.0% | 100.0% | 100.0% |
| gemini | 34 | 11 | 0 | 0 | 23 | 100.0% | 100.0% | 100.0% |
