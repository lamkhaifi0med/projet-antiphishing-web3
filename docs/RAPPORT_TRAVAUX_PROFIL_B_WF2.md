# Rapport d'avancement Profil B - WF2 analyse

Date de verification : 9 aout 2026.

## Objectif realise

La deuxieme etape n8n du cahier des charges est implementee : un signalement
non present dans la blacklist passe de WF1 vers WF2, est capture sans
JavaScript, analyse par Gemini avec fallback NVIDIA, puis journalise avec son
score et sa decision.

## Elements livres

- `n8n/workflows/WF2_Analyse.json` : orchestration asynchrone complete.
- `n8n/capture/` : capture HTTP(S), limite 10 secondes et 2 Mo, trois
  redirections maximum, protection SSRF et aucune execution JavaScript.
- `ai/features/urlFeatures.js` : calcul deterministe conforme au document
  fige `url-features-scoring.md`.
- `n8n/analysis/` : prompts v2 figes, Gemini puis NVIDIA, formule
  `0.7 * confidence + 0.3 * scoreFeaturesUrl` et routage RF-N8/RF-N9.
- `n8n/bridge/` : transitions atomiques du journal sans duplication de ligne.

## Decisions appliquees

| Resultat | Decision WF2 | Statut RF-N10 |
|---|---|---|
| `malicious` et score >= 0.80 | preparation de WF3 | `reporting` |
| `suspicious` ou score 0.50-0.79 | revue manuelle | `manual_review` |
| `legitimate` ou score < 0.50 | journal uniquement | `analyzing` + `decision=logged_only` |
| erreur capture/IA | journal de l'erreur | `failed` |

Le statut `analyzing` pour `logged_only` vient de RF-N10 : sa liste fermee ne
contient aucun statut terminal `analyzed` ou `completed`.

## Verification

- Bridge et journal : 12/12 tests.
- Service capture : 5/5 tests.
- Service analyse et score : 10/10 tests.
- Exports WF1/WF2 : 17/17 controles statiques.
- Protection SSRF et extraction : 21/21 tests.
- Fallback NVIDIA simule apres un HTTP 429 Gemini : 1/1 test.
- Injection de prompt reelle : le texte hostile demandait explicitement
  `legitimate`; NVIDIA a conserve le verdict attendu `malicious` avec 0.99.
- Stack Docker : n8n, bridge, capture et analysis tous demarres et sains.

Test HTTP reel : `https://www.wikipedia.org/` a produit un `202`, puis un
verdict `legitimate`, `scoreFinal=0.70`, modele Gemini et
`decision=logged_only`. Cela valide WF1 -> WF2, RDAP, capture, LLM et journal.

## Prochaine etape

La prochaine etape du cahier est WF3 : pour une decision `reporting`, appeler
le bridge d'ecriture blockchain, attendre un `txHash` confirme, passer le
rapport a `reported`, puis envoyer l'alerte Discord defangee. Le canal Discord
de revue manuelle doit aussi etre raccorde aux decisions `manual_review`.
