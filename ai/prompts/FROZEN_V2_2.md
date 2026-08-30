# Gel de l'évaluation v2.2 — 2026-08-26

**Statut :** gel de reproductibilité pour les rapports `v2.2` ci-dessous.
Les métriques restent propres à chaque fournisseur et à cette exécution ; elles
ne constituent pas une garantie de performance générale.

## Périmètre figé

- Révision source : `9b0f5128e5d063c24c16f5b9ed8e6ec3031449ee` avec les
  ajustements non commités documentés dans
  `docs/reviews/VALIDATION_FOLLOWUP_2026-08-26.md`.
- Jeu évalué : 36 URLs phishing puis 36 URLs légitimes, via `--limit=36`.
- Scope : `end-to-end`. Chaque enregistrement présent dans le cache est soumis
  au modèle en mode `combined`, `url_structural` ou `url_only`.
- Captures : `ai/dataset/final/.cache/pages/`, vérifiées localement contre
  l'index : 306 entrées, 306 fichiers, 0 divergence.
- Données d'âge : `ai/dataset/final/rdap-cache.json`, exclusivement lues
  localement pendant l'évaluation.
- Règle de mesure : seule la sortie `verdict === "malicious"` est positive.
  Une sortie `suspicious` reste négative dans la matrice et conduit à une revue
  manuelle en production.

## Commandes exécutées

```text
node ai/eval/evaluate.js --limit=36 --provider=gemini --scope=end-to-end --delay-ms=500 --prompt-version=v2.2
node ai/eval/evaluate.js --limit=36 --provider=nvidia --scope=end-to-end --delay-ms=500 --prompt-version=v2.2
NVIDIA_MODEL_FALLBACK=nvidia/nemotron-3-nano-30b-a3b node ai/eval/evaluate.js --limit=36 --provider=nvidia --scope=end-to-end --delay-ms=500 --prompt-version=v2.2-nemotron
```

Les appels aux fournisseurs sont réels et forcés par commande. Les pages et
RDAP ne sont jamais refetchés.

## Résultats associés

| Fournisseur forcé | Modèle                                         |  Traité | Couverture phishing | Couverture légitime |  TP |  FP |  FN |  TN | Précision | Rappel |     F1 |
| ----------------- | ---------------------------------------------- | ------: | ------------------: | ------------------: | --: | --: | --: | --: | --------: | -----: | -----: |
| Gemini            | `gemini-flash-lite-latest`                     | 60 / 72 |             31 / 36 |             29 / 36 |  25 |   0 |   6 |  29 |   100,0 % | 80,6 % | 89,3 % |
| NVIDIA NIM        | `openai/gpt-oss-20b`                           | 72 / 72 |             36 / 36 |             36 / 36 |  20 |   1 |  16 |  35 |    95,2 % | 55,6 % | 70,2 % |
| NVIDIA NIM        | `nvidia/nemotron-3-nano-30b-a3b` (comparaison) | 72 / 72 |             36 / 36 |             36 / 36 |  21 |   3 |  15 |  33 |    87,5 % | 58,3 % | 70,0 % |

- Gemini atteint les deux seuils sur les 60 résultats obtenus, mais 12 appels
  ont été exclus après erreurs fournisseur (principalement HTTP 429). Ce run ne
  constitue donc pas une acceptation complète à 72/72.
- NVIDIA couvre les 72 entrées, mais son rappel de 55,6 % échoue au seuil de
  80 %. Il n'est pas interchangeable avec le précédent modèle NVIDIA retiré.
- Nemotron a aussi couvert les 72 entrées, mais il ne satisfait pas le seuil de
  rappel et réduit à la fois la précision et le F1 par rapport à GPT-OSS. Il
  n'a donc pas remplacé le fallback configuré.
- Les rapports et sorties détaillées sont
  `ai/eval/report-v2.2-<provider>-endtoend.md` et
  `ai/eval/results-v2.2-<provider>-endtoend.json`; les artefacts de
  comparaison Nemotron utilisent le préfixe `v2.2-nemotron`.

## Empreintes SHA-256

| Fichier                             | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `ai/prompts/system.md`              | `8DAE752E27367B8F632B712CB7A7EBE67A462D005DA139EAE259BB3A3158FA84` |
| `ai/prompts/url-analysis.md`        | `CA60DC8D837AEEC353586812E712BC3160F327AC1850C2797D187D784035BBD8` |
| `ai/prompts/source-analysis.md`     | `45E26F3D55D522626028E65A34A38F34E6C6714ED3B24131E31511188C4190AE` |
| `ai/prompts/semantic-analysis.md`   | `CE67BC602CE1C0991F21DC2AA879E09197DB4D043CF99764F3220D84D41F7FC4` |
| `ai/prompts/output-schema.json`     | `C21C17A691A0FB0E435598931A567A91E834204662939EFDFDF05794BBBC2E5C` |
| `ai/client/lib/prompts.js`          | `50D854D4E1F6CE784D57DC747045D033A738A96EFC0C91622F36FF5864568802` |
| `ai/client/lib/validateOutput.js`   | `9B229CA4E2D2532D5F48FDEEFEA42652488359357DCE736A8BB97336EB911F1D` |
| `ai/client/llmClient.js`            | `B8191ACE511BD5118DC93AFCAF7462D8A3DC14DB140F39DE4058A3AEBF22903E` |
| `ai/client/lib/providers.js`        | `542A6D59E654ADC16D7415C49C2FEDFCDEF237DF322108BA26BD11C40F6E50FE` |
| `ai/lib/contentQuality.js`          | `82AEB4C50956C786F1D5FB7056C8D530993DAA3BB450127AEE1B98BEF9E99BA6` |
| `ai/features/urlFeatures.js`        | `A4E41023033BD0F2CBD3DC7785ACF12C4970F540A600730FC570C6884070B2C8` |
| `ai/dataset/lib/frozenRdap.js`      | `EA71C1E9A0C2D02319FEBA6A82556048327BB38D56F7B00F882ADFC363BBB742` |
| `ai/eval/evaluate.js`               | `E227EA0BC4F91EF3A69CFBCB8D75EBDBC0B3AE387B55EFA5F0572B02F323BCD5` |
| `ai/dataset/final/cache-index.json` | `6B09484CD12335274BD2A2873430ED156E5D06F3448AFE73A51748997C551AD0` |
| `ai/dataset/final/rdap-cache.json`  | `37A96B444B7F65F6C1460AEDFA4E8DA85E84FBCE3C39B49119DC1DD6746D02EA` |
