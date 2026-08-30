"use strict";

const { CATEGORY_NAMES } = require("../../scripts/lib/registry");
const {
  BridgeValidationError,
  validateCheckPayload,
} = require("../services/chain-bridge/validation");

const REPORT_THRESHOLD = 0.8;
const MANUAL_REVIEW_THRESHOLD = 0.5;
const MAX_REPORT_ID_LENGTH = 100;
const MAX_INDICATORS = 5;
const MAX_INDICATOR_LENGTH = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REQUIRED_FIELDS = Object.freeze([
  "reportId",
  "type",
  "value",
  "verdict",
  "category",
  "scoreFinal",
  "indicators",
]);
const OPTIONAL_SCORE_FIELDS = Object.freeze(["llmConfidence", "featureScore"]);
const VERDICTS = new Set(["malicious", "suspicious", "legitimate"]);

class Wf3ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "Wf3ValidationError";
    this.code = "WF3_VALIDATION_ERROR";
  }
}

function fail(message) {
  throw new Wf3ValidationError(message);
}

function assertExactInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("WF3 input must be a JSON object.");
  }

  const allowed = new Set([...REQUIRED_FIELDS, ...OPTIONAL_SCORE_FIELDS]);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    fail(
      `Unknown WF3 field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
    );
  }

  const missing = REQUIRED_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(input, field),
  );
  if (missing.length > 0) {
    fail(
      `Missing WF3 field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    );
  }
}

function validateReportId(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_REPORT_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    fail(
      `reportId must contain 1 to ${MAX_REPORT_ID_LENGTH} safe identifier characters.`,
    );
  }
  return value;
}

function validateTarget(type, value) {
  try {
    return validateCheckPayload({ type, value });
  } catch (error) {
    if (error instanceof BridgeValidationError) fail(error.message);
    throw error;
  }
}

function validateVerdict(value) {
  if (!VERDICTS.has(value)) {
    fail('verdict must be exactly "malicious", "suspicious", or "legitimate".');
  }
  return value;
}

function validateCategory(verdict, category) {
  if (verdict === "malicious") {
    if (!CATEGORY_NAMES.includes(category)) {
      fail(
        `A malicious verdict requires one category from: ${CATEGORY_NAMES.join(", ")}.`,
      );
    }
    return category;
  }

  if (category !== null) {
    fail("A suspicious or legitimate verdict requires category to be null.");
  }
  return null;
}

function validateScoreFinal(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    fail("scoreFinal must be a finite JSON number from 0 to 1.");
  }
  return value;
}

// Composantes optionnelles du score (WF2 : confiance LLM et score des
// heuristiques URL). Elles n'influencent jamais la décision, uniquement
// l'explication affichée dans l'alerte Discord.
function validateOptionalScore(value, label) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    fail(`${label} must be null or a finite JSON number from 0 to 1.`);
  }
  return value;
}

function validateIndicators(value) {
  if (!Array.isArray(value) || value.length > MAX_INDICATORS) {
    fail(
      `indicators must be an array containing at most ${MAX_INDICATORS} items.`,
    );
  }

  return value.map((indicator) => {
    if (
      typeof indicator !== "string" ||
      indicator.length < 1 ||
      indicator.length > MAX_INDICATOR_LENGTH ||
      CONTROL_CHARACTERS.test(indicator)
    ) {
      fail(
        `Each indicator must contain 1 to ${MAX_INDICATOR_LENGTH} characters without control characters.`,
      );
    }
    return indicator;
  });
}

function validateWf3Input(input) {
  assertExactInput(input);
  const target = validateTarget(input.type, input.value);
  const verdict = validateVerdict(input.verdict);

  return {
    reportId: validateReportId(input.reportId),
    ...target,
    verdict,
    category: validateCategory(verdict, input.category),
    scoreFinal: validateScoreFinal(input.scoreFinal),
    indicators: validateIndicators(input.indicators),
    llmConfidence: validateOptionalScore(input.llmConfidence, "llmConfidence"),
    featureScore: validateOptionalScore(input.featureScore, "featureScore"),
  };
}

function decideWf3Action(input) {
  const validated = validateWf3Input(input);
  let action;

  if (validated.verdict === "legitimate") {
    action = "log_only";
  } else if (validated.verdict === "suspicious") {
    action = "manual_review";
  } else if (
    validated.verdict === "malicious" &&
    validated.scoreFinal >= REPORT_THRESHOLD
  ) {
    action = "report";
  } else if (validated.scoreFinal >= MANUAL_REVIEW_THRESHOLD) {
    action = "manual_review";
  } else {
    action = "log_only";
  }

  const scoreOnChain =
    action === "report" ? Math.round(validated.scoreFinal * 100) : null;
  const bridgePayload =
    action === "report"
      ? {
          type: validated.type,
          value: validated.value,
          category: validated.category,
          score: scoreOnChain,
        }
      : null;

  return {
    ...validated,
    action,
    scoreOnChain,
    bridgePayload,
    discordIndicators: validated.indicators.slice(0, 3),
  };
}

module.exports = {
  MANUAL_REVIEW_THRESHOLD,
  MAX_INDICATORS,
  MAX_INDICATOR_LENGTH,
  MAX_REPORT_ID_LENGTH,
  REPORT_THRESHOLD,
  Wf3ValidationError,
  decideWf3Action,
  validateWf3Input,
};
