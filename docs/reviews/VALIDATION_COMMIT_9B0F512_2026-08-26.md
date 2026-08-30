# Validation of commit `9b0f512` — 2026-08-26

## Executive summary

Commit `9b0f5128e5d063c24c16f5b9ed8e6ec3031449ee` is a major repair over the broken `57747f0` merge. The source now parses, Compose validates, all offline tests pass, both configured AI providers work, WF1 → WF2 works live for a safe URL, and the chain-bridge backend can publish and settle a synthetic Amoy report safely.

The complete application is **not ready for an end-to-end claim**. Runtime validation found blockers that static tests do not detect:

1. WF2 never invokes WF3.
2. The exported WF3 n8n graph does not advance beyond `Execute Secured WF3`; the lifecycle remains with a pending alert.
3. The public WF4 proxy drops query parameters.
4. WF4's URL branch always rejects valid URLs in the tested n8n Code-node runtime.
5. The configured free dRPC endpoint rejects historical event searches spanning more than 10,000 blocks, so checks of active blacklist entries fail while looking up the transaction hash.
6. The WF1/WF2 JSONL journal still reports both concurrent duplicate inserts as newly created.
7. The final private capture cache is missing locally, so the committed end-to-end AI comparison cannot be reproduced here.

## Safety and test isolation

- Local `main` was fast-forwarded to `9b0f512`; no merge commit was created.
- Existing untracked documentation was preserved.
- `n8n/.env` remained ignored and untracked.
- Missing bridge/AI variables were merged into the ignored local environment without replacing the existing n8n encryption key or Reporter key.
- The Reporter private key was never printed. Its derived public address was verified as an authorized Amoy Reporter.
- Docker validation used fresh, explicitly named n8n, journal, and lifecycle volumes.
- No real Discord webhook was available. Discord tests used a local mock endpoint only.
- One controlled blockchain write used a unique reserved `.invalid` URL.
- No real phishing URL was fetched.
- All disposable containers, networks, mock processes, temporary files, and validation volumes were removed afterward. Original persistent volumes were preserved.

## Confirmed passing results

### Repository and offline validation

- No unresolved Git conflict markers.
- All JavaScript syntax checks passed.
- Docker Compose parsed successfully.
- Dependency installation reported zero known vulnerabilities.
- Editor diagnostics: none.
- `npm run test:all`: passed.
  - Existing blockchain/WF3/WF4 tests: 118/118.
  - AI client: 6/6.
  - Evaluator: 4/4.
  - Capture/SSRF library: 21/21.
  - WF1/WF2 bridge: 12/12.
  - Capture service: 5/5.
  - Analysis service: 24/24.
  - Workflow static checks: 19/19.

### Docker and n8n

All six services built and started from the current source:

- n8n;
- reverse proxy;
- WF1/WF2 bridge;
- capture service;
- analysis service;
- chain bridge.

All service health checks passed. The five committed workflow exports imported and published successfully on n8n 2.31.6.

### Live AI providers

The configured Gemini and NVIDIA credentials both worked independently.

Prompt-injection case, forced provider with no fallback:

| Provider                            | Result      | Schema   | Retries |
| ----------------------------------- | ----------- | -------- | ------: |
| Gemini `gemini-flash-lite-latest`   | `malicious` | accepted |       0 |
| NVIDIA `meta/llama-3.1-8b-instruct` | `malicious` | accepted |       0 |

Balanced synthetic development sample, five phishing plus five legitimate cases per forced provider:

| Provider |   n |  TP |  FP |  FN |  TN | Schema accepted | Provider errors |
| -------- | --: | --: | --: | --: | --: | --------------: | --------------: |
| Gemini   |  10 |   5 |   0 |   0 |   5 |           10/10 |               0 |
| NVIDIA   |  10 |   5 |   0 |   0 |   5 |           10/10 |               0 |

This sample is encouraging but is not a substitute for the final frozen 72-entry evaluation.

### Live WF1 → WF2

A safe report for `https://www.wikipedia.org/` was submitted through the public reverse proxy:

- public response: HTTP 202;
- initial status: `queued`;
- final journal status: `analyzing`;
- verdict: `legitimate`;
- decision: `logged_only`;
- model: Gemini;
- error: none.

Malformed inputs were rejected with HTTP 400, including an unexpected field, a credential-bearing URL, and an unsupported type. The proxy returned HTTP 403 for the n8n administrative REST path.

The live capture service rejected a loopback target before fetching it:

- input class: `127.0.0.1`;
- response: rejected;
- reason: private/reserved IP blocked by SSRF protection.

### Chain backend and controlled Amoy write

The preserved local Reporter account was confirmed:

- chain ID: 80002 (Polygon Amoy);
- Reporter authorized by the deployed registry: yes;
- testnet balance available: yes.

The chain-bridge manual-review protocol passed directly:

- execute → `manual_review`;
- claim authorized;
- channel selected: `manual_review`;
- Discord payload constructed;
- settle persisted alert state `sent`;
- final lifecycle revision: 4.

A controlled malicious report for a unique reserved `.invalid` URL was published:

- lifecycle status: `reported`;
- decision: `report`;
- score: 91;
- on-chain entry active: yes;
- receipt status: 1;
- transaction: https://amoy.polygonscan.com/tx/0x078796748e25582212cb47de823bbfdf010ce5505674dea629959a625e5cfc72
- exact replay returned the existing terminal result with `alertRequired=false`, without another transaction.

The synthetic `.invalid` registry entry remains active for audit/demo purposes.

## Blocking findings

### P0 — WF2 does not call WF3

The current WF2 graph ends at `Journaliser resultat`. It records `decision=reporting` or `manual_review` but contains no Execute Sub-workflow node and no call to the WF3 chain bridge.

Evidence:

- `n8n/workflows/WF2_Analyse.json` connects `Preparer resultat` only to `Journaliser resultat`.
- `docs/RAPPORT_TRAVAUX_PROFIL_B_WF2.md` explicitly describes WF3 as the next step.

Impact: a malicious WF1/WF2 report can never reach Polygon or Discord automatically.

### P0 — WF3 n8n graph stalls after its first secured action

The committed WF3 backend logic is healthy, but the exported n8n graph did not complete in live validation.

Observed on both n8n 2.31.6 and 2.32.7:

1. WF3 called `/internal/wf3/execute` successfully.
2. SQLite reached `status=manual_review`, `decision=manual_review`, revision 2, alert state `pending`.
3. The graph did not reach `/internal/wf3/claim`.
4. The local Discord mock received zero requests.
5. No settlement occurred through n8n.

A disposable direct-trigger copy preserving all original action/merge/claim/Discord/settle nodes reproduced the same stop. The boundary to inspect is `Merge Execution Context` and the fan-out/fan-in wiring around `Execute Secured WF3`.

Impact: even after WF2 is connected, WF3 currently leaves final alerts pending.

### P0 — WF4 reverse proxy drops query parameters

The proxy uses a variable-based `proxy_pass` with a replacement URI:

`proxy_pass $upstream/webhook/check;`

Runtime comparison using the same request:

- direct n8n wallet check: HTTP 200, `blacklisted=false`;
- proxied wallet check: HTTP 400, `INVALID_TYPE`.

The proxied request loses `?type=...&value=...`.

Impact: public `/webhook/check` is unusable for both URL and wallet queries.

### P0 — WF4 URL validation is incompatible with the tested Code-node runtime

The workflow Code node calls `new URL(value)`. In the tested n8n Code-node runtime, the global `URL` constructor was unavailable, and the catch block converted that runtime error into `INVALID_URL`.

Runtime comparison:

- direct valid wallet query: passed;
- direct valid HTTP(S) URL query: HTTP 400 `INVALID_URL`.

Impact: URL checks fail even if the proxy query forwarding is fixed.

### P0 — active-entry checks fail on the configured free RPC plan

`latestTransactionHash()` calls `queryFilter(filter, REGISTRY_DEPLOYMENT_BLOCK)` in one range. The configured dRPC free endpoint returned:

`ranges over 10000 blocks are not supported on free plan`

Consequences:

- direct contract entry read showed the newly published URL is active;
- the transaction receipt was successful;
- `/internal/check` still returned HTTP 502 because historical event lookup failed.

Impact: WF1 deduplication and WF4 fail specifically for active entries—the cases where a transaction hash is needed most.

Possible remedies:

- query indexed events in bounded backward chunks and stop when the latest matching event is found;
- persist/reuse confirmed transaction hashes in a reliable index;
- or use an RPC endpoint supporting the required log range.

### P1 — concurrent journal insert result is wrong

A direct concurrency probe ran two simultaneous `append()` operations with the same `reportId`:

- returned `created`: `[true, true]`;
- persisted line count: 1.

Storage deduplication works, but the second caller is incorrectly told it created the record and can receive HTTP 201. The check must return a per-operation result from inside the serialized queue. Add a concurrent duplicate test, not only the current sequential test.

### P1 — final AI evaluation remains unreproducible here

Present locally:

- committed cache index;
- committed frozen RDAP cache.

Missing locally:

- `ai/dataset/final/.cache/pages/`.

Therefore the final evaluation cannot run without private handoff of the exact cache. It must not be recreated by refetching phishing URLs.

Additional report issues:

- `ai/prompts/FROZEN_V2_1.md` is still marked draft and has missing hashes;
- the committed comparison says the Gemini credential was unusable, but the currently supplied credential worked live;
- provider errors are excluded from the confusion matrix, so reported precision/recall must always be presented beside coverage;
- URL-only evidence hallucination validation remains explicitly unimplemented.

## Recommended repair order

1. Fix WF4 query forwarding and URL validation.
2. Fix active-entry transaction-hash lookup for RPC block-range limits.
3. Repair and live-test the WF3 merge/claim/settle graph.
4. Connect WF2 decisions to WF3 with the exact seven-field contract.
5. Add a controlled WF1 → WF2 → WF3 test using a local Discord mock before any real Discord run.
6. Fix and test concurrent JSONL idempotency.
7. Obtain the exact private capture cache, finalize prompt hashes, and rerun forced Gemini and forced NVIDIA evaluations with coverage reported.
8. Run the final controlled real Discord E2E only after the mocked E2E is green.

## Final assessment

- AI client and core services: strong progress and operational.
- WF1 → WF2: operational for the tested safe URL.
- Chain backend: operational, authorized, transaction-confirmed, and replay-safe.
- WF2 → WF3 integration: absent.
- WF3 n8n completion: failing at runtime.
- WF4 public endpoint: failing at runtime.
- Full E2E readiness: not achieved.
