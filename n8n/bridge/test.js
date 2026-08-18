#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJournal } = require("./lib/journal");
const { createBridgeServer } = require("./server");

const SECRET = "test-secret-32-characters-minimum-value";

async function request(baseUrl, route, body, token = SECRET, method = "POST") {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf1-bridge-"));
  const calls = [];
  const server = createBridgeServer({
    secret: SECRET,
    journal: createJournal(path.join(tempDir, "reports.jsonl")),
    check: async (input) => {
      calls.push(input);
      return input.value.includes("listed")
        ? { blacklisted: true, type: input.type, category: "other", score: 100, since: "2026-08-09T00:00:00.000Z", txHash: "0xabc", reporter: "secret-internal" }
        : { blacklisted: false, type: input.type };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);

    response = await request(baseUrl, "/check", { type: "url", value: "https://example.com" }, "bad-token");
    assert.equal(response.status, 401);

    response = await request(baseUrl, "/check", { type: "email", value: "a@b.test" });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0, "une entree invalide ne doit jamais appeler check.js");

    response = await request(baseUrl, "/check", { type: "url", value: "https://user:pass@example.com" });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);

    response = await request(baseUrl, "/check", { type: "url", value: "https://listed.invalid/path" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).blacklisted, true);
    assert.deepEqual(calls.at(-1), { type: "url", value: "https://listed.invalid/path" });

    const report = {
      reportId: "r_20260809T120000Z_42",
      createdAt: "2026-08-09T12:00:00.000Z",
      type: "url",
      valueDefanged: "hxxps://example[.]com",
      status: "queued",
    };
    response = await request(baseUrl, "/reports", report);
    assert.equal(response.status, 201);
    response = await request(baseUrl, "/reports", report);
    assert.equal(response.status, 200, "le meme reportId doit etre idempotent");

    const lines = fs.readFileSync(path.join(tempDir, "reports.jsonl"), "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 1, "un reportId ne doit etre journalise qu'une fois");
    const stored = JSON.parse(lines[0]);
    assert.equal(stored.status, "queued");
    assert.equal(stored.verdict, null);
    assert.equal(stored.txHash, null);

    response = await request(baseUrl, `/reports/${report.reportId}`, { status: "analyzing" }, SECRET, "PATCH");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).record.status, "analyzing");
    response = await request(baseUrl, `/reports/${report.reportId}`, { status: "done" }, SECRET, "PATCH");
    assert.equal(response.status, 400, "un statut hors RF-N10 doit etre refuse");

    const updatedLines = fs.readFileSync(path.join(tempDir, "reports.jsonl"), "utf8").trim().split(/\r?\n/);
    assert.equal(updatedLines.length, 1, "les transitions ne doivent pas dupliquer la ligne du rapport");

    console.log("WF1/WF2 bridge: 12/12 tests passes.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
