"use strict";

// Offline contract test for the WF2 -> WF3 seam. It executes the Code-node
// transformations exported in WF2, then calls the real WF3 coordinator with
// an in-memory lifecycle store and a mocked chain runner. It does not start
// n8n/Docker, call an LLM, fetch a URL, publish on-chain, or send Discord.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateWf3Input,
  Wf3ValidationError,
} = require("../n8n/lib/wf3Decision");
const {
  Wf3Coordinator,
} = require("../n8n/services/chain-bridge/wf3Coordinator");
const {
  LifecycleStore,
} = require("../n8n/services/chain-bridge/lifecycleStore");

const workflow = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../n8n/workflows/WF2_Analyse.json"),
    "utf8",
  ),
);

const TX_HASH = `0x${"a".repeat(64)}`;

function workflowNode(name) {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `WF2 workflow node not found: ${name}`);
  return found;
}

function runWf2CodeNode(name, json, upstream = {}) {
  const code = workflowNode(name).parameters.jsCode;
  const select = (nodeName) => ({
    first: () => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(upstream, nodeName),
        `Missing mocked upstream output for ${nodeName}`,
      );
      return { json: upstream[nodeName] };
    },
  });
  return Function("$json", "$", code)(json, select);
}

function source(overrides = {}) {
  return {
    reportId: "r_20260827T120000Z_wf2wf3",
    type: "url",
    value: "https://synthetic-phishing.invalid/claim",
    ...overrides,
  };
}

function createCoordinator(runAction) {
  const lifecycleStore = new LifecycleStore(":memory:");
  let milliseconds = Date.parse("2026-08-27T12:00:00.000Z");
  const subject = new Wf3Coordinator({
    lifecycleStore,
    runAction,
    now: () => {
      const current = milliseconds;
      milliseconds += 1_000;
      return current;
    },
    random: () => 0.5,
    wait: async () => {},
  });
  return { lifecycleStore, subject };
}

test("WF2 URL result becomes a valid WF3 report and journals only terminal fields", async () => {
  const validatedSource = source();
  const analysisResponse = {
    status: "reporting",
    decision: "reporting",
    verdict: "malicious",
    scoreFinal: 0.91,
    modelUsed: "gemini",
    modelName: "gemini-test",
    category: "fake_airdrop",
    indicators: ["Synthetic claim requests a wallet signature"],
    urlFeatures: { score: 0.8, whoisSource: "frozen_cache" },
  };

  const analysis = runWf2CodeNode("Preparer resultat", analysisResponse)[0]
    .json;
  const wf3Input = runWf2CodeNode(
    "Preparer entree WF3",
    {},
    {
      "Valider WF2": validatedSource,
      "Preparer resultat": analysis,
    },
  )[0].json;

  assert.deepEqual(Object.keys(wf3Input), [
    "reportId",
    "type",
    "value",
    "verdict",
    "category",
    "scoreFinal",
    "indicators",
    "llmConfidence",
    "featureScore",
  ]);
  assert.deepEqual(validateWf3Input(wf3Input), wf3Input);
  assert.match(
    wf3Input.indicators.at(-1),
    /^URL features=0\.8; RDAP=frozen_cache$/,
  );

  const calls = [];
  const fixture = createCoordinator(async (action, payload) => {
    calls.push({ action, payload });
    return { status: "reported", txHash: TX_HASH };
  });

  try {
    const execution = await fixture.subject.execute({
      ...wf3Input,
      executionId: "wf2-execution-url",
    });
    assert.deepEqual(calls, [
      {
        action: "report",
        payload: {
          type: "url",
          value: validatedSource.value,
          category: "fake_airdrop",
          score: 91,
        },
      },
    ]);

    const journal = runWf2CodeNode("Preparer resultat WF3", execution)[0].json;
    assert.deepEqual(journal, {
      status: "reported",
      txHash: TX_HASH,
      error: null,
    });
    assert.deepEqual(Object.keys(journal), ["status", "txHash", "error"]);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("WF2 wallet review reaches WF3 without invoking the chain and can settle one mocked alert", async () => {
  const validatedSource = source({
    reportId: "r_20260827T120000Z_wallet",
    type: "wallet",
    value: "0x000000000000000000000000000000000000dEaD",
  });
  const walletReview = runWf2CodeNode("Wallet en revue", {})[0].json;
  const wf3Input = runWf2CodeNode(
    "Preparer entree WF3",
    {},
    {
      "Valider WF2": validatedSource,
      "Wallet en revue": walletReview,
    },
  )[0].json;

  assert.deepEqual(validateWf3Input(wf3Input), wf3Input);
  assert.equal(wf3Input.verdict, "suspicious");
  assert.equal(wf3Input.category, null);

  let calls = 0;
  const fixture = createCoordinator(async () => {
    calls += 1;
    throw new Error("The chain must not be called for a manual review.");
  });

  try {
    const execution = await fixture.subject.execute({
      ...wf3Input,
      executionId: "wf2-execution-wallet",
    });
    assert.equal(calls, 0);
    assert.equal(execution.status, "manual_review");
    assert.equal(execution.alertRequired, true);

    const claimed = await fixture.subject.claim({
      context: wf3Input,
      claimId: "wf2-execution-wallet",
    });
    assert.equal(claimed.authorized, true);
    assert.equal(claimed.channel, "manual_review");
    assert.deepEqual(claimed.discord.allowed_mentions, {
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    });

    const settled = await fixture.subject.settle({
      reportId: wf3Input.reportId,
      claim: claimed.claim,
      outcome: "sent",
    });
    assert.equal(settled.alertState, "sent");

    const journal = runWf2CodeNode("Preparer resultat WF3", execution)[0].json;
    assert.deepEqual(journal, {
      status: "manual_review",
      txHash: null,
      error: null,
    });
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("WF2 limits untrusted indicators before the exact WF3 validator", () => {
  const validatedSource = source({ reportId: "r_20260827T120000Z_indicators" });
  const prepared = runWf2CodeNode(
    "Preparer entree WF3",
    {},
    {
      "Valider WF2": validatedSource,
      "Preparer resultat": {
        verdict: "malicious",
        category: "fake_support",
        scoreFinal: 0.83,
        indicators: [
          "first\u0000indicator",
          "second",
          "third",
          "fourth",
          "fifth",
          "sixth-must-be-truncated",
          42,
          "",
        ],
      },
    },
  )[0].json;

  assert.deepEqual(prepared.indicators, [
    "first indicator",
    "second",
    "third",
    "fourth",
    "fifth",
  ]);
  assert.deepEqual(validateWf3Input(prepared), prepared);
});

test("invalid WF3 output or execution errors are converted to a safe journal failure", () => {
  const invalidResult = runWf2CodeNode("Preparer resultat WF3", {
    status: "reported",
    txHash: null,
    error: "sensitive chain detail",
  })[0].json;
  assert.deepEqual(invalidResult, {
    status: "failed",
    txHash: null,
    error: "WF3_INVALID_RESULT",
  });

  const failedExecution = runWf2CodeNode("Preparer echec WF3", {
    error: { message: "sensitive runtime detail" },
  })[0].json;
  assert.deepEqual(failedExecution, {
    status: "failed",
    txHash: null,
    error: "WF3_EXECUTION_FAILED",
  });

  const malformedInput = runWf2CodeNode(
    "Preparer entree WF3",
    {},
    {
      "Valider WF2": source({ reportId: "r_20260827T120000Z_invalid" }),
      "Preparer resultat": {
        verdict: "malicious",
        category: null,
        scoreFinal: 0.91,
        indicators: [],
      },
    },
  )[0].json;
  assert.throws(
    () => validateWf3Input(malformedInput),
    Wf3ValidationError,
    "the coordinator must reject a malicious result without a category",
  );
});
