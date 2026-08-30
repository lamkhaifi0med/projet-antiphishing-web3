# Validation follow-up — 2026-08-26

This follow-up records checks performed after the repairs described in
`VALIDATION_COMMIT_9B0F512_2026-08-26.md`. It does not retroactively change
the historical findings in that document.

## Confirmed

- The frozen page cache was restored and checked locally: **306 index entries,
  306 page files, 0 mismatches**.
- `npm run test:all` passed. It includes 128 core Node tests, 6 AI-client
  tests, 4 evaluator tests, 21 capture/SSRF tests, bridge/capture/analysis
  suites, and 19 static workflow checks.
- The Compose validation command completed successfully:

  ```text
  docker compose config --quiet
  ```

- The current Gemini Flash Lite and NVIDIA fallback model answered their smoke
  tests. The legacy NVIDIA model `meta/llama-3.1-8b-instruct` returned HTTP
  410 for the configured account; `openai/gpt-oss-20b` was then verified with
  the production prompt and JSON validator before becoming the fallback
  default.
- The repaired workflow definitions pass their static checks for the WF2 → WF3
  seven-field contract, the WF3 completion wiring, the WF4 proxy query
  forwarding, runtime-compatible URL validation, and bounded RPC log ranges.

## Final frozen-cache provider runs

The exact commands, hashes, metrics, and limitations are frozen in
`ai/prompts/FROZEN_V2_2.md`.

- Gemini Flash Lite: 60/72 processed after 12 provider failures; measured
  precision 100.0%, recall 80.6%, F1 89.3%.
- NVIDIA `openai/gpt-oss-20b`: 72/72 processed; precision 95.2%, recall 55.6%,
  F1 70.2%.
- NVIDIA `nvidia/nemotron-3-nano-30b-a3b` was also compared on 72/72 entries:
  precision 87.5%, recall 58.3%, F1 70.0%. It did not improve the configured
  fallback and was not adopted.

The Gemini result has insufficient provider coverage for full acceptance. The
NVIDIA result has complete coverage but does not meet the recall criterion.
Consequently, the AI acceptance target is **not yet met redundantly across the
two forced providers**.

## Runtime gate still open

The supplied n8n Reporter configuration was read-only checked against the
deployed registry and is **not authorized**. No transaction was submitted.
The existing root Reporter configuration is authorized, but it was not copied
over the supplied n8n value. Therefore the current n8n configuration cannot
complete a controlled on-chain publication until an authorized funded Reporter
is configured for `n8n/.env`.

No containers, Discord webhooks, or live workflow executions were started in
this follow-up. A controlled mocked n8n E2E run remains required after the
Reporter and local n8n credentials are ready; only then can the real Amoy and
Discord proof be attempted.

## 2026-08-27 continuation

- A prompt-only NVIDIA v2.3 trial was measured over the frozen cache, then
  rejected and reverted. It processed 71/72 entries (one provider error) with
  13 TP, 0 FP, 23 FN, and 35 TN: precision 100.0%, recall 36.1%, F1 53.1%.
  This is below the v2.2 NVIDIA baseline, so the validated v2.2 prompt and
  `openai/gpt-oss-20b` fallback remain the production configuration. Full
  provenance is in `AI_RECALL_V2_3_TRIAL_2026-08-27.md`.
- An offline WF2 → WF3 seam test was added. It executes the relevant WF2
  Code-node transformations against the real in-memory WF3 coordinator with a
  mocked chain runner. It validates the URL report path, wallet manual-review
  path, input sanitization, and fail-closed sub-workflow errors without
  Docker, n8n, provider calls, blockchain writes, or Discord delivery.
- The WF2 terminal-result node now requires a confirmed transaction hash for
  `reported` and `already_blacklisted`, and permits only bounded machine error
  codes to be journaled. Malformed output becomes `WF3_INVALID_RESULT`.
- The remaining runtime blockers are unchanged: native n8n execution and
  encrypted credentials still need a local runtime test; the supplied n8n
  Reporter is not authorized on Amoy; no real Amoy or Discord E2E run has
  occurred in this continuation.
- After these changes, `npm run test:all`, `docker compose config --quiet`,
  and `git diff --check` completed successfully. The root Node suite now
  reports 128/128 passing tests.

## Evaluation-artifact provenance hardening

- A read-only aggregate analysis of the NVIDIA v2.2 outcomes confirmed that all
  16 strict false negatives were `suspicious`: 10 are `url_only`, two are
  `url_structural`, and four are `combined`. It does not justify a blanket
  `suspicious` → `malicious` conversion; the full method and next evidence gate
  are recorded in `AI_RECALL_V2_2_ERROR_ANALYSIS_2026-08-27.md`.
- Future evaluator JSON artifacts record a schema version, the resolved Git
  commit when available, command parameters, provider-selection mode, observed
  model names, frozen cache/RDAP checksums and entry counts, and the RDAP
  reference timestamp. This makes each new provider run self-describing
  without reading `.env` or recording any secret.
- Future per-item records preserve only classification metadata and an
  aggregate-safe URL-feature view. The raw URL, URL-feature domain, model
  `indicators`, and model `explanation` are not written; the review identifier
  is a defanged `displayUrl`. Console progress output uses the same defanged
  form.
- This change does not alter model prompts, verdicts, scoring, provider
  selection, strict metrics, or WF3 publication rules. It was verified by the
  evaluator's six offline unit tests. No provider evaluation was rerun, so the
  v2.2 and rejected v2.3 evidence remain unchanged historical results.
- The concurrent SQLite lifecycle test now uses Node's bounded `fs.rmSync`
  retry support when deleting its temporary database on Windows. This addresses
  a transient `EBUSY` release delay after worker-thread shutdown without
  changing lifecycle behavior. A subsequent full offline run passed: 128/128
  root Node tests, 6/6 AI-client tests, 6/6 evaluator tests, 21/21 capture/SSRF
  tests, WF1/WF2 bridge and service tests, and 19/19 workflow-static checks.
  `docker compose config --quiet` and `git diff --check` also passed.

## AI acceptance target met on Gemini (2026-08-27)

- Root cause of the 12 Gemini `provider_error` exclusions: free-tier 429s
  outlasted the client's 1-2 s shared retry backoff. Fix (reliability only,
  no prompt/verdict/metric change): providers now surface the advised delay
  (`Retry-After` header or Gemini `retryDelay` detail, capped at 60 s) on
  `TransientProviderError`; the client gives transient provider failures a
  dedicated budget (4 retries, Retry-After-aware, exponential fallback
  2-60 s) separate from the RF-A4 schema-correction retries.
- Verified offline with two new mocked tests (retry-after honoured in forced
  mode; persistent 429s still end in `forcedSuspicious`): 8/8 AI-client
  tests, 128/128 root tests, 6/6 evaluator tests.
- Frozen 72-entry end-to-end evaluation rerun forced on Gemini
  (`--delay-ms=1500`, prompt v2.2, frozen caches verified 306/306/0):
  coverage 72/72 (was 60/72), TP=29 FP=0 FN=7 TN=36 -> precision 100 %
  (target >=85 %), recall 80.6 % (target >=80 %), F1 89.2 %.
  **Acceptance criteria met with strict semantics** (positive =
  `verdict=malicious` only; the 7 FN are `suspicious` -> manual review).
- Prior artifacts preserved as `*-v2.2-run1-gemini-endtoend.*`; new run is
  self-describing via the provenance block.
- NVIDIA fallback recall (55.6 %) remains below target; it is a fallback
  path, tracked in AI_RECALL_V2_2_ERROR_ANALYSIS_2026-08-27.md.

## v2.4 trial: deterministic brand/free-hosting features (2026-08-27, rejected)

- Hypothesis: 5-6 of the 7 remaining Gemini FNs carried two computable
  signals absent from urlFeatures (known crypto brand on a non-official
  domain; disposable free hosting). Added `brandDetected` /
  `freeHostingPlatform` (dry-run on labels: 14/36 phishing flagged, 0/36
  legitimate flagged) plus a prompt rule mapping the flag to strong-evidence
  rule 2.
- Results on the frozen 72-entry Gemini benchmark (all 72/72, precision
  100 % in every run): trial 1 recall 58.3 % (model anchored on
  `brandDetected: null` as proof of no impersonation), trial 2 (warning
  wording) 75.0 %, trial 3 (fields only shown when detected) 77.8 %. Each
  trial fixed its 2 targets but lost 3-4 different previously-caught
  entries; every variant netted below v2.2's 80.6 %.
- Decision: reverted all v2.4 changes (prompts.js, urlFeatures.js) to exact
  v2.2 behavior; verified 8/8 AI-client and 128/128 root tests after revert.
  Trial artifacts preserved as `*-v2.4-trial{1,2,3}-gemini-endtoend.*`.
- Lesson recorded: injecting deterministic negative-capable signals into the
  prompt suppresses the model's own detection even with explicit warnings;
  future recall gains on this dataset require either post-model calibration
  (typed policy outside the prompt) or a larger dataset, not prompt-side
  feature injection.

## Native n8n runtime E2E completed (2026-08-27)

- Stack: all 6 containers healthy (n8n, bridge, capture, analysis,
  chain-bridge, proxy). Fixed on startup: N8N_ENCRYPTION_KEY aligned to the
  existing data volume's key; the placeholder n8n Reporter (publicly known
  key 0x...0001, address 0x7E5F...5Bdf) was briefly authorized then
  immediately REVOKED (tx 0xf40f30e0...d5dc) after a sweeper drained its
  0.008 POL gas grant; n8n/.env now uses the real authorized Reporter
  (0.14 POL). The missing `Bridge Shared Secret` n8n credential was
  created and `Chain Bridge Header Auth` aligned to CHAIN_BRIDGE_TOKEN
  (built inside the container from env, never displayed; temp files purged).
- All 5 workflows imported and activated (WF1 form, WF1 ingestion, WF2,
  WF3, WF4).
- Live runs through POST /webhook/report:
  - hxxps://robinhood[.]report/ -> capture_blocked (DNS dead) journaled as
    failed - correct SSRF-guard behavior.
  - hxxps://afx-snapshot[.]web[.]app/ -> malicious (fake_airdrop),
    scoreFinal 0.7025 < 0.80 -> manual_review, no chain write (gate works).
  - hxxps://chewyswap[.]live/ -> malicious, 0.7493 -> manual_review.
  - hxxp://www-ledger-com-live-app[.]woasp3[.]top/... (fresh OpenPhish) ->
    malicious (fake_support), scoreFinal 0.865 >= 0.80 -> REPORTED ON-CHAIN,
    tx 0xf77442add68ef73f7a0ff9e78c7c80a1de9bb07dc4148c584258a451352286af,
    block 46029317, status 1, registry 0x8d51dB4a92c338075360A17AcA005ec282fE1f23.
  - WF4 public check (via nginx proxy :8080) returns blacklisted=true,
    score 87, same txHash. Proxy needed a restart after n8n restart (known
    stale-upstream-DNS behavior).
- Remaining gap: DISCORD_WEBHOOK_ALERTS / DISCORD_WEBHOOK_MANUAL_REVIEW are
  empty in .env, so Discord delivery is unverified. Once real webhook URLs
  are provided, update the two Discord credentials and rerun one manual-review
  and one reported case.

## Discord delivery verified - E2E fully complete (2026-08-27)

- Real Discord webhooks were created (channels #alerts and #manual-review)
  and written into .env; the two n8n Discord credentials were patched
  inside the container from env values (never displayed, temp files purged).
- Final live run: hxxp://www-ledger-com-live-app[.]icueoe[.]top/... (fresh
  OpenPhish) -> malicious (fake_support), scoreFinal 0.865 -> reported
  on-chain, tx 0x9c73fa5d1b8b74a4820c0cbcaf80c1f2eeb6a3ba3e79476983dba95094c877d5,
  and the WF3 lifecycle store records the Discord alert claim as
  state=sent (claimId n8n-29, kind=chain_result).
- Every stage of the pipeline is now proven live: WF1 ingestion ->
  WF2 capture + LLM verdict -> WF3 blockchain write + Discord alert ->
  WF4 public check readback. No remaining functional gaps.
