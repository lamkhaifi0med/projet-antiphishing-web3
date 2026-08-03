"use strict";

const { ERROR_POLICIES } = require("../../scripts/lib/chainErrors");

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5_000;
const JITTER_RATIO = 0.25;
const HTTP_RETRYABLE_CODES = new Set([
  "CHAIN_BRIDGE_UNREACHABLE",
  "CHAIN_HTTP_RATE_LIMITED",
  "CHAIN_HTTP_UNAVAILABLE",
]);
const TRANSPORT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "NETWORK_ERROR",
  "TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

class Wf3RetryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "Wf3RetryValidationError";
    this.code = "WF3_RETRY_VALIDATION_ERROR";
  }
}

function failValidation(message) {
  throw new Wf3RetryValidationError(message);
}

function validateAttempt(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
    failValidation(`attempt must be an integer from 1 to ${MAX_ATTEMPTS}.`);
  }
  return value;
}

function validateOperation(value) {
  if (value !== "check" && value !== "report") {
    failValidation('operation must be exactly "check" or "report".');
  }
  return value;
}

function validateStatusCode(value) {
  if (value === undefined || value === null) return null;
  const statusCode = Number(value);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    failValidation("statusCode must be an HTTP status integer.");
  }
  return statusCode;
}

function knownBridgeCode(value) {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_POLICIES, value)
    ? value
    : null;
}

function knownRetryableCode(value) {
  if (typeof value !== "string") return null;
  if (HTTP_RETRYABLE_CODES.has(value)) return value;
  return knownBridgeCode(value);
}

function classifyBridgeFailure(failure) {
  if (
    failure === null ||
    typeof failure !== "object" ||
    Array.isArray(failure)
  ) {
    failValidation("failure must be an object.");
  }

  const statusCode = validateStatusCode(failure.statusCode);
  const bodyError =
    failure.body?.error && typeof failure.body.error === "object"
      ? failure.body.error
      : null;
  const code =
    knownRetryableCode(bodyError?.code) || knownRetryableCode(failure.code);

  if (code) {
    return Object.freeze({
      code,
      retryable:
        HTTP_RETRYABLE_CODES.has(code) || ERROR_POLICIES[code].retryable,
    });
  }
  if (
    typeof failure.code === "string" &&
    TRANSPORT_ERROR_CODES.has(failure.code.toUpperCase())
  ) {
    return Object.freeze({
      code: "CHAIN_BRIDGE_UNREACHABLE",
      retryable: true,
    });
  }
  if (statusCode === 429) {
    return Object.freeze({
      code: "CHAIN_HTTP_RATE_LIMITED",
      retryable: true,
    });
  }
  if (statusCode !== null && statusCode >= 500) {
    return Object.freeze({
      code: "CHAIN_HTTP_UNAVAILABLE",
      retryable: true,
    });
  }
  if (statusCode === 408) {
    return Object.freeze({
      code: "CHAIN_BRIDGE_UNREACHABLE",
      retryable: true,
    });
  }

  return Object.freeze({
    code: "CHAIN_BRIDGE_REJECTED",
    retryable: false,
  });
}

function calculateBackoffMs(
  completedAttempt,
  {
    random = Math.random,
    baseDelayMs = BASE_DELAY_MS,
    maxDelayMs = MAX_DELAY_MS,
    jitterRatio = JITTER_RATIO,
  } = {},
) {
  validateAttempt(completedAttempt);
  if (completedAttempt >= MAX_ATTEMPTS) {
    failValidation("No retry delay exists after the final attempt.");
  }
  if (typeof random !== "function") {
    failValidation("random must be a function.");
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 1) {
    failValidation("baseDelayMs must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs) {
    failValidation("maxDelayMs must be a safe integer at least baseDelayMs.");
  }
  if (
    typeof jitterRatio !== "number" ||
    !Number.isFinite(jitterRatio) ||
    jitterRatio < 0 ||
    jitterRatio > 1
  ) {
    failValidation("jitterRatio must be a finite number from 0 to 1.");
  }

  const randomValue = random();
  if (
    typeof randomValue !== "number" ||
    !Number.isFinite(randomValue) ||
    randomValue < 0 ||
    randomValue >= 1
  ) {
    failValidation("random must return a finite number from 0 up to 1.");
  }

  const exponentialDelay = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** (completedAttempt - 1),
  );
  const jitterMultiplier = 1 - jitterRatio + 2 * jitterRatio * randomValue;
  return Math.round(exponentialDelay * jitterMultiplier);
}

function retryPlan(completedAttempt, delayOptions) {
  return Object.freeze({
    action: "retry",
    nextAttempt: completedAttempt + 1,
    delayMs: calculateBackoffMs(completedAttempt, delayOptions),
  });
}

function failurePlan(code, reason) {
  return Object.freeze({
    action: "fail",
    code,
    reason,
  });
}

function planAfterBridgeFailure({ operation, attempt, failure, delayOptions }) {
  const validatedOperation = validateOperation(operation);
  const validatedAttempt = validateAttempt(attempt);
  const classification = classifyBridgeFailure(failure);

  if (!classification.retryable) {
    return failurePlan(classification.code, "permanent_error");
  }

  if (validatedOperation === "report") {
    return Object.freeze({
      action: "recheck",
      attempt: validatedAttempt,
      errorCode: classification.code,
    });
  }

  if (validatedAttempt >= MAX_ATTEMPTS) {
    return failurePlan(classification.code, "attempts_exhausted");
  }

  return retryPlan(validatedAttempt, delayOptions);
}

function planAfterReportRecheck({
  reportAttempt,
  errorCode,
  checkResult,
  delayOptions,
}) {
  const validatedAttempt = validateAttempt(reportAttempt);
  const classification = classifyBridgeFailure({ code: errorCode });
  if (!classification.retryable) {
    return failurePlan(classification.code, "permanent_error");
  }
  if (
    checkResult === null ||
    typeof checkResult !== "object" ||
    Array.isArray(checkResult) ||
    typeof checkResult.blacklisted !== "boolean"
  ) {
    failValidation("checkResult.blacklisted must be a boolean.");
  }

  if (checkResult.blacklisted) {
    return Object.freeze({
      action: "complete_existing",
      status: "already_blacklisted",
    });
  }
  if (validatedAttempt >= MAX_ATTEMPTS) {
    return failurePlan(classification.code, "attempts_exhausted");
  }

  return retryPlan(validatedAttempt, delayOptions);
}

module.exports = {
  BASE_DELAY_MS,
  JITTER_RATIO,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  Wf3RetryValidationError,
  calculateBackoffMs,
  classifyBridgeFailure,
  planAfterBridgeFailure,
  planAfterReportRecheck,
  validateAttempt,
};
