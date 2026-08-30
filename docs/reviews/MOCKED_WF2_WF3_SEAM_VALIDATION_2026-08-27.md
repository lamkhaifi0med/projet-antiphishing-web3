# Mocked WF2 → WF3 seam validation — 2026-08-27

## Scope

An offline integration test now validates the data boundary between the WF2
workflow export and the real WF3 coordinator. It executes the selected WF2
Code-node transformations from `n8n/workflows/WF2_Analyse.json`, uses an
in-memory lifecycle store, and replaces the blockchain runner with a local
mock.

The test does not start n8n or Docker, fetch URLs, call an AI provider, submit
a blockchain transaction, or send a Discord message.

## Covered paths

`test/wf2-wf3-integration.test.js` covers:

1. A synthetic malicious URL analysis becoming the exact seven-field WF3
   contract, then producing a mocked confirmed report and a journal-safe
   terminal result.
2. A synthetic wallet manual-review path reaching WF3 without calling the
   mocked chain runner, then claiming and settling one mock Discord alert.
3. Sanitization and bounding of untrusted indicators before `validateWf3Input`
   receives them.
4. Fail-closed handling for a malformed/unconfirmed WF3 result and for a
   sub-workflow error.

The WF2 `Preparer resultat WF3` node was hardened as part of this validation:
`reported` and `already_blacklisted` results now require a confirmed 32-byte
transaction hash, and only bounded uppercase machine error codes can reach the
WF1/WF2 journal. Any other result becomes `failed` with
`WF3_INVALID_RESULT`.

## Execution evidence

```text
node --test test/wf2-wf3-integration.test.js test/workflow-definitions.test.js
node n8n/test-workflows.js
```

Result on 2026-08-27: **21/21** Node tests and **19/19** workflow-static
checks passed.

## Remaining runtime boundary

This is not a complete n8n E2E demonstration. Native n8n cross-node
expressions, `executeWorkflow` execution, encrypted credentials, and actual
HTTP-node behavior require a running local n8n instance. The controlled runtime
validation remains gated on user-created encrypted credentials and an
authorized, funded Reporter configured in `n8n/.env`; no configuration value
was copied or changed for this test.
