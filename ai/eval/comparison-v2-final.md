# Comparatif final RF-A9 — prompts v2

**Date :** 2026-08-09  
**Jeu d'entrée :** 36 phishing + 36 légitimes, sélectionnés avant exclusion  
**Jeu mesurable :** 34 captures `status=ok` (11 phishing, 23 légitimes)

## Résultats

| Fournisseur | Modèle réellement utilisé | n | TP | FP | FN | TN | Précision | Rappel | F1 | Latence moyenne | P95 | Retries |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemini | `gemini-flash-lite-latest` | 34 | 11 | 0 | 0 | 23 | 100,0 % | 100,0 % | 100,0 % | 1 332 ms | 1 881 ms | 3 |
| NVIDIA NIM | `meta/llama-3.1-8b-instruct` | 34 | 11 | 0 | 0 | 23 | 100,0 % | 100,0 % | 100,0 % | 1 539 ms | 4 275 ms | 3 |

Les deux modèles dépassent les critères d'acceptation : précision >= 85 %
et rappel >= 80 %. Les 3 retries de chaque fournisseur correspondent à des
réponses `suspicious` contradictoires avec une preuve forte observée ; la
validation v2 les a rejetées et la demande corrective a produit un verdict
cohérent au second essai.

## Exclusions

Sur les 72 entrées sélectionnées, 38 sont exclues avant l'appel LLM :

| Statut | n | Raison |
|---|---:|---|
| `dead` | 11 | domaine ou page injoignable lors de la capture figée |
| `empty` | 21 | contenu insuffisant, souvent une SPA sans JavaScript |
| `refused` | 5 | réponse HTTP refusée lors de la capture |
| `challenged` | 1 | challenge anti-bot |

Ces entrées ne sont ni des vrais négatifs ni des faux négatifs : aucune
prédiction du modèle n'est mesurable sans contenu exploitable. Le pipeline
de production les envoie en revue manuelle selon RF-N9.

## Changements v2

- décision `malicious` imposée lorsqu'une preuve forte observable existe ;
- incohérence marque/domaine et hébergement tiers ajoutés à RF-A1 ;
- contrat JSON explicite et structured output Gemini/NVIDIA ;
- retries correctifs alimentés par les erreurs de validation ;
- contradiction `suspicious` + preuve forte rejetée par le validateur ;
- erreurs fournisseur séparées des prédictions dans l'évaluation.

## Limites

Le nombre de phishing mesurables est faible (`n=11`) à cause de la mortalité
des URLs et des pages vides. Le score de 100 % prouve le respect du seuil sur
ce jeu figé, pas une performance universelle. Une prochaine collecte doit
augmenter le nombre de pages phishing capturées avec `status=ok` et conserver
ce jeu intact comme test final.

Rapports détaillés : `report-v2-gemini.md`, `report-v2-nvidia.md`. Les
prédictions unitaires sans contenu de page sont dans les fichiers
`results-v2-*.json`.
