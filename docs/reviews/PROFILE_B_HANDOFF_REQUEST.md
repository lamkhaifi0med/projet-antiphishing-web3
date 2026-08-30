# Profil B handoff request

**Date:** 2026-08-22  
**Purpose:** Allow Profil A to continue unfinished Profil B work safely.

## What is already available

Commit `57747f0` already contains a copy of the following work:

- AI client, prompts, validators, URL features and evaluation reports;
- WF1 and WF2 workflow exports;
- bridge, capture and analysis services;
- Dockerfiles, Docker Compose draft and documentation.

Those files do not need to be sent one by one. The pushed commit is broken by unresolved conflicts, but its non-conflicting source can still be recovered.

No newer remote commit or branch was available on 2026-08-22.

## What must be requested

### 1. Latest clean source branch

Ask for one Git branch named `handoff/profile-b` containing every correction or unpushed file newer than commit `57747f0`.

It should include, if newer versions exist:

- `ai/client/`
- `ai/features/`
- `ai/lib/`
- `ai/prompts/`
- `ai/eval/`
- `ai/client/test.js` and any other new tests
- `n8n/workflows/WF1_Form.json`
- `n8n/workflows/WF1_Ingestion.json`
- `n8n/workflows/WF2_Analyse.json`
- `n8n/bridge/`
- `n8n/capture/`
- `n8n/analysis/`
- `n8n/docker-compose.yml`
- `n8n/.env.example`
- `n8n/README.md`
- root `package.json` and `package-lock.json`
- any new technical report or test output

The branch must not contain `.env`, API keys, private keys, Discord webhook URLs, the n8n data directory, `node_modules`, or the private page cache.

If there are no newer local files, the author should reply exactly: **“No unpushed source after `57747f0`.”**

### 2. Frozen private capture cache — required for evaluation

Request a private archive containing:

- `ai/dataset/final/.cache/pages/`
- the exact matching `ai/dataset/final/cache-index.json`
- the SHA-256 checksum of the archive
- the SHA-256 checksum of `cache-index.json`

Suggested archive name:

- `capture-cache-2026-07-31.zip`

This archive contains text extracted from real phishing pages. It must be transferred through a private drive, encrypted archive, or USB. It must never be committed to Git, posted in Discord, or opened manually in a browser.

If the cache no longer exists, the author should say so clearly. Do not refetch the final phishing URLs to recreate it.

### 3. Any frozen RDAP/WHOIS metadata

Ask for every private/local file used to determine domain ages during evaluation, including any RDAP/WHOIS cache and its checksum.

If none was created, the author should reply exactly: **“No frozen RDAP/WHOIS data exists; the previous implementation queried live RDAP.”**

### 4. Exact evaluation handoff note

Request a small text file named `PROFILE_B_HANDOFF.md` containing:

- last working Git commit or local branch;
- evaluation date;
- exact Gemini command;
- exact NVIDIA command;
- exact model names actually used;
- prompt version;
- dataset limit and evaluation scope;
- cache-index SHA-256;
- fixed reference date, if one was used;
- which tests passed and their exact commands;
- unfinished tasks;
- known bugs;
- whether any real network request occurs during unit tests or evaluation;
- whether the reported 100% result was content-only or end-to-end.

### 5. n8n handoff information

Request these details without secret values:

- exact n8n image version tested;
- names and types of required n8n credentials;
- names of the Discord alert and manual-review channels;
- workflow import/activation order;
- any manual n8n UI settings not represented in workflow JSON;
- exact Docker start and test commands;
- last successful end-to-end scenario, if one exists;
- sanitized logs or screenshots proving that run, with tokens and hostile URLs removed/defanged.

If no full WF1 → WF2 → WF3 run succeeded, the author should say that directly.

### 6. Access ownership, not credentials

If resources belong to the author, request access transfer rather than secret values:

- add Profil A to the Discord server/channels;
- add Profil A to any shared Gemini/NVIDIA project if appropriate;
- otherwise Profil A will create new API keys under their own account;
- identify any quota or billing limitation;
- identify who owns the n8n instance, if it is not purely local.

## Never request or accept these items

Do not ask the author to send:

- `.env`;
- `GEMINI_API_KEY` or `NVIDIA_API_KEY`;
- `OWNER_PRIVATE_KEY` or `REPORTER_PRIVATE_KEY`;
- seed phrase;
- `N8N_ENCRYPTION_KEY`;
- bridge bearer-token values;
- Discord webhook URLs;
- n8n owner password;
- raw n8n credential exports;
- `n8n/data/` or the n8n database;
- `node_modules/`;
- real phishing pages outside the frozen cache archive.

Use newly generated local secrets and credentials. The Owner key must remain under Profil A control and must never enter n8n.

## Exact message to send

> Hi. Since you are busy, I can continue and finish the Profil B work, but I need a clean handoff. Please send/provide only the items below—do not send any password, API key, private key, seed phrase, `.env`, n8n encryption key, bearer token, or Discord webhook URL.
>
> **1. Latest source:** Please create and push a branch named `handoff/profile-b` containing any corrections or unpushed files newer than commit `57747f0`. Include your latest AI client/prompts/features/evaluator/tests, WF1/WF2 JSON exports, bridge/capture/analysis services, Dockerfiles/Compose, `.env.example`, package files and docs. Resolve all Git conflict markers before pushing. Do not force-push `main`. If nothing newer exists, reply: **“No unpushed source after `57747f0`.”**
>
> **2. Private frozen cache:** Please transfer privately an archive of `ai/dataset/final/.cache/pages/` together with the exact matching `ai/dataset/final/cache-index.json` and SHA-256 checksums for both. Use a private drive, encrypted archive or USB—not Git or Discord—because it contains captured phishing-page text. Do not refetch anything if the cache is missing; just tell me it is missing.
>
> **3. RDAP/WHOIS data:** Please include any frozen/local RDAP or WHOIS metadata used for domain ages, with its checksum. If none exists, reply: **“No frozen RDAP/WHOIS data exists; the previous implementation queried live RDAP.”**
>
> **4. Handoff note:** Please add a short `PROFILE_B_HANDOFF.md` containing the last working commit/branch, exact Gemini and NVIDIA evaluation commands, exact model names, prompt version, dataset limit/scope, evaluation date, cache-index checksum, tests and commands that passed, unfinished tasks, known bugs, and whether the 100% result was content-only or end-to-end.
>
> **5. n8n information:** Please give me the tested n8n image version, credential names/types without values, Discord channel names without webhook URLs, workflow import/activation order, manual UI settings, exact Docker/test commands, and whether a complete WF1 → WF2 → WF3 run ever succeeded. If it succeeded, send only sanitized proof with tokens removed and hostile URLs defanged.
>
> **6. Access:** If a Discord server or AI-provider project is yours, add me as a member or tell me to create my own resources. Do not paste credentials in chat.
>
> Once I have these items, I will restore a clean branch, complete the missing AI modes and evaluation, integrate WF2 with WF3, and run the full test pipeline. Please reply explicitly when an item does not exist so I do not wait for it.

## Minimum needed to start

Work can begin immediately from the pushed commit and existing specifications. The only irreplaceable artifact for reproducing the previous evaluation is the matching private capture cache. If that cache is unavailable, code completion is still possible, but the previous frozen evaluation cannot be reproduced honestly.
