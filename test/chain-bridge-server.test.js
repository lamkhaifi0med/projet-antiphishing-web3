"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBridgeServer } = require("../n8n/services/chain-bridge/server");
const { ChainProcessError } = require("../n8n/services/chain-bridge/runner");
const {
  LifecycleStore,
} = require("../n8n/services/chain-bridge/lifecycleStore");
const {
  DECISIONS,
  applyDecision,
  startAnalysis,
} = require("../n8n/lib/wf3Lifecycle");

const TOKEN = "test-token-with-at-least-32-characters";

async function withServer(runAction, callback, options = {}) {
  const server = createBridgeServer({
    token: TOKEN,
    runAction,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function authorizedHeaders(extra = {}) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    ...extra,
  };
}

test("health endpoint exposes no configuration and needs no token", async () => {
  await withServer(
    async () => {
      throw new Error("health must not call the chain runner");
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
      assert.equal(response.headers.get("cache-control"), "no-store");
    },
  );
});

test("internal routes reject missing and incorrect bearer tokens", async () => {
  await withServer(
    async () => ({ blacklisted: false }),
    async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "url", value: "https://example.invalid" }),
      });
      assert.equal(missing.status, 401);

      const incorrect = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${"x".repeat(TOKEN.length)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "url", value: "https://example.invalid" }),
      });
      assert.equal(incorrect.status, 401);
    },
  );
});

test("authenticated check validates and forwards a bounded payload", async () => {
  const calls = [];
  await withServer(
    async (action, payload) => {
      calls.push({ action, payload });
      return { blacklisted: false };
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({
          type: "url",
          value: " https://safe-example.invalid/check ",
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { blacklisted: false });
    },
  );

  assert.deepEqual(calls, [
    {
      action: "check",
      payload: { type: "url", value: "https://safe-example.invalid/check" },
    },
  ]);
});

test("authenticated report forwards only an exact validated payload", async () => {
  const calls = [];
  const payload = {
    type: "url",
    value: "https://report-example.invalid/claim",
    category: "fake_airdrop",
    score: 91,
  };

  await withServer(
    async (action, validated) => {
      calls.push({ action, validated });
      return { status: "reported", txHash: "0xabc" };
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/report`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: "reported",
        txHash: "0xabc",
      });
    },
  );

  assert.deepEqual(calls, [{ action: "report", validated: payload }]);
});

test("authenticated lifecycle routes persist and compare revisions atomically", async () => {
  const lifecycleStore = new LifecycleStore(":memory:");
  const reportId = "r_20260801_http_store";
  const now = () => "2026-08-01T15:00:00.000Z";

  try {
    await withServer(
      async () => {
        throw new Error("lifecycle routes must not call the chain runner");
      },
      async (baseUrl) => {
        const createResponse = await fetch(
          `${baseUrl}/internal/lifecycle/create`,
          {
            method: "POST",
            headers: authorizedHeaders(),
            body: JSON.stringify({ reportId }),
          },
        );
        assert.equal(createResponse.status, 201);
        const created = (await createResponse.json()).lifecycle;
        assert.equal(created.reportId, reportId);
        assert.equal(created.revision, 0);

        const analyzing = startAnalysis(created, {
          expectedRevision: 0,
          now: () => "2026-08-01T15:00:01.000Z",
        });
        const manual = applyDecision(analyzing, DECISIONS.MANUAL_REVIEW, {
          expectedRevision: 1,
          now: () => "2026-08-01T15:00:02.000Z",
        });
        const skippedManual = {
          ...manual,
          revision: 1,
          updatedAt: "2026-08-01T15:00:01.000Z",
        };
        const skipped = await fetch(`${baseUrl}/internal/lifecycle/cas`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({
            reportId,
            expectedRevision: 0,
            lifecycle: skippedManual,
          }),
        });
        assert.equal(skipped.status, 409);
        assert.equal(
          (await skipped.json()).error.code,
          "WF3_LIFECYCLE_TRANSITION",
        );

        const casBody = {
          reportId,
          expectedRevision: 0,
          lifecycle: analyzing,
        };
        const firstCas = await fetch(`${baseUrl}/internal/lifecycle/cas`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify(casBody),
        });
        assert.equal(firstCas.status, 200);
        assert.equal((await firstCas.json()).applied, true);

        const replay = await fetch(`${baseUrl}/internal/lifecycle/cas`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify(casBody),
        });
        assert.equal(replay.status, 200);
        assert.equal((await replay.json()).applied, false);

        const staleCandidate = {
          ...analyzing,
          updatedAt: "2026-08-01T15:00:02.000Z",
        };
        const conflict = await fetch(`${baseUrl}/internal/lifecycle/cas`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({
            reportId,
            expectedRevision: 0,
            lifecycle: staleCandidate,
          }),
        });
        assert.equal(conflict.status, 409);
        assert.equal((await conflict.json()).error.code, "LIFECYCLE_CONFLICT");

        const readResponse = await fetch(`${baseUrl}/internal/lifecycle/read`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({ reportId }),
        });
        assert.equal(readResponse.status, 200);
        assert.equal((await readResponse.json()).lifecycle.revision, 1);

        const invalid = await fetch(`${baseUrl}/internal/lifecycle/read`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({ reportId, extra: true }),
        });
        assert.equal(invalid.status, 400);
        assert.equal(
          (await invalid.json()).error.code,
          "INVALID_LIFECYCLE_REQUEST",
        );
      },
      { lifecycleStore, lifecycleNow: now },
    );
  } finally {
    lifecycleStore.close();
  }
});

test("authenticated WF3 routes execute, claim, reread, and settle safely", async () => {
  const lifecycleStore = new LifecycleStore(":memory:");
  const context = {
    reportId: "r_20260801_http_wf3",
    type: "url",
    value: "https://wf3-http.invalid/review",
    verdict: "suspicious",
    category: null,
    scoreFinal: 0.72,
    indicators: ["@everyone synthetic review indicator"],
  };

  try {
    await withServer(
      async () => {
        throw new Error("manual review must not call the chain runner");
      },
      async (baseUrl) => {
        const executeResponse = await fetch(`${baseUrl}/internal/wf3/execute`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({
            ...context,
            executionId: "n8n-execution-42",
          }),
        });
        assert.equal(executeResponse.status, 200);
        assert.deepEqual(await executeResponse.json(), {
          reportId: context.reportId,
          action: "manual_review",
          status: "manual_review",
          finalized: true,
          alertRequired: true,
        });

        const claimResponse = await fetch(`${baseUrl}/internal/wf3/claim`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({ context, claimId: "n8n-execution-42" }),
        });
        assert.equal(claimResponse.status, 200);
        const claimed = await claimResponse.json();
        assert.equal(claimed.authorized, true);
        assert.equal(claimed.channel, "manual_review");
        assert.doesNotMatch(JSON.stringify(claimed.discord), /@everyone/);

        const settleResponse = await fetch(`${baseUrl}/internal/wf3/settle`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({
            reportId: context.reportId,
            claim: claimed.claim,
            outcome: "sent",
          }),
        });
        assert.equal(settleResponse.status, 200);
        assert.equal((await settleResponse.json()).alertState, "sent");

        const malformed = await fetch(`${baseUrl}/internal/wf3/claim`, {
          method: "POST",
          headers: authorizedHeaders(),
          body: JSON.stringify({
            context,
            claimId: "n8n-execution-42",
            webhookUrl: "https://must-not-be-accepted.invalid",
          }),
        });
        assert.equal(malformed.status, 400);
        assert.equal(
          (await malformed.json()).error.code,
          "WF3_REQUEST_INVALID",
        );
      },
      {
        lifecycleStore,
        lifecycleNow: () => "2026-08-01T19:00:00.000Z",
        wf3Wait: async () => {},
      },
    );
  } finally {
    lifecycleStore.close();
  }
});

test("invalid JSON, media types, unknown fields, and large bodies are rejected", async () => {
  let calls = 0;
  await withServer(
    async () => {
      calls += 1;
      return {};
    },
    async (baseUrl) => {
      const invalidJson = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: "{invalid",
      });
      assert.equal(invalidJson.status, 400);

      const wrongMediaType = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "text/plain",
        },
        body: "hello",
      });
      assert.equal(wrongMediaType.status, 415);

      const unknownField = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({
          type: "url",
          value: "https://example.invalid",
          label: "phishing",
        }),
      });
      assert.equal(unknownField.status, 400);
      assert.deepEqual(await unknownField.json(), {
        error: {
          code: "VALIDATION_ERROR",
          message: "Unknown field: label.",
          retryable: false,
          recheckRequired: false,
        },
      });

      const tooLarge = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({
          type: "url",
          value: `https://example.invalid/${"x".repeat(200)}`,
        }),
      });
      assert.equal(tooLarge.status, 413);
    },
    { maxBodyBytes: 128 },
  );

  assert.equal(calls, 0);
});

test("unexpected failures return a generic response without leaking details", async () => {
  await withServer(
    async () => {
      throw Object.assign(new Error("sensitive provider detail"), {
        statusCode: 502,
        code: "CHAIN_TIMEOUT",
        retryable: true,
        recheckRequired: true,
      });
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/check`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({ type: "url", value: "https://example.invalid" }),
      });
      assert.equal(response.status, 500);
      const raw = await response.text();
      assert.doesNotMatch(raw, /sensitive provider detail/);
      assert.match(raw, /INTERNAL_ERROR/);
      assert.deepEqual(JSON.parse(raw).error, {
        code: "INTERNAL_ERROR",
        message: "Internal bridge error.",
        retryable: false,
        recheckRequired: false,
      });
    },
  );
});

test("chain failures expose only safe retry and recheck metadata", async () => {
  await withServer(
    async () => {
      throw new ChainProcessError(
        "CHAIN_TIMEOUT",
        "sensitive RPC URL and provider body",
        {
          recheckRequired: true,
        },
      );
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/report`, {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({
          type: "url",
          value: "https://example.invalid",
          category: "other",
          score: 80,
        }),
      });

      assert.equal(response.status, 502);
      const raw = await response.text();
      assert.doesNotMatch(raw, /sensitive RPC URL|provider body/);
      assert.deepEqual(JSON.parse(raw), {
        error: {
          code: "CHAIN_TIMEOUT",
          message: "Blockchain operation failed.",
          retryable: true,
          recheckRequired: true,
        },
      });
    },
  );
});
