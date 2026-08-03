"use strict";

const {
  CATEGORY_NAMES,
  normalizeScore,
  normalizeUrl,
  normalizeWallet,
} = require("../../../scripts/lib/registry");

const MAX_URL_LENGTH = 2_048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

class BridgeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeValidationError";
    this.code = "VALIDATION_ERROR";
    this.statusCode = 400;
  }
}

function fail(message) {
  throw new BridgeValidationError(message);
}

function assertExactObject(payload, requiredFields) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    fail("Request body must be a JSON object.");
  }

  const allowed = new Set(requiredFields);
  const unknown = Object.keys(payload).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    fail(
      `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
    );
  }

  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(payload, field),
  );
  if (missing.length > 0) {
    fail(
      `Missing field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    );
  }
}

function validateType(value) {
  if (value !== "url" && value !== "wallet") {
    fail('type must be exactly "url" or "wallet".');
  }
  return value;
}

function validateValue(type, value) {
  if (typeof value !== "string" || !value.trim()) {
    fail("value must be a non-empty string.");
  }

  const trimmed = value.trim();
  if (CONTROL_CHARACTERS.test(trimmed)) {
    fail("value must not contain control characters.");
  }

  try {
    if (type === "url") {
      if (trimmed.length > MAX_URL_LENGTH) {
        fail(`URL exceeds the ${MAX_URL_LENGTH}-character limit.`);
      }
      normalizeUrl(trimmed);
      return trimmed;
    }

    return normalizeWallet(trimmed);
  } catch (error) {
    if (error instanceof BridgeValidationError) throw error;
    fail(error.message);
  }
}

function validateCheckPayload(payload) {
  assertExactObject(payload, ["type", "value"]);
  const type = validateType(payload.type);
  return { type, value: validateValue(type, payload.value) };
}

function validateReportPayload(payload) {
  assertExactObject(payload, ["type", "value", "category", "score"]);
  const type = validateType(payload.type);

  if (!CATEGORY_NAMES.includes(payload.category)) {
    fail(`category must be one of: ${CATEGORY_NAMES.join(", ")}.`);
  }
  if (typeof payload.score !== "number") {
    fail("score must be a JSON integer from 0 to 100.");
  }

  let score;
  try {
    score = normalizeScore(payload.score);
  } catch {
    fail("score must be a JSON integer from 0 to 100.");
  }

  return {
    type,
    value: validateValue(type, payload.value),
    category: payload.category,
    score,
  };
}

function validateActionPayload(action, payload) {
  if (action === "check") return validateCheckPayload(payload);
  if (action === "report") return validateReportPayload(payload);
  fail("Unsupported bridge action.");
}

module.exports = {
  BridgeValidationError,
  MAX_URL_LENGTH,
  validateActionPayload,
  validateCheckPayload,
  validateReportPayload,
};
