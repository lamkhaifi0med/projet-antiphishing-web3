"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Wf3ValidationError,
  decideWf3Action,
  validateWf3Input,
} = require("../n8n/lib/wf3Decision");

const URL = "https://wf3-test.invalid/claim";
const WALLET = "0x000000000000000000000000000000000000dEaD";

function validInput(overrides = {}) {
  return {
    reportId: "r_20260801_0001",
    type: "url",
    value: URL,
    verdict: "malicious",
    category: "fake_airdrop",
    scoreFinal: 0.91,
    indicators: [
      "Synthetic indicator one",
      "Synthetic indicator two",
      "Synthetic indicator three",
      "Synthetic indicator four",
    ],
    ...overrides,
  };
}

test("malicious score at the threshold creates the exact bridge payload", () => {
  const result = decideWf3Action(validInput({ scoreFinal: 0.8 }));

  assert.equal(result.action, "report");
  assert.equal(result.scoreOnChain, 80);
  assert.deepEqual(result.bridgePayload, {
    type: "url",
    value: URL,
    category: "fake_airdrop",
    score: 80,
  });
  assert.deepEqual(result.discordIndicators, [
    "Synthetic indicator one",
    "Synthetic indicator two",
    "Synthetic indicator three",
  ]);
});

test("malicious score below the publication threshold goes to manual review", () => {
  const result = decideWf3Action(validInput({ scoreFinal: 0.7999 }));

  assert.equal(result.action, "manual_review");
  assert.equal(result.scoreOnChain, null);
  assert.equal(result.bridgePayload, null);
});

test("malicious score below 0.50 is log-only", () => {
  const result = decideWf3Action(validInput({ scoreFinal: 0.49 }));

  assert.equal(result.action, "log_only");
  assert.equal(result.bridgePayload, null);
});

test("suspicious always goes to manual review and never creates bridge arguments", () => {
  const result = decideWf3Action(
    validInput({
      verdict: "suspicious",
      category: null,
      scoreFinal: 1,
    }),
  );

  assert.equal(result.action, "manual_review");
  assert.equal(result.scoreOnChain, null);
  assert.equal(result.bridgePayload, null);
});

test("legitimate never reaches the bridge even with a high score", () => {
  const result = decideWf3Action(
    validInput({
      verdict: "legitimate",
      category: null,
      scoreFinal: 1,
    }),
  );

  assert.equal(result.action, "log_only");
  assert.equal(result.scoreOnChain, null);
  assert.equal(result.bridgePayload, null);
});

test("wallet targets are normalized before a report payload is built", () => {
  const result = decideWf3Action(
    validInput({
      type: "wallet",
      value: WALLET.toLowerCase(),
      category: "wallet_drainer",
      scoreFinal: 0.984,
    }),
  );

  assert.equal(result.action, "report");
  assert.equal(result.value, WALLET);
  assert.equal(result.scoreOnChain, 98);
  assert.equal(result.bridgePayload.value, WALLET);
});

test("WF3 rejects unknown or missing fields", () => {
  assert.throws(
    () => validateWf3Input({ ...validInput(), source: "dataset-label" }),
    Wf3ValidationError,
  );

  const missing = validInput();
  delete missing.reportId;
  assert.throws(() => validateWf3Input(missing), /Missing WF3 field/);
});

test("WF3 rejects unsafe report ids, targets, verdicts, and score values", () => {
  const invalidInputs = [
    validInput({ reportId: "contains spaces" }),
    validInput({ type: "email" }),
    validInput({ value: "not-a-url" }),
    validInput({ verdict: "unknown" }),
    validInput({ scoreFinal: "0.91" }),
    validInput({ scoreFinal: Number.NaN }),
    validInput({ scoreFinal: -0.1 }),
    validInput({ scoreFinal: 1.1 }),
  ];

  for (const input of invalidInputs) {
    assert.throws(() => validateWf3Input(input), Wf3ValidationError);
  }
});

test("category consistency is enforced for every verdict", () => {
  assert.throws(
    () => validateWf3Input(validInput({ category: "scam" })),
    /requires one category/,
  );
  assert.throws(
    () =>
      validateWf3Input(
        validInput({ verdict: "suspicious", category: "fake_airdrop" }),
      ),
    /requires category to be null/,
  );
  assert.throws(
    () =>
      validateWf3Input(
        validInput({ verdict: "legitimate", category: "fake_airdrop" }),
      ),
    /requires category to be null/,
  );
});

test("indicators are bounded and control characters are rejected", () => {
  assert.throws(
    () => validateWf3Input(validInput({ indicators: Array(6).fill("signal") })),
    /at most 5/,
  );
  assert.throws(
    () => validateWf3Input(validInput({ indicators: ["line one\nline two"] })),
    /control characters/,
  );
  assert.throws(
    () => validateWf3Input(validInput({ indicators: ["x".repeat(201)] })),
    /1 to 200/,
  );
});
