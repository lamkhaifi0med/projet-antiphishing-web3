"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_ATTEMPTS,
  Wf3RetryValidationError,
  calculateBackoffMs,
  classifyBridgeFailure,
  planAfterBridgeFailure,
  planAfterReportRecheck,
} = require("../n8n/lib/wf3Retry");

const deterministicDelay = { random: () => 0.5 };

function bridgeFailure(code, statusCode = 502, extra = {}) {
  return {
    statusCode,
    body: {
      error: {
        code,
        retryable: false,
        recheckRequired: false,
        providerDetail: "must not influence policy",
      },
    },
    ...extra,
  };
}

test("backoff is exponential with bounded deterministic jitter", () => {
  assert.equal(calculateBackoffMs(1, { random: () => 0 }), 750);
  assert.equal(calculateBackoffMs(1, deterministicDelay), 1_000);
  assert.equal(calculateBackoffMs(1, { random: () => 0.999999 }), 1_250);
  assert.equal(calculateBackoffMs(2, deterministicDelay), 2_000);

  assert.throws(
    () => calculateBackoffMs(MAX_ATTEMPTS, deterministicDelay),
    Wf3RetryValidationError,
  );
});

test("failure classification ignores forged booleans and free-text details", () => {
  assert.deepEqual(classifyBridgeFailure(bridgeFailure("CHAIN_TIMEOUT")), {
    code: "CHAIN_TIMEOUT",
    retryable: true,
  });
  assert.deepEqual(
    classifyBridgeFailure(bridgeFailure("CHAIN_CONTRACT_REVERTED", 503)),
    { code: "CHAIN_CONTRACT_REVERTED", retryable: false },
  );
  assert.deepEqual(
    classifyBridgeFailure({
      statusCode: 400,
      code: "FORGED_CODE",
      retryable: true,
      message: "timeout 429 503",
    }),
    { code: "CHAIN_BRIDGE_REJECTED", retryable: false },
  );
});

test("only allowlisted transport, 429, and 5xx failures are retryable", () => {
  assert.deepEqual(classifyBridgeFailure({ code: "ECONNREFUSED" }), {
    code: "CHAIN_BRIDGE_UNREACHABLE",
    retryable: true,
  });
  assert.deepEqual(classifyBridgeFailure({ statusCode: 429 }), {
    code: "CHAIN_HTTP_RATE_LIMITED",
    retryable: true,
  });
  assert.deepEqual(classifyBridgeFailure({ statusCode: 503 }), {
    code: "CHAIN_HTTP_UNAVAILABLE",
    retryable: true,
  });
  assert.deepEqual(classifyBridgeFailure({ statusCode: 401 }), {
    code: "CHAIN_BRIDGE_REJECTED",
    retryable: false,
  });
});

test("transient check failures retry only while an attempt remains", () => {
  assert.deepEqual(
    planAfterBridgeFailure({
      operation: "check",
      attempt: 1,
      failure: bridgeFailure("CHAIN_NETWORK_ERROR"),
      delayOptions: deterministicDelay,
    }),
    { action: "retry", nextAttempt: 2, delayMs: 1_000 },
  );

  assert.deepEqual(
    planAfterBridgeFailure({
      operation: "check",
      attempt: 3,
      failure: bridgeFailure("CHAIN_NETWORK_ERROR"),
      delayOptions: deterministicDelay,
    }),
    {
      action: "fail",
      code: "CHAIN_NETWORK_ERROR",
      reason: "attempts_exhausted",
    },
  );
});

test("every transient report failure rechecks before any retry", () => {
  assert.deepEqual(
    planAfterBridgeFailure({
      operation: "report",
      attempt: 1,
      failure: bridgeFailure("CHAIN_RPC_UNAVAILABLE"),
    }),
    {
      action: "recheck",
      attempt: 1,
      errorCode: "CHAIN_RPC_UNAVAILABLE",
    },
  );

  assert.deepEqual(
    planAfterBridgeFailure({
      operation: "report",
      attempt: 3,
      failure: bridgeFailure("CHAIN_TIMEOUT"),
    }),
    { action: "recheck", attempt: 3, errorCode: "CHAIN_TIMEOUT" },
  );
});

test("permanent report failures stop without rechecking", () => {
  assert.deepEqual(
    planAfterBridgeFailure({
      operation: "report",
      attempt: 1,
      failure: bridgeFailure("CHAIN_INSUFFICIENT_FUNDS"),
    }),
    {
      action: "fail",
      code: "CHAIN_INSUFFICIENT_FUNDS",
      reason: "permanent_error",
    },
  );
});

test("an active report recheck completes without another transaction", () => {
  assert.deepEqual(
    planAfterReportRecheck({
      reportAttempt: 3,
      errorCode: "CHAIN_TIMEOUT",
      checkResult: { blacklisted: true, txHash: "0xexisting" },
    }),
    { action: "complete_existing", status: "already_blacklisted" },
  );
});

test("an inactive recheck retries within budget and stops after attempt three", () => {
  assert.deepEqual(
    planAfterReportRecheck({
      reportAttempt: 1,
      errorCode: "CHAIN_HTTP_UNAVAILABLE",
      checkResult: { blacklisted: false },
      delayOptions: deterministicDelay,
    }),
    { action: "retry", nextAttempt: 2, delayMs: 1_000 },
  );

  assert.deepEqual(
    planAfterReportRecheck({
      reportAttempt: 3,
      errorCode: "CHAIN_TIMEOUT",
      checkResult: { blacklisted: false },
      delayOptions: deterministicDelay,
    }),
    {
      action: "fail",
      code: "CHAIN_TIMEOUT",
      reason: "attempts_exhausted",
    },
  );
});

test("planner rejects malformed attempts, failures, and recheck results", () => {
  assert.throws(
    () =>
      planAfterBridgeFailure({
        operation: "report",
        attempt: 0,
        failure: bridgeFailure("CHAIN_TIMEOUT"),
      }),
    Wf3RetryValidationError,
  );
  assert.throws(() => classifyBridgeFailure(null), Wf3RetryValidationError);
  assert.throws(
    () =>
      planAfterReportRecheck({
        reportAttempt: 1,
        errorCode: "CHAIN_TIMEOUT",
        checkResult: { blacklisted: "true" },
      }),
    Wf3RetryValidationError,
  );
  assert.throws(
    () => calculateBackoffMs(1, { random: () => 1 }),
    Wf3RetryValidationError,
  );
});
