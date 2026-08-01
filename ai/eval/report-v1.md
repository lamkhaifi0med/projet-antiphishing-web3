# Évaluation RF-A9 — version de prompt `v1`

Entrées traitées : 32 / 40. Exclues (non mesurables) : {"dead":6,"refused":2}.

Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`.

| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Global** | 32 | 6 | 0 | 7 | 19 | 100.0% | 46.2% | 63.2% |
| none | 25 | 0 | 0 | 7 | 18 | n/a | 0.0% | n/a |
| gemini | 7 | 6 | 0 | 0 | 1 | 100.0% | 100.0% | 100.0% |
