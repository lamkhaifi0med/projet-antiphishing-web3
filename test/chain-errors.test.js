"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyChainError,
  toCliError,
} = require("../scripts/lib/chainErrors");

function classification(error) {
  return { ...classifyChainError(error) };
}

test("classifies only allowlisted transient blockchain failures as retryable", () => {
  assert.deepEqual(classification({ code: "TIMEOUT" }), {
    code: "CHAIN_TIMEOUT",
    retryable: true,
  });
  assert.deepEqual(classification({ cause: { code: "ENOTFOUND" } }), {
    code: "CHAIN_NETWORK_ERROR",
    retryable: true,
  });
  assert.deepEqual(
    classification({
      code: "SERVER_ERROR",
      info: { response: { status: 429 } },
    }),
    { code: "CHAIN_RATE_LIMITED", retryable: true },
  );
  assert.deepEqual(classification({ info: { error: { statusCode: 503 } } }), {
    code: "CHAIN_RPC_UNAVAILABLE",
    retryable: true,
  });
});

test("classifies validation, contract, funding, and transaction failures as permanent", () => {
  assert.deepEqual(classification({ code: "CALL_EXCEPTION" }), {
    code: "CHAIN_CONTRACT_REVERTED",
    retryable: false,
  });
  assert.deepEqual(classification({ code: "INSUFFICIENT_FUNDS" }), {
    code: "CHAIN_INSUFFICIENT_FUNDS",
    retryable: false,
  });
  assert.deepEqual(classification({ code: "INVALID_ARGUMENT" }), {
    code: "CHAIN_INVALID_REQUEST",
    retryable: false,
  });
  assert.deepEqual(classification({ code: "NONCE_EXPIRED" }), {
    code: "CHAIN_TRANSACTION_CONFLICT",
    retryable: false,
  });
  assert.deepEqual(classification({ code: "SERVER_ERROR", status: 400 }), {
    code: "CHAIN_REQUEST_REJECTED",
    retryable: false,
  });
});

test("never infers retryability from free-text provider messages", () => {
  const raw = new Error(
    "timeout 429 503 at https://rpc.invalid/?apiKey=do-not-expose",
  );
  const serialized = toCliError(raw);

  assert.deepEqual(serialized, {
    status: "error",
    error: { code: "CHAIN_OPERATION_FAILED", retryable: false },
  });
  assert.doesNotMatch(
    JSON.stringify(serialized),
    /rpc\.invalid|apiKey|timeout/,
  );
});

test("recognizes nested provider codes without exposing the nested payload", () => {
  const serialized = toCliError({
    code: "UNKNOWN_ERROR",
    info: {
      code: "SERVER_ERROR",
      error: {
        code: "ECONNRESET",
        body: "secret provider response",
      },
    },
  });

  assert.deepEqual(serialized, {
    status: "error",
    error: { code: "CHAIN_NETWORK_ERROR", retryable: true },
  });
  assert.doesNotMatch(JSON.stringify(serialized), /secret provider response/);
});
