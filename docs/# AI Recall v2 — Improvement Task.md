# AI Recall v2 — Improvement Task

Hi,

First, **you did a genuinely good job on the AI module**.

The current implementation already provides a strong foundation:

- a documented and traceable dataset;
- isolated page capture with SSRF protections;
- a frozen cache index for reproducibility;
- strict JSON output validation;
- prompt-injection protection;
- Gemini with NVIDIA fallback;
- retries and safe `suspicious` fallback behavior;
- an honest evaluation report exposing the current limitation.

The current recall of **46.2% does not mean the whole implementation is wrong**. On the contrary, the evaluation successfully identified a specific policy bottleneck that can now be corrected in v2.

This document describes the requested improvement precisely.

---

## 1. Objective

Improve the detector while preserving honest evaluation:

- **Strict precision:** at least 85%
- **Strict recall:** at least 80%
- Only `verdict === "malicious"` counts as a positive prediction.
- `suspicious` remains a manual-review result and must not be counted as malicious.

Do not improve the numbers by changing labels, excluding difficult cases, or redefining the metric.

---

## 2. Current diagnosis

The current report in [ai/eval/report-v1.md](ai/eval/report-v1.md) shows:

| Metric    | Result |
| --------- | -----: |
| TP        |      6 |
| FP        |      0 |
| FN        |      7 |
| TN        |     19 |
| Precision |   100% |
| Recall    |  46.2% |
| F1        |  63.2% |

The important subgroup results are:

- Gemini: **6 TP, 0 FN, 1 TN**
- No model used: **0 TP, 7 FN, 18 TN**

Therefore, Gemini is not currently the main source of false negatives. All seven false negatives came from the `none` group.

The cause is the current content-quality short circuit:

1. [ai/lib/contentQuality.js](ai/lib/contentQuality.js) declares content unusable when:
   - text is shorter than 200 characters; or
   - an anti-bot challenge is detected.
2. [ai/client/llmClient.js](ai/client/llmClient.js) immediately returns `suspicious`.
3. No URL analysis or LLM analysis is performed.
4. [ai/eval/evaluate.js](ai/eval/evaluate.js) applies the same behavior.
5. Because strict evaluation treats `suspicious` as negative, phishing cases become false negatives.

### Main v2 principle

The 200-character rule should select the **analysis mode**, not directly decide the **verdict**.

---

## 3. Work in a dedicated branch

Create a branch:

```bash
git switch -c feat/ai-recall-v2
```

Requirements:

- Do not modify the blockchain contract.
- Do not modify blockchain interaction scripts.
- Do not overwrite the v1 report.
- Submit the work through a pull request.
- Keep each logical change in a clear commit.
- Do not commit API keys or the private page cache.

Suggested commit separation:

1. evaluator diagnostics;
2. URL-feature implementation;
3. URL-only analysis;
4. tests;
5. documentation;
6. v2 evaluation report.

---

## 4. Preserve the baseline before modifying behavior

Before implementing v2:

1. Preserve the original private capture cache.
2. Confirm that it corresponds exactly to [ai/dataset/final/cache-index.json](ai/dataset/final/cache-index.json).
3. Run the existing integrity verification.
4. Record:
   - Git commit SHA;
   - cache-index SHA-256;
   - evaluation date;
   - exact command;
   - provider;
   - exact model name;
   - prompt version;
   - processed and excluded counts.
5. Preserve [ai/eval/report-v1.md](ai/eval/report-v1.md) unchanged.
6. If quota permits, reproduce the v1 result before changing the code.

The existing 40-entry report is consistent with an evaluation using `--limit=20`, but please confirm and document the exact original command.

The same frozen dataset and cache must be used when comparing v1 and v2.

---

## 5. Introduce evidence-based analysis modes

Refactor `analyze()` in [ai/client/llmClient.js](ai/client/llmClient.js) so unavailable semantic text does not automatically end the analysis.

Use the strongest safe evidence available.

### Mode 1: `combined`

Use when page text is usable.

Inputs:

- URL;
- deterministic URL features;
- page-text excerpt;
- structural digest.

### Mode 2: `url_structural`

Use when text is short or empty, but the structural digest contains useful information.

Inputs:

- URL;
- deterministic URL features;
- form-field metadata;
- external-script domains;
- Web3 pattern snippets.

Do not discard a useful structural digest merely because visible text is shorter than 200 characters.

### Mode 3: `url_only`

Use when semantic content and structural evidence are unavailable or unusable.

Inputs:

- URL;
- deterministic URL features.

### Expected selection logic

```js
const quality = assessContentQuality(textExcerpt);
const hasStructuralEvidence = hasMeaningfulStructuralDigest(structuralDigest);

let analysisMode;

if (!quality.unusable) {
  analysisMode = "combined";
} else if (quality.reason !== "challenge_page" && hasStructuralEvidence) {
  analysisMode = "url_structural";
} else {
  analysisMode = "url_only";
}
```

An anti-bot challenge should normally select `url_only`, because challenge-page forms and scripts may belong to the protection service rather than the submitted website.

### Required verdict behavior

- Missing content is not evidence that a URL is legitimate.
- Missing content is not sufficient by itself to declare a URL malicious.
- Strong URL or structural evidence may produce `malicious`.
- Ambiguous evidence must produce `suspicious`.
- Provider failure or invalid output after all retries must produce `suspicious`.
- A valid `suspicious` model response must set `manualReview: true`.

### Required metadata

Every returned result should include:

```js
{
  (analysisMode,
    qualityReason,
    verdict,
    confidence,
    category,
    indicators,
    explanation,
    manualReview,
    modelUsed,
    modelName,
    latencyMs,
    retries);
}
```

Refactor the provider call, JSON parsing, schema validation and retry loop into one internal helper. All three modes must use exactly the same validation and fallback behavior.

---

## 6. Add dedicated prompt builders

Update [ai/client/lib/prompts.js](ai/client/lib/prompts.js).

Keep the existing combined prompt and add builders such as:

- `buildCombinedPrompt()`
- `buildUrlStructuralPrompt()`
- `buildUrlOnlyPrompt()`

The current `buildUserPrompt()` may remain as a backward-compatible alias if needed.

### URL-only prompt requirements

The URL-only prompt must:

1. Reuse the checklist from [ai/prompts/url-analysis.md](ai/prompts/url-analysis.md).
2. State explicitly that page content is unavailable.
3. Explain that missing page content is neutral evidence.
4. Include the submitted URL.
5. Include only typed deterministic URL features.
6. Never include dataset metadata.
7. Require strong objective evidence for `malicious`.
8. Prefer `suspicious` when evidence is insufficient.
9. Require output conforming to [ai/prompts/output-schema.json](ai/prompts/output-schema.json).

Example structure:

```text
# URL-only phishing analysis

Page text could not be safely or meaningfully extracted.
This absence is neither malicious nor legitimate evidence.
Evaluate only the URL structure and deterministic features below.

<<<URL>>>
{submitted URL}
<<<END_URL>>>

<<<URL_FEATURES>>>
{bounded JSON containing calculated features}
<<<END_URL_FEATURES>>>

Return only JSON conforming to output-schema.json.
```

Update [ai/prompts/system.md](ai/prompts/system.md) to document the new `URL_FEATURES` section.

All submitted strings must remain data, never instructions. Do not insert raw RDAP responses or uncontrolled text into the prompt.

### Never send these fields to the model

Do not include:

- `label`;
- expected `category`;
- `notes`;
- `source`;
- `sourceRef`;
- `categoryConfidence`;
- whether the URL came from the phishing or legitimate dataset.

Sending any of those fields would leak the expected answer and invalidate the evaluation.

---

## 7. Implement deterministic URL features

Implement the specification in [ai/prompts/url-features-scoring.md](ai/prompts/url-features-scoring.md).

The specified formula is:

$$
\text{score}_{URL}
=
0.30s_{\text{TLD}}
+
0.25s_{\text{age}}
+
0.20s_{\text{homoglyph}}
+
0.15s_{\text{subdomains}}
+
0.10s_{\text{shortener}}
$$

Create a dedicated module next to [ai/lib/contentQuality.js](ai/lib/contentQuality.js).

It should return a bounded typed object similar to:

```js
{
  hostname: "example.invalid",
  registrableDomain: "example.invalid",
  publicSuffix: "invalid",
  subdomainCount: 0,
  finalUrlKnown: false,
  scores: {
    tld: 0,
    whoisAge: 0.5,
    homoglyph: 0,
    subdomains: 0,
    shortener: 0
  },
  score: 0.125,
  indicators: [],
  rdap: {
    status: "unavailable",
    createdAt: null,
    ageDays: null,
    queriedAt: null
  }
}
```

### 7.1 URL parsing

Requirements:

- Use the standard `URL` parser.
- Reject unsupported protocols.
- Handle invalid URLs without crashing.
- Normalize hostnames consistently.
- Ignore fragments.
- Treat ports and paths separately from hostname features.
- Handle IP-literal hosts explicitly instead of treating the final number as a TLD.

### 7.2 Public suffix and registrable domain

Use a Public Suffix List implementation such as `tldts`.

If a dependency is added, update [package.json](package.json) and its dependency lock consistently.

Requirements:

- Do not identify the registrable domain by simply taking the last two labels.
- Correctly handle suffixes such as `co.uk`.
- Enable private-domain handling for hosted services when supported.
- Document limitations for platforms such as hosted application providers.

### 7.3 Suspicious TLD score

Use the closed list documented in the specification.

```js
scoreTld = suspiciousTlds.has(publicSuffix) ? 1 : 0;
```

A suspicious TLD by itself must never automatically produce a malicious verdict.

### 7.4 Domain-age score

Use frozen RDAP or WHOIS metadata for the registrable domain.

Normalization:

```js
function scoreDomainAge(ageDays) {
  if (ageDays === null) return 0.5;
  if (ageDays <= 7) return 1;
  if (ageDays >= 365) return 0;
  return 1 - (ageDays - 7) / (365 - 7);
}
```

Requirements:

- Cache `queriedAt`, `createdAt`, status and source.
- Use a fixed evaluation reference date.
- Never query RDAP during frozen evaluation.
- An unavailable creation date produces `0.5`.
- Document that the age of a parent hosting domain does not reveal the creation age of an individual hosted subdomain.

### 7.5 Punycode and homoglyph detection

Requirements:

- Detect `xn--` in any hostname label.
- Safely decode to Unicode only for analysis.
- Detect only characters from a documented confusion table.
- Never execute or resolve the hostname.
- Return both the boolean result and a short bounded indicator.
- Do not classify every non-ASCII domain as malicious automatically.

### 7.6 Subdomain score

Count labels before the registrable domain:

```js
function scoreSubdomains(count) {
  if (count <= 1) return 0;
  if (count === 2) return 0.5;
  return 1;
}
```

Do not count dots in the path or query string.

### 7.7 URL-shortener score

Use the closed list in the specification.

- Score the original submitted domain.
- If a frozen capture already contains a validated `finalUrl`, it may be reported separately.
- Never resolve a shortener during evaluation.
- Never perform a new network fetch.

### 7.8 Brand impersonation and typosquatting

The existing URL prompt already asks the model to detect brand impersonation.

A deterministic brand-similarity signal may also be implemented, but it must not silently alter the frozen five-feature weights.

If added:

- use an independently documented list of Web3 brands and official domains;
- compare brand tokens only against hostname labels;
- ensure official domains are not flagged;
- detect low edit distance, substitutions and misleading hosted subdomains;
- return it as additional evidence;
- document any change to scoring as a versioned v2 specification.

Never hardcode individual final-test URLs.

---

## 8. Correct final-score semantics

The output field `confidence` should represent confidence in the returned verdict. A confidence of `0.98` for `legitimate` must not be interpreted as 98% phishing risk.

Convert verdict confidence to an LLM risk:

```js
function toLlmRisk({ verdict, confidence }) {
  if (verdict === "malicious") return confidence;
  if (verdict === "legitimate") return 1 - confidence;
  return 0.5;
}
```

Then calculate:

```js
const llmRisk = toLlmRisk(result);
const scoreFinal = 0.7 * llmRisk + 0.3 * urlFeatureScore;
```

The on-chain publication gate remains:

```js
result.verdict === "malicious" && scoreFinal >= 0.8;
```

A feature score must not silently convert `legitimate` or `suspicious` into an on-chain publication.

The strict classification evaluation must continue to use the model verdict:

```js
const predictedMalicious = verdict === "malicious";
```

Do not use `scoreFinal >= 0.80` as a replacement definition unless the project specification is formally changed and the baseline is recomputed.

---

## 9. Resolve the evaluation-scope inconsistency

There is currently an inconsistency:

- [ai/dataset/README.md](ai/dataset/README.md) says only `ok` captures enter the official content evaluation.
- [ai/eval/evaluate.js](ai/eval/evaluate.js) currently processes `ok`, `empty` and `challenged`.

Please resolve this explicitly rather than silently changing one side.

Add two evaluation scopes.

### Scope A: content-only

Purpose: measure model quality when usable page content exists.

Rules:

- Process only `status === "ok"`.
- Use `combined` analysis.
- Skip other capture statuses.
- Report skipped cases by label and status.
- Report classification coverage.

### Scope B: end-to-end

Purpose: measure the complete detector on submitted URLs.

Rules:

- Process every dataset entry with a frozen cache record.
- `ok` → `combined`
- `empty` with useful digest → `url_structural`
- `empty` without useful digest → `url_only`
- `challenged` → `url_only`
- `dead` → `url_only`
- `refused` → `url_only`
- `blocked` → `url_only`
- `skipped` → `url_only`
- missing cache record → exclude as `not_captured`
- never refetch during evaluation.

Until the team or supervisor confirms which scope is the formal acceptance metric, publish both and label them clearly.

---

## 10. Improve evaluator diagnostics

Extend [ai/eval/evaluate.js](ai/eval/evaluate.js) with an explicit option such as:

```bash
node ai/eval/evaluate.js --scope=content --provider=gemini --prompt-version=v2
node ai/eval/evaluate.js --scope=end-to-end --provider=gemini --prompt-version=v2
```

For each processed entry, record:

```js
{
  (defangedUrl,
    label,
    captureStatus,
    analysisMode,
    qualityReason,
    verdict,
    confidence,
    predictedMalicious,
    urlFeatureScore,
    scoreFinal,
    modelUsed,
    modelName,
    retries,
    classificationOutcome);
}
```

`classificationOutcome` should be one of:

- `TP`
- `FP`
- `FN`
- `TN`

### Required report sections

Every v2 report should include:

1. Git commit SHA.
2. Cache-index checksum.
3. Dataset sizes.
4. Evaluation scope.
5. Prompt version.
6. Provider and exact model.
7. Exact command.
8. Processed count.
9. Excluded count by reason.
10. Coverage overall and by real label.
11. Confusion matrix.
12. Precision, recall and F1.
13. Metrics by analysis mode.
14. Metrics by capture status.
15. Metrics by provider.
16. Defanged false-positive list.
17. Defanged false-negative list.
18. Remaining limitations.

Never include raw hostile page content in the report.

### Strict and triage metrics

Strict metric:

```js
predictedPositive = verdict === "malicious";
```

An additional triage metric may be reported:

```js
triagePositive = verdict === "malicious" || verdict === "suspicious";
```

However, triage recall must never replace strict recall in the acceptance result.

---

## 11. Required offline tests

Expand [ai/client/test.js](ai/client/test.js) and add focused tests for URL features and evaluator behavior.

All unit tests must be offline. Mock every provider or network dependency.

### Analysis-mode tests

1. Text of 199 characters selects a non-combined mode.
2. Text of 200 characters follows the documented boundary.
3. Challenge content selects `url_only`.
4. Short content with useful structural evidence selects `url_structural`.
5. Usable text selects `combined`.
6. Missing content never automatically produces `legitimate`.
7. URL-only mode actually calls the model.
8. Combined mode includes text and digest.
9. Dataset labels and notes never appear in prompts.

### Provider and validation tests

10. Gemini success returns a valid result.
11. Gemini HTTP 429 still falls back to NVIDIA.
12. Gemini HTTP 500 falls back to NVIDIA.
13. A permanent Gemini HTTP 400 does not incorrectly trigger fallback.
14. Invalid JSON triggers a retry.
15. Schema-invalid JSON triggers a retry.
16. Valid output after a retry is accepted.
17. Exhausted retries return `suspicious`.
18. Forced-provider mode does not switch provider.
19. `manualReview` is true for `suspicious`.
20. No secret or page content is written to diagnostic logs.

### URL-feature tests

21. Normal TLD score.
22. Suspicious TLD score.
23. Punycode detection.
24. Documented homoglyph detection.
25. Zero subdomains.
26. One subdomain.
27. Two subdomains.
28. Three or more subdomains.
29. Known shortener.
30. Unknown shortener.
31. Domain age at seven days.
32. Domain age between seven and 365 days.
33. Domain age at 365 days.
34. Missing domain age returns `0.5`.
35. URL score remains inside $[0,1]$.
36. Invalid URL fails safely.
37. Query-string dots do not affect subdomain count.
38. Private hosted-domain parsing is tested.

### Evaluator tests

39. TP/FP/FN/TN updates are correct.
40. Strict recall treats `suspicious` as negative.
41. Content scope processes only `ok`.
42. End-to-end scope routes unavailable content to URL-only analysis.
43. Missing cache records are reported separately.
44. No evaluation test performs a real fetch.

Use synthetic `.invalid` entries for prompt and client tests. Do not manually open or fetch real phishing URLs.

---

## 12. Evaluation protocol

Run work in this order:

### Phase 1: implementation verification

1. Run all offline unit tests.
2. Confirm no test makes a real network request.
3. Confirm prompts do not contain labels or source metadata.
4. Confirm schema validation remains unchanged.

### Phase 2: development evaluation

Use only the synthetic development dataset to refine:

- prompt wording;
- analysis-mode routing;
- deterministic feature behavior;
- error handling.

Do not tune individual rules against failures from the final test set.

### Phase 3: frozen pilot comparison

Run v1 and v2 against the exact same 40-entry subset.

The existing pilot contains 13 measured phishing cases:

$$
TP + FN = 6 + 7 = 13
$$

To reach 80% recall:

$$
\lceil 13 \times 0.80 \rceil = 11
$$

Therefore, v2 needs at least 11 TP on that exact pilot.

With 11 TP, no more than one FP is allowed to keep precision at or above 85%:

$$
\frac{11}{11+1} \approx 91.7\%
$$

but:

$$
\frac{11}{11+2} \approx 84.6\%
$$

The first-20-per-class pilot is useful for comparison but must not be presented as representative of the complete dataset.

### Phase 4: complete frozen evaluation

Run both scopes on the complete dataset:

- 36 phishing entries;
- 260 legitimate entries.

For full end-to-end recall of at least 80%:

$$
\lceil 36 \times 0.80 \rceil = 29
$$

At least 29 phishing URLs must receive `malicious` under the strict end-to-end definition.

Run Gemini and NVIDIA separately against the same frozen inputs when quota permits.

Do not silently use fallback when producing a provider-comparison table.

---

## 13. Security and reproducibility constraints

Do not:

- manually open real phishing URLs;
- fetch them from the host machine;
- refetch during evaluation;
- execute page JavaScript;
- commit the private page cache;
- commit raw hostile page content;
- commit API keys;
- place secrets in tests;
- send labels or source metadata to the LLM;
- log complete hostile content;
- follow redirects outside the existing secure capture process;
- weaken SSRF protections to obtain more content.

The warning and cache policy in [ai/dataset/README.md](ai/dataset/README.md) remain mandatory.

---

## 14. Prohibited metric shortcuts

Do not improve recall by:

- counting `suspicious` as `malicious`;
- changing labels;
- deleting false negatives;
- excluding short pages only because they are difficult;
- changing dataset order;
- replacing the frozen cache;
- adding special rules for exact test domains;
- lowering thresholds without measuring false positives;
- reporting only the best provider;
- reporting a subset without coverage;
- using dataset `notes` as model evidence;
- using `source === "PhishTank"` or `source === "ScamSniffer"` as a feature.

The objective is to improve general detection, not fit the final test labels.

---

## 15. Pull-request deliverables

The pull request should contain:

- [ ] Refactored analysis-mode selection.
- [ ] URL-only prompt.
- [ ] URL-plus-structural prompt.
- [ ] Deterministic URL-feature implementation.
- [ ] Correct LLM-risk conversion.
- [ ] Content-only evaluator scope.
- [ ] End-to-end evaluator scope.
- [ ] Detailed FP/FN diagnostics.
- [ ] Offline tests.
- [ ] Updated documentation.
- [ ] Preserved v1 report.
- [ ] Versioned v2 report.
- [ ] Gemini/NVIDIA comparison, if quotas permit.
- [ ] Exact reproduction commands.
- [ ] Cache-index checksum.
- [ ] Test output.
- [ ] Remaining-limitations section.

The private capture cache must remain outside Git.

---

## 16. Definition of done

The task is complete when:

1. All offline tests pass.
2. Cache integrity passes.
3. No real phishing URL was manually opened.
4. No secret or hostile cache content was committed.
5. v1 remains reproducible.
6. v2 reports content-only and end-to-end metrics separately.
7. Strict precision is at least 85%.
8. Strict recall is at least 80%, or the report honestly explains why the target remains unmet.
9. Every FP and FN has a documented, defanged error analysis.
10. The pull request is reviewed before merging.

The most important change is:

> **Keep the 200-character rule for selecting available evidence, but remove it as an automatic verdict decision. Analyze the URL—and any safe structural evidence—even when visible page text is unavailable.**

Thanks again for the strong v1 foundation. This task is an iteration on good work, not a restart.
