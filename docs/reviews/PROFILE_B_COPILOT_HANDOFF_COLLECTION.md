# Profil B — Copilot handoff collection task

**Prepared:** 2026-08-22  
**For:** Profil B and GitHub Copilot Agent  
**Goal:** Collect the current Profil B work and irreplaceable local artifacts so Profil A can take over and finish it.

---

## Short instructions for the human

1. Open your **actual Profil B project folder** in VS Code.
2. Start GitHub Copilot in **Agent** mode.
3. Attach this file to the chat.
4. Send this one sentence:

> Execute the attached handoff collection task completely. Do not fix or redesign the project. Collect and package my current work exactly as it exists, protect all secrets, and report anything that does not exist.

Copilot should do the inventory and packaging. You should not need to solve the code first.

---

# Instructions for GitHub Copilot Agent

## 1. Mission

Prepare a safe, factual handoff of the current **Profil B / AI and n8n** work to Profil A.

This is a **collection task, not a repair task**:

- Do not solve bugs.
- Do not resolve merge conflicts.
- Do not rewrite reports.
- Do not rerun paid AI evaluations.
- Do not refetch any phishing URL.
- Do not change or force-push `main`.
- Do not delete, reset, clean, stash, or overwrite any working-tree file.
- Do not expose credentials or private captured content.

Continue until all deliverables in section 9 have either been produced or explicitly marked as unavailable.

## 2. Authoritative continuation point

The receiving developer will continue from the friend’s latest pushed work:

- repository: `projet-antiphishing-web3`;
- latest known Profil B commit: `57747f0ed88fd45de598dc140231729d6388050a`;
- subject: `Update my work`;
- pushed date: 2026-08-18;
- previous working integration base: `2e9905982f89ba4e5340995c529528c1357f5470`.

The receiver has an older independent folder named `projet_stage-profile-b-local`, created around 2026-07-31 as a contingency prototype. **That older contingency implementation is not the source of truth and must not replace the August 18 work.**

Your job is to find and hand over:

1. any local source newer than or missing from commit `57747f0`;
2. the private frozen page-capture cache matching the committed index;
3. any frozen RDAP/WHOIS data;
4. non-secret evaluation provenance and result files;
5. non-secret n8n setup information;
6. a precise manifest saying what exists, what does not exist, and what was only inferred.

## 3. Safety rules — mandatory

### 3.1 Never collect, print, copy, archive, commit, or send secret values

Forbidden material includes:

- `.env` and `.env.*`, except sanitized/example templates such as `.env.example`;
- `GEMINI_API_KEY` values;
- `NVIDIA_API_KEY` values;
- `OWNER_PRIVATE_KEY` values;
- `REPORTER_PRIVATE_KEY` values;
- wallet seed phrases or recovery phrases;
- `N8N_ENCRYPTION_KEY` values;
- bridge shared-secret or bearer-token values;
- Discord webhook URLs or tokens;
- n8n owner passwords;
- exported n8n credentials;
- cookies, session tokens, authorization headers;
- raw terminal history if it may contain secrets;
- the n8n database or `n8n/data/`;
- `node_modules/`.

It is safe to record **environment-variable names**, model names, credential display names/types, public contract addresses, public transaction hashes, and public Git commit IDs.

If a file may contain a secret, do not include it. Record only its relative path and the statement `withheld: may contain secrets`.

### 3.2 Never expose hostile cache content

The frozen page cache may contain text extracted from real phishing pages.

- Never print cache-file contents.
- Never open cached URLs in a browser.
- Never refetch those URLs.
- Never commit the cache to Git.
- Never upload the cache to Discord or a public/shared Git service.
- Package it only as the separate private archive described below.

### 3.3 No destructive Git operations

Do not run destructive operations such as:

- `git reset --hard`;
- `git clean`;
- `git checkout -- <path>`;
- forced branch deletion;
- force push;
- history rewriting;
- dropping stashes.

Inventory first and preserve everything.

## 4. Phase A — inventory every possible source of newer work

From the actual repository root, gather facts without modifying files.

### 4.1 Record repository state

Record in the manifest:

- absolute repository path;
- current branch;
- current `HEAD` commit;
- configured remotes, without embedded credentials;
- concise working-tree status;
- local and remote branches with their tips;
- Git worktrees;
- Git stashes;
- commits after 2026-08-18 on every local branch;
- relevant reflog entries after 2026-08-18;
- whether commit `57747f0` is available locally;
- whether any branch or commit contains work newer than `57747f0`.

Use Git metadata, not file timestamps alone. Timestamps may be copied or changed.

### 4.2 Inspect candidate unpushed source

Look for tracked modifications, untracked source files, local commits, stashes, or worktrees affecting:

- `ai/client/`
- `ai/features/`
- `ai/lib/`
- `ai/prompts/`
- `ai/eval/`
- `ai/dataset/` metadata and code, but not `ai/dataset/final/.cache/`
- AI test files
- `n8n/workflows/`
- `n8n/bridge/`
- `n8n/capture/`
- `n8n/analysis/`
- other `n8n/services/`
- `n8n/docker-compose.yml`
- n8n Dockerfiles
- `n8n/.env.example`
- `n8n/README.md`
- root `package.json` and `package-lock.json`
- `.github/workflows/`
- relevant `scripts/` and `test/` files
- Profil B technical reports and test outputs.

Compare all candidate work against commit `57747f0`. Distinguish:

- committed and already present in `57747f0`;
- committed locally after `57747f0` but not pushed;
- uncommitted tracked changes;
- untracked source files;
- stash-only changes;
- duplicate or obsolete drafts.

Do not label a file “newer” merely because its modification date is later.

### 4.3 Produce an as-is source handoff

If local source exists that is not recoverable from `57747f0`, preserve it **as-is**.

Preferred method:

1. Create a new branch named `handoff/profile-b-as-is-2026-08-22` without modifying `main`.
2. Add only verified non-secret source, tests, example configuration, and documentation.
3. Never use `git add -A` or `git add .`; stage explicit safe paths.
4. Inspect the complete staged file list and diff.
5. Scan staged content for likely API keys, private keys, seed phrases, bearer tokens, webhook URLs, passwords, `.env`, cache pages, n8n data, and generated dependency folders.
6. Commit with a message explaining that this is an **as-is handoff snapshot**, not a validated fix.
7. Push only the handoff branch, never `main`, and never force-push.

If creating or pushing a branch is impossible, create both:

- a binary-capable Git patch for tracked changes relative to `57747f0`;
- a separate archive containing safe untracked source files with relative paths preserved.

If no source exists beyond the pushed commit, put this exact statement in the manifest:

> No unpushed source was found after commit `57747f0`.

Do not create artificial changes merely to produce a branch.

## 5. Phase B — collect the private frozen capture cache

### 5.1 Find the cache

Look for the exact directory:

- `ai/dataset/final/.cache/pages/`

Also search other local worktrees or clearly related project copies for a matching cache, but do not use an unrelated older dataset automatically.

Find the corresponding index:

- `ai/dataset/final/cache-index.json`

Record without printing cache content:

- whether the cache exists;
- absolute cache path;
- number of cache files;
- total byte size;
- index path;
- number of index entries;
- earliest and latest capture timestamps found in metadata;
- whether the cache appears to match the index.

### 5.2 Verify integrity locally without network access

Use the repository’s existing `verifyIndexIntegrity()` function if available. The verification must only read local files.

Do not run the complete evaluator as an integrity check because it may call Gemini/NVIDIA. Do not perform any HTTP request.

Record:

- verification command;
- result;
- every mismatch count and reason, but not raw hostile content.

If the verifier cannot run, record the error and continue packaging; do not repair the cache.

### 5.3 Package the cache privately

Create a private archive outside the Git repository, for example:

- `capture-cache-profile-b-2026-08-22.zip`

The archive must contain:

- `ai/dataset/final/.cache/pages/` with relative structure preserved;
- the exact matching `ai/dataset/final/cache-index.json`;
- `CAPTURE_CACHE_MANIFEST.txt` containing file counts, sizes, integrity result, and checksums, but no cache content.

Calculate SHA-256 for:

- the archive;
- `cache-index.json`;
- optionally a deterministic checksum manifest of individual cache files.

Write checksums to:

- `capture-cache-profile-b-2026-08-22.sha256.txt`

Do not place the archive inside the repository. Tell the human to transfer it using a private drive, encrypted archive, or USB—not Git and not Discord.

If no matching cache exists, put this exact statement in the manifest:

> The frozen page-capture cache was not found. Do not refetch the final phishing dataset to recreate it.

## 6. Phase C — collect frozen RDAP/WHOIS data

Search the repository, ignored folders, related worktrees, and local Profil B artifact directories for files that appear to contain frozen or cached:

- RDAP responses;
- WHOIS responses;
- domain creation dates;
- domain-age metadata;
- query timestamps;
- registrable-domain metadata.

Search by paths and names such as `rdap`, `whois`, `domain-age`, `domainAge`, `createdAt`, and relevant cache directories. Do not query the network.

If such data exists:

1. identify which code/evaluation used it;
2. record its schema, number of entries, date range, and relationship to the final dataset;
3. package it separately outside Git unless it is already safely versioned;
4. calculate an archive SHA-256;
5. do not include unrelated secrets.

If it does not exist, put this exact statement in the manifest:

> No frozen RDAP/WHOIS data was found; the previous implementation appears to have queried live RDAP or used unavailable-age defaults.

Do not generate new RDAP data during this handoff.

## 7. Phase D — collect evaluation provenance and non-secret outputs

### 7.1 Locate all relevant outputs

Inventory committed and uncommitted files related to:

- Gemini evaluation;
- NVIDIA evaluation;
- URL-feature-only evaluation;
- confusion matrices;
- false-positive and false-negative analysis;
- latency and retry measurements;
- prompt-version freezes;
- cache-index checksums;
- test logs;
- benchmark commands.

Likely relevant paths include:

- `ai/eval/`
- `ai/results/`
- `ai/EVALUATION.md`
- `ai/prompts/FROZEN_*.md`
- documentation under `docs/`.

Do not copy the receiver’s old July contingency results into the August handoff unless the files genuinely originated from the author’s current work. Mark old/independent results as unrelated.

### 7.2 Build a factual evaluation record

For every reported evaluation, record in `PROFILE_B_HANDOFF_MANIFEST.md`:

- result-file path;
- Git commit used, if known;
- evaluation date, if known;
- exact command, if confirmed;
- provider;
- exact model name;
- prompt version;
- dataset files and split/limit;
- evaluation scope;
- processed count;
- excluded count and reasons;
- phishing and legitimate coverage;
- cache-index SHA-256;
- whether RDAP was frozen or live;
- whether provider fallback was enabled or provider was forced;
- whether any network request occurred;
- whether the result is content-only or end-to-end;
- status: `CONFIRMED`, `INFERRED_FROM_FILES`, or `UNKNOWN`.

Never invent missing provenance. If a command is inferred from documentation, mark it as inferred. If a fact cannot be established, write `UNKNOWN`.

### 7.3 Preserve safe uncommitted results

Package non-secret, non-cache result files that are not already in `57747f0` as safe source artifacts or a separate archive.

Before including any result file:

- ensure it contains no API key, authorization header, private key, webhook URL, raw `.env` value, or raw hostile page body;
- identify whether URLs are raw or defanged;
- record that classification in the manifest.

Do not rerun Gemini or NVIDIA. Do not consume quota.

## 8. Phase E — collect n8n handoff information

Without exporting credentials or the n8n database, record:

### 8.1 Version and deployment

- exact n8n image tag/digest in source;
- exact n8n image currently running, if already running;
- Docker Compose file used;
- service names;
- internal and published ports;
- network names;
- volume names;
- startup command used, if confirmed;
- whether the containers have ever started successfully;
- last known health state, if available without restarting anything.

Do not start, stop, recreate, or update containers solely for handoff collection.

### 8.2 Workflows

For WF1, WF2, WF3, and WF4, record:

- latest JSON export path;
- workflow name and ID from the export;
- whether the export is active or inactive;
- whether it was ever imported into n8n;
- whether it was ever activated;
- import/activation order, if known;
- manual UI changes not present in JSON;
- known missing credentials or placeholder IDs;
- last successful test, if evidenced.

Collect any local workflow export newer than `57747f0` as safe source.

### 8.3 Credentials — names and types only

Record only:

- credential display name;
- credential type;
- workflows/nodes that reference it;
- whether Profil A must recreate it.

Never export credentials and never record values. Examples of acceptable information:

- `Chain Bridge Header Auth` — Header Auth credential;
- `Discord Alerts Webhook` — Discord webhook credential;
- `Discord Manual Review Webhook` — Discord webhook credential.

### 8.4 Discord and external ownership

Record only:

- Discord server name;
- alert-channel name;
- manual-review channel name;
- who owns/administers them;
- whether Profil A needs an invitation;
- whether any sanitized successful-message screenshot exists.

Never record webhook URLs.

For Gemini/NVIDIA resources, record only:

- provider/project owner;
- model aliases used;
- known quota limitation;
- whether Profil A should be added to a shared project or create new keys.

Never record API keys.

### 8.5 End-to-end status

State clearly whether a complete run ever succeeded:

```text
WF1 report → blockchain deduplication → WF2 capture/AI → decision → WF3 Amoy transaction or manual review → Discord
```

If successful proof exists, collect only sanitized evidence:

- date;
- synthetic/defanged input;
- report ID;
- public transaction hash;
- public PolygonScan link;
- status sequence;
- measured latency;
- sanitized screenshot/log with tokens removed.

If no complete run succeeded, put this exact statement in the manifest:

> No verified complete WF1 → WF2 → WF3 end-to-end run was found.

Do not run a new blockchain transaction or Discord test during collection.

## 9. Required deliverables

Create a handoff output directory **outside the Git repository**, for example:

- `profile-b-handoff-2026-08-22/`

Produce all applicable items:

### Deliverable A — source handoff

One of:

- branch `handoff/profile-b-as-is-2026-08-22` and its commit/remote URL; or
- `profile-b-unpushed-source.patch` plus `profile-b-safe-untracked-source.zip`.

If neither is needed, include the explicit no-unpushed-source statement.

### Deliverable B — private capture cache

- `capture-cache-profile-b-2026-08-22.zip`
- `capture-cache-profile-b-2026-08-22.sha256.txt`

Or the explicit cache-not-found statement.

### Deliverable C — RDAP/WHOIS data

- `rdap-whois-profile-b-2026-08-22.zip`
- matching SHA-256 file

Or the explicit no-frozen-RDAP statement.

### Deliverable D — handoff manifest

Create `PROFILE_B_HANDOFF_MANIFEST.md` containing:

1. repository and Git inventory;
2. source delta after `57747f0`;
3. cache location, counts, integrity, and checksums;
4. RDAP/WHOIS status;
5. evaluation provenance table;
6. n8n version/deployment/workflow status;
7. credential names/types only;
8. external access actions required;
9. confirmed completed work;
10. unfinished work;
11. known bugs and blockers;
12. unavailable artifacts;
13. exact list of files/archives produced;
14. explicit confirmation that no secrets were included.

Use `CONFIRMED`, `INFERRED_FROM_FILES`, and `UNKNOWN` consistently.

### Deliverable E — safe file inventory

Create `PROFILE_B_HANDOFF_FILE_INVENTORY.csv` with columns:

```text
relativePath,artifactType,alreadyIn57747f0,sourceLocation,status,containsRawUrls,containsHostileContent,transferMethod,notes
```

Do not list secret values. A sensitive file withheld from collection may be listed by relative path with status `WITHHELD_SECRET`.

### Deliverable F — checksum manifest

Create `PROFILE_B_HANDOFF_SHA256.txt` containing SHA-256 checksums for every produced archive, patch, manifest, and inventory file.

## 10. Final validation before giving the handoff to the human

Before finishing:

1. Confirm no produced Git branch/patch/safe archive contains `.env`, private keys, API keys, bearer tokens, webhook URLs, n8n data, credentials, cache pages, or `node_modules`.
2. Confirm the cache is only in the separate private cache archive.
3. Confirm no real phishing URL was opened or refetched.
4. Confirm no Gemini/NVIDIA call was made.
5. Confirm no blockchain transaction or Discord message was sent.
6. Confirm `main` was not modified or force-pushed.
7. Confirm every missing item has an explicit statement in the manifest.
8. Provide the human with the exact paths of all output files and the safe/private transfer method for each.

## 11. Required final response to the human

Return a concise summary in exactly this structure:

```text
HANDOFF COLLECTION COMPLETE

Source newer than 57747f0: FOUND / NOT FOUND / UNKNOWN
Source handoff: <branch URL or artifact path or NONE>
Frozen capture cache: FOUND AND VERIFIED / FOUND WITH MISMATCHES / NOT FOUND
Private cache archive: <path or NONE>
Frozen RDAP/WHOIS data: FOUND / NOT FOUND / UNKNOWN
Evaluation provenance: COMPLETE / PARTIAL / UNKNOWN
Latest n8n workflow exports: <paths>
Verified full E2E run: YES / NO / UNKNOWN
External access needed: <list or NONE>
Secrets included: NO
Main modified or force-pushed: NO

Manifest: <path>
File inventory: <path>
Checksum manifest: <path>

Items that Profil A must receive privately:
- <list>

Items unavailable:
- <list>
```

Do not claim completion until the manifest, inventory, checksums, and all available artifacts exist.

---

# What Profil A actually needs from the human afterward

After Copilot completes the task, the human only needs to provide:

1. the handoff branch URL or safe source patch/archive, if newer source was found;
2. `PROFILE_B_HANDOFF_MANIFEST.md`;
3. `PROFILE_B_HANDOFF_FILE_INVENTORY.csv`;
4. `PROFILE_B_HANDOFF_SHA256.txt`;
5. the capture-cache archive through a private transfer method;
6. the RDAP/WHOIS archive through a private transfer method, if it exists;
7. an invitation to required Discord channels or shared projects—never credentials.

Profil A does **not** need passwords, keys, `.env`, exported credentials, or the old contingency implementation.
