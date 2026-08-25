# Gel des prompts v2.1 — à finaliser après merge

**Statut :** brouillon — ne pas traiter comme un gel final tant que les PR
listées ci-dessous ne sont pas mergées et que les empreintes n'ont pas été
régénérées sur l'état réellement fusionné.

## Pourquoi une v2.1

`ai/prompts/FROZEN_V2.md` gelait la v2 (règle de décision + contrat JSON).
AI recall v2 (REVIEW_COMMIT_57747F0.md §5) change le comportement autour
de ces prompts sans changer les checklists elles-mêmes :

- `ai/client/lib/prompts.js` : le prompt utilisateur inclut désormais un
  bloc `URL_FEATURES` (features URL déterministes) et un bloc
  `Mode d'analyse` (`combined`/`url_structural`/`url_only`) qui marque
  explicitement `PAGE_TEXT`/`STRUCTURAL_DIGEST` comme indisponibles quand
  c'est le cas, plutôt que de les omettre silencieusement.
- `ai/client/llmClient.js` : le seuil de 200 caractères ne court-circuite
  plus l'appel LLM — il sélectionne un mode d'analyse
  (`ai/lib/contentQuality.js`, `classifyAnalysisMode`). Le LLM est
  toujours appelé.
- `ai/client/lib/validateOutput.js` (PR #10) : `manualReview` correct pour
  un verdict `suspicious` valide, propriété `category` requise même
  absente, négation gérée dans la détection de preuve forte.
- `ai/features/urlFeatures.js` (PR #11) : Public Suffix List réelle
  (`tldts`), gestion des IP littérales, homoglyphes limités aux caractères
  confusables documentés.
- `ai/dataset/lib/frozenRdap.js` (ce fichier) : RDAP gelé injectable,
  jamais de requête RDAP en direct pendant une évaluation.

Les checklists (`system.md`, `url-analysis.md`, `source-analysis.md`,
`semantic-analysis.md`) et `output-schema.json` restent **inchangées** —
la règle de décision v2 elle-même n'a pas changé, seule la préparation de
la preuve fournie au modèle et le seuil d'appel ont changé.

## PR concernées (à merger avant de générer ce gel)

- #5 — intégration WF1/WF2
- #10 — `manualReview`, `category` requis, négation
- #11 — `urlFeatures.js` (PSL/IP/IDN)
- cette branche (`feat/ai-recall-v2-modes`) — modes d'analyse, RDAP gelé,
  évaluateur `--scope`

## Procédure une fois mergé

```powershell
Get-FileHash ai/prompts/system.md, ai/prompts/url-analysis.md, ai/prompts/source-analysis.md, ai/prompts/semantic-analysis.md, ai/prompts/output-schema.json, ai/client/lib/prompts.js, ai/client/lib/validateOutput.js, ai/client/llmClient.js, ai/lib/contentQuality.js, ai/features/urlFeatures.js -Algorithm SHA256
```

Coller le résultat dans le tableau ci-dessous, remplacer le statut en
« gelé », dater, et déclencher une évaluation content-only **et**
end-to-end sur Gemini et NVIDIA (voir `ai/eval/evaluate.js --scope`).

## Empreintes SHA-256

_(à remplir après merge — ne pas remplir avant, un merge peut encore
changer ces fichiers)_

| Fichier | SHA-256 |
|---|---|
| `ai/prompts/system.md` | _inchangé depuis v2, réutiliser l'empreinte de FROZEN_V2.md_ |
| `ai/prompts/url-analysis.md` | _inchangé depuis v2_ |
| `ai/prompts/source-analysis.md` | _inchangé depuis v2_ |
| `ai/prompts/semantic-analysis.md` | _inchangé depuis v2_ |
| `ai/prompts/output-schema.json` | _inchangé depuis v2_ |
| `ai/client/lib/prompts.js` | à régénérer |
| `ai/client/lib/validateOutput.js` | à régénérer |
| `ai/client/llmClient.js` | à régénérer (nouveau dans le gel) |
| `ai/lib/contentQuality.js` | à régénérer (nouveau dans le gel) |
| `ai/features/urlFeatures.js` | à régénérer (nouveau dans le gel) |
