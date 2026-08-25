# Gel des prompts v2

> **⚠️ Superseded by v2.1** (AI recall v2 : modes d'analyse, features URL
> déterministes dans le prompt, RDAP gelé — REVIEW_COMMIT_57747F0.md §5).
> `ai/client/lib/prompts.js` a été modifié : ce gel v2 ne correspond plus
> au comportement actuel. Un nouveau manifeste `FROZEN_V2_1.md` doit être
> généré une fois les PR concernées mergées (voir ce fichier pour la
> checklist). Conservé ici pour la traçabilité historique du run v2 du
> 2026-08-09, ne pas régénérer ces empreintes.

**Version :** v2  
**Date de gel :** 2026-08-09  
**Livrable :** L3 / RF-A1 à RF-A9

Cette version est celle évaluée dans `ai/eval/report-v2-gemini.md` et
`ai/eval/report-v2-nvidia.md`. Toute modification d'un fichier ci-dessous
crée une nouvelle version de prompt et exige de relancer les deux modèles.

## Empreintes SHA-256

| Fichier | SHA-256 |
|---|---|
| `ai/prompts/system.md` | `536d6f16120513bf547ce8afad8d45f7ae2a6e8cb9c8981f9d89ced0ea610bc8` |
| `ai/prompts/url-analysis.md` | `b1fb9bd082d7d9313c636fcfb53a2aba59c73d5fdd171c747cb5e877bcb3e2c7` |
| `ai/prompts/source-analysis.md` | `7d82e8a9ac8aa2b224d3d617c6780d19f8997a06cd0a5153ebd540624b5fb3da` |
| `ai/prompts/semantic-analysis.md` | `125dc73ee82e35c2892b76842c2fb52e0929edac68207124c1e1e4a950df9df7` |
| `ai/prompts/output-schema.json` | `060a2bbc4f4d67a864bf5e99bb8c4b0e4536cca7ad2372bdac325a5137fae530` |
| `ai/client/lib/prompts.js` | `5a05d743e0536c3e0daa1ee17a73bb5b54b255401037aa294125f6c1bfa56543` |
| `ai/client/lib/validateOutput.js` | `04469112bdff67c54ffd5246b806addc8ed6a8b2b2a2d619df75d669ef6f0131` |

## Vérification

```powershell
Get-FileHash ai/prompts/system.md,ai/prompts/url-analysis.md,ai/prompts/source-analysis.md,ai/prompts/semantic-analysis.md,ai/prompts/output-schema.json,ai/client/lib/prompts.js,ai/client/lib/validateOutput.js -Algorithm SHA256
```

## Reproduction de l'évaluation

Le run est équilibré avant les exclusions : les 36 phishing et les 36
premières URLs légitimes du jeu final figé. Seules les captures `status=ok`
sont mesurables. Aucun site n'est refetché.

```powershell
$env:GEMINI_MODEL_PRIMARY='gemini-flash-lite-latest'
node ai/eval/evaluate.js --limit=36 --provider=gemini --prompt-version=v2 --delay-ms=5000
node ai/eval/evaluate.js --limit=36 --provider=nvidia --prompt-version=v2 --delay-ms=2500
```

Le modèle Gemini primaire `gemini-flash-latest` avait épuisé son quota lors
du run. Le modèle Gemini réellement évalué est donc
`gemini-flash-lite-latest`, déjà déclaré comme modèle lite dans `.env.example`.
