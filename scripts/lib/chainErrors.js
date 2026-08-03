"use strict";

const ERROR_POLICIES = Object.freeze({
  CHAIN_TIMEOUT: Object.freeze({ retryable: true }),
  CHAIN_NETWORK_ERROR: Object.freeze({ retryable: true }),
  CHAIN_RATE_LIMITED: Object.freeze({ retryable: true }),
  CHAIN_RPC_UNAVAILABLE: Object.freeze({ retryable: true }),
  CHAIN_CONTRACT_REVERTED: Object.freeze({ retryable: false }),
  CHAIN_INSUFFICIENT_FUNDS: Object.freeze({ retryable: false }),
  CHAIN_ACTION_REJECTED: Object.freeze({ retryable: false }),
  CHAIN_INVALID_REQUEST: Object.freeze({ retryable: false }),
  CHAIN_REQUEST_REJECTED: Object.freeze({ retryable: false }),
  CHAIN_TRANSACTION_CONFLICT: Object.freeze({ retryable: false }),
  CHAIN_OPERATION_FAILED: Object.freeze({ retryable: false }),
});

const TIMEOUT_CODES = new Set(["TIMEOUT", "ETIMEDOUT"]);
const NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "NETWORK_ERROR",
]);
const INVALID_REQUEST_CODES = new Set([
  "BAD_DATA",
  "BUFFER_OVERRUN",
  "INVALID_ARGUMENT",
  "MISSING_ARGUMENT",
  "NUMERIC_FAULT",
  "UNEXPECTED_ARGUMENT",
  "VALUE_MISMATCH",
]);
const TRANSACTION_CONFLICT_CODES = new Set([
  "NONCE_EXPIRED",
  "REPLACEMENT_UNDERPRICED",
  "TRANSACTION_REPLACED",
]);

const CODE_PATHS = Object.freeze([
  ["code"],
  ["cause", "code"],
  ["error", "code"],
  ["info", "code"],
  ["info", "error", "code"],
]);
const STATUS_PATHS = Object.freeze([
  ["status"],
  ["statusCode"],
  ["cause", "status"],
  ["cause", "statusCode"],
  ["error", "status"],
  ["error", "statusCode"],
  ["response", "status"],
  ["response", "statusCode"],
  ["info", "status"],
  ["info", "statusCode"],
  ["info", "error", "status"],
  ["info", "error", "statusCode"],
  ["info", "response", "status"],
  ["info", "response", "statusCode"],
]);

function readPath(source, path) {
  let current = source;
  try {
    for (const name of path) {
      if (current === null || typeof current !== "object") return undefined;
      current = current[name];
    }
  } catch {
    return undefined;
  }
  return current;
}

function findCode(error) {
  for (const path of CODE_PATHS) {
    const value = readPath(error, path);
    if (typeof value === "string" && value) return value.toUpperCase();
  }
  return "";
}

function findCodes(error) {
  const codes = new Set();
  for (const path of CODE_PATHS) {
    const value = readPath(error, path);
    if (typeof value === "string" && value) codes.add(value.toUpperCase());
  }
  return codes;
}

function findHttpStatus(error) {
  for (const path of STATUS_PATHS) {
    let value;
    try {
      value = Number(readPath(error, path));
    } catch {
      continue;
    }
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

function getChainErrorPolicy(code) {
  return ERROR_POLICIES[code] || ERROR_POLICIES.CHAIN_OPERATION_FAILED;
}

function classifyChainError(error) {
  const codes = findCodes(error);
  const status = findHttpStatus(error);
  let safeCode = "CHAIN_OPERATION_FAILED";

  if ([...codes].some((code) => TIMEOUT_CODES.has(code))) {
    safeCode = "CHAIN_TIMEOUT";
  } else if (codes.has("CALL_EXCEPTION")) {
    safeCode = "CHAIN_CONTRACT_REVERTED";
  } else if (codes.has("INSUFFICIENT_FUNDS")) {
    safeCode = "CHAIN_INSUFFICIENT_FUNDS";
  } else if (codes.has("ACTION_REJECTED")) {
    safeCode = "CHAIN_ACTION_REJECTED";
  } else if ([...codes].some((code) => INVALID_REQUEST_CODES.has(code))) {
    safeCode = "CHAIN_INVALID_REQUEST";
  } else if ([...codes].some((code) => TRANSACTION_CONFLICT_CODES.has(code))) {
    safeCode = "CHAIN_TRANSACTION_CONFLICT";
  } else if (status === 429) {
    safeCode = "CHAIN_RATE_LIMITED";
  } else if (status !== null && status >= 500) {
    safeCode = "CHAIN_RPC_UNAVAILABLE";
  } else if (status !== null && status >= 400) {
    safeCode = "CHAIN_REQUEST_REJECTED";
  } else if ([...codes].some((code) => NETWORK_CODES.has(code))) {
    safeCode = "CHAIN_NETWORK_ERROR";
  } else if (codes.has("SERVER_ERROR")) {
    safeCode = "CHAIN_RPC_UNAVAILABLE";
  }

  return Object.freeze({
    code: safeCode,
    retryable: getChainErrorPolicy(safeCode).retryable,
  });
}

function toCliError(error) {
  return {
    status: "error",
    error: classifyChainError(error),
  };
}

module.exports = {
  ERROR_POLICIES,
  classifyChainError,
  findCode,
  findCodes,
  findHttpStatus,
  getChainErrorPolicy,
  toCliError,
};
