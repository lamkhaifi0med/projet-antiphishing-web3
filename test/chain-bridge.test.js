"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  BridgeValidationError,
  MAX_URL_LENGTH,
  validateCheckPayload,
  validateReportPayload,
} = require("../n8n/services/chain-bridge/validation");
const {
  buildChildEnvironment,
  parseFailedOutput,
  prepareChainAction,
  runChainAction,
} = require("../n8n/services/chain-bridge/runner");

function mockChild({ stdout = "", stderr = "", exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };

  setImmediate(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode);
  });
  return child;
}

test("check validation accepts only the exact public payload", () => {
  assert.deepEqual(
    validateCheckPayload({
      type: "url",
      value: " https://example.invalid/check ",
    }),
    { type: "url", value: "https://example.invalid/check" },
  );

  assert.throws(
    () =>
      validateCheckPayload({
        type: "url",
        value: "https://example.invalid",
        unexpected: true,
      }),
    BridgeValidationError,
  );
});

test("check validation rejects control characters and oversized URLs", () => {
  assert.throws(
    () =>
      validateCheckPayload({
        type: "url",
        value: "https://example.invalid/a\nsecond-line",
      }),
    /control characters/,
  );
  assert.throws(
    () =>
      validateCheckPayload({
        type: "url",
        value: `https://example.invalid/${"a".repeat(MAX_URL_LENGTH)}`,
      }),
    /exceeds/,
  );
});

test("report validation requires an exact category and numeric integer score", () => {
  const input = {
    type: "url",
    value: "https://example.invalid/claim",
    category: "fake_airdrop",
    score: 92,
  };
  assert.deepEqual(validateReportPayload(input), input);

  assert.throws(
    () => validateReportPayload({ ...input, category: "Fake-Airdrop" }),
    /category must be one of/,
  );
  assert.throws(
    () => validateReportPayload({ ...input, score: "92" }),
    /JSON integer/,
  );
  assert.throws(
    () => validateReportPayload({ ...input, score: 101 }),
    /JSON integer/,
  );
});

test("shell-like URL text remains one argument and shell is disabled", () => {
  const value = "https://example.invalid/claim;echo-not-executed";
  const invocation = prepareChainAction(
    "check",
    { type: "url", value },
    {
      AMOY_RPC_URL: "https://rpc.invalid",
      REGISTRY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      OWNER_PRIVATE_KEY: "owner-secret",
      REPORTER_PRIVATE_KEY: "reporter-secret",
    },
  );

  assert.equal(invocation.options.shell, false);
  assert.equal(
    invocation.args.filter((argument) => argument === value).length,
    1,
  );
  assert.equal(invocation.options.env.OWNER_PRIVATE_KEY, undefined);
  assert.equal(invocation.options.env.REPORTER_PRIVATE_KEY, undefined);
  assert.equal(invocation.options.env.SKIP_PROJECT_DOTENV, "1");
});

test("report child receives Reporter credentials but never Owner credentials", () => {
  const environment = buildChildEnvironment("report", {
    AMOY_RPC_URL: "https://rpc.invalid",
    REGISTRY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    OWNER_PRIVATE_KEY: "owner-secret",
    REPORTER_PRIVATE_KEY: "reporter-secret",
  });

  assert.equal(environment.REPORTER_PRIVATE_KEY, "reporter-secret");
  assert.equal(environment.OWNER_PRIVATE_KEY, undefined);
});

test("runner parses one successful JSON object", async () => {
  const result = await runChainAction(
    "check",
    { type: "url", value: "https://example.invalid" },
    {
      spawnImpl: () => mockChild({ stdout: '{"blacklisted":false}' }),
      sourceEnvironment: {},
    },
  );
  assert.deepEqual(result, { blacklisted: false });
});

test("runner rejects invalid JSON and non-zero child exits", async () => {
  await assert.rejects(
    runChainAction(
      "check",
      { type: "url", value: "https://example.invalid" },
      {
        spawnImpl: () => mockChild({ stdout: "not-json" }),
        sourceEnvironment: {},
      },
    ),
    { code: "INVALID_OUTPUT" },
  );

  await assert.rejects(
    runChainAction(
      "check",
      { type: "url", value: "https://example.invalid" },
      {
        spawnImpl: () =>
          mockChild({
            stderr: '{"status":"error","message":"internal detail"}',
            exitCode: 1,
          }),
        sourceEnvironment: {},
      },
    ),
    (error) => {
      assert.equal(error.code, "CHAIN_OPERATION_FAILED");
      assert.equal(error.retryable, false);
      assert.equal(error.recheckRequired, false);
      assert.doesNotMatch(error.message, /internal detail/);
      return true;
    },
  );
});

test("runner trusts only allowlisted child codes and derives retry policy", () => {
  const reportError = parseFailedOutput(
    JSON.stringify({
      status: "error",
      error: {
        code: "CHAIN_TIMEOUT",
        retryable: false,
        providerResponse: "sensitive detail",
      },
    }),
    "report",
  );
  assert.equal(reportError.code, "CHAIN_TIMEOUT");
  assert.equal(reportError.retryable, true);
  assert.equal(reportError.recheckRequired, true);
  assert.doesNotMatch(reportError.message, /sensitive detail/);

  const checkError = parseFailedOutput(
    '{"status":"error","error":{"code":"CHAIN_NETWORK_ERROR"}}',
    "check",
  );
  assert.equal(checkError.retryable, true);
  assert.equal(checkError.recheckRequired, false);

  const forged = parseFailedOutput(
    '{"status":"error","error":{"code":"FORGED","retryable":true}}',
    "report",
  );
  assert.equal(forged.code, "CHAIN_OPERATION_FAILED");
  assert.equal(forged.retryable, false);
  assert.equal(forged.recheckRequired, false);
});

test("runner marks a killed report timeout as retryable and requiring a recheck", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };

  await assert.rejects(
    runChainAction(
      "report",
      {
        type: "url",
        value: "https://example.invalid",
        category: "other",
        score: 80,
      },
      {
        spawnImpl: () => child,
        sourceEnvironment: {},
        timeoutMs: 10,
      },
    ),
    {
      code: "CHAIN_TIMEOUT",
      retryable: true,
      recheckRequired: true,
    },
  );
  assert.equal(child.killed, true);
});

test("runner kills a child that exceeds the output limit", async () => {
  const child = mockChild({
    stdout: JSON.stringify({ data: "x".repeat(200) }),
  });
  await assert.rejects(
    runChainAction(
      "check",
      { type: "url", value: "https://example.invalid" },
      {
        spawnImpl: () => child,
        sourceEnvironment: {},
        maxOutputBytes: 32,
      },
    ),
    { code: "OUTPUT_LIMIT_EXCEEDED" },
  );
  assert.equal(child.killed, true);
});
