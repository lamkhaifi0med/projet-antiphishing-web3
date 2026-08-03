"use strict";

const { isDeepStrictEqual } = require("node:util");

const SCHEMA_VERSION = 1;
const MAX_IDENTIFIER_LENGTH = 100;
const REPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const STATUSES = Object.freeze({
  QUEUED: "queued",
  ANALYZING: "analyzing",
  MANUAL_REVIEW: "manual_review",
  REPORTING: "reporting",
  REPORTED: "reported",
  ALREADY_BLACKLISTED: "already_blacklisted",
  FAILED: "failed",
});
const DECISIONS = Object.freeze({
  REPORT: "report",
  MANUAL_REVIEW: "manual_review",
  LOG_ONLY: "log_only",
});
const ALERT_KINDS = Object.freeze({
  MANUAL_REVIEW: "manual_review",
  CHAIN_RESULT: "chain_result",
  PIPELINE_FAILURE: "pipeline_failure",
});
const ALERT_STATES = Object.freeze({
  NOT_REQUIRED: "not_required",
  PENDING: "pending",
  CLAIMED: "claimed",
  SENT: "sent",
  CLOSED_FAILED: "closed_failed",
  CLOSED_UNCERTAIN: "closed_uncertain",
});
const DELIVERY_OUTCOMES = Object.freeze({
  SENT: "sent",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
});

const STATUS_VALUES = new Set(Object.values(STATUSES));
const DECISION_VALUES = new Set(Object.values(DECISIONS));
const ALERT_KIND_VALUES = new Set(Object.values(ALERT_KINDS));
const ALERT_STATE_VALUES = new Set(Object.values(ALERT_STATES));
const DELIVERY_OUTCOME_VALUES = new Set(Object.values(DELIVERY_OUTCOMES));
const RECORD_FIELDS = Object.freeze([
  "schemaVersion",
  "reportId",
  "status",
  "decision",
  "finalized",
  "txHash",
  "errorCode",
  "alert",
  "revision",
  "createdAt",
  "updatedAt",
]);
const ALERT_FIELDS = Object.freeze([
  "required",
  "kind",
  "state",
  "claimId",
  "claimRevision",
  "claimedAt",
  "completedAt",
  "outcome",
]);

class Wf3LifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Wf3LifecycleError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Wf3LifecycleError(code, message);
}

function assertExactObject(value, fields, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("WF3_LIFECYCLE_INVALID", `${label} must be an object.`);
  }
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown.length > 0 || missing.length > 0) {
    fail(
      "WF3_LIFECYCLE_INVALID",
      `${label} must contain exactly the lifecycle schema fields.`,
    );
  }
}

function validateIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !REPORT_ID_PATTERN.test(value)
  ) {
    fail(
      "WF3_LIFECYCLE_INVALID",
      `${label} must contain 1 to ${MAX_IDENTIFIER_LENGTH} safe identifier characters.`,
    );
  }
  return value;
}

function validateLifecycleReportId(value) {
  return validateIdentifier(value, "reportId");
}

function validateIsoTimestamp(value, label) {
  if (typeof value !== "string") {
    fail("WF3_LIFECYCLE_INVALID", `${label} must be an ISO timestamp.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    fail("WF3_LIFECYCLE_INVALID", `${label} must be an ISO timestamp.`);
  }
  return value;
}

function timestamp(now = Date.now) {
  if (typeof now !== "function") {
    fail("WF3_LIFECYCLE_INVALID", "now must be a function.");
  }
  let value;
  try {
    value = now();
  } catch {
    fail("WF3_LIFECYCLE_INVALID", "now could not produce a timestamp.");
  }
  let date;
  try {
    date = value instanceof Date ? value : new Date(value);
  } catch {
    fail("WF3_LIFECYCLE_INVALID", "now must produce a valid timestamp.");
  }
  if (!Number.isFinite(date.getTime())) {
    fail("WF3_LIFECYCLE_INVALID", "now must produce a valid timestamp.");
  }
  return date.toISOString();
}

function noAlert() {
  return {
    required: false,
    kind: null,
    state: ALERT_STATES.NOT_REQUIRED,
    claimId: null,
    claimRevision: null,
    claimedAt: null,
    completedAt: null,
    outcome: null,
  };
}

function pendingAlert(kind) {
  return {
    required: true,
    kind,
    state: ALERT_STATES.PENDING,
    claimId: null,
    claimRevision: null,
    claimedAt: null,
    completedAt: null,
    outcome: null,
  };
}

function freezeLifecycle(record) {
  return Object.freeze({
    ...record,
    alert: Object.freeze({ ...record.alert }),
  });
}

function validateAlert(alert, revision) {
  assertExactObject(alert, ALERT_FIELDS, "alert");
  if (typeof alert.required !== "boolean") {
    fail("WF3_LIFECYCLE_INVALID", "alert.required must be a boolean.");
  }
  if (!ALERT_STATE_VALUES.has(alert.state)) {
    fail("WF3_LIFECYCLE_INVALID", "alert.state is invalid.");
  }

  if (!alert.required) {
    if (
      alert.kind !== null ||
      alert.state !== ALERT_STATES.NOT_REQUIRED ||
      alert.claimId !== null ||
      alert.claimRevision !== null ||
      alert.claimedAt !== null ||
      alert.completedAt !== null ||
      alert.outcome !== null
    ) {
      fail(
        "WF3_LIFECYCLE_INVALID",
        "A non-required alert must not contain dispatch metadata.",
      );
    }
    return;
  }

  if (!ALERT_KIND_VALUES.has(alert.kind)) {
    fail("WF3_LIFECYCLE_INVALID", "A required alert needs a valid kind.");
  }
  if (alert.state === ALERT_STATES.NOT_REQUIRED) {
    fail("WF3_LIFECYCLE_INVALID", "A required alert cannot be not_required.");
  }

  if (alert.state === ALERT_STATES.PENDING) {
    if (
      alert.claimId !== null ||
      alert.claimRevision !== null ||
      alert.claimedAt !== null ||
      alert.completedAt !== null ||
      alert.outcome !== null
    ) {
      fail(
        "WF3_LIFECYCLE_INVALID",
        "A pending alert must not contain claim metadata.",
      );
    }
    return;
  }

  validateIdentifier(alert.claimId, "alert.claimId");
  if (
    !Number.isSafeInteger(alert.claimRevision) ||
    alert.claimRevision < 1 ||
    alert.claimRevision > revision
  ) {
    fail("WF3_LIFECYCLE_INVALID", "alert.claimRevision is invalid.");
  }
  validateIsoTimestamp(alert.claimedAt, "alert.claimedAt");

  if (alert.state === ALERT_STATES.CLAIMED) {
    if (
      alert.claimRevision !== revision ||
      alert.completedAt !== null ||
      alert.outcome !== null
    ) {
      fail(
        "WF3_LIFECYCLE_INVALID",
        "A claimed alert must be unsettled at the current revision.",
      );
    }
    return;
  }

  validateIsoTimestamp(alert.completedAt, "alert.completedAt");
  if (!DELIVERY_OUTCOME_VALUES.has(alert.outcome)) {
    fail("WF3_LIFECYCLE_INVALID", "A closed alert needs a valid outcome.");
  }
  const expectedState = {
    [DELIVERY_OUTCOMES.SENT]: ALERT_STATES.SENT,
    [DELIVERY_OUTCOMES.FAILED]: ALERT_STATES.CLOSED_FAILED,
    [DELIVERY_OUTCOMES.UNCERTAIN]: ALERT_STATES.CLOSED_UNCERTAIN,
  }[alert.outcome];
  if (alert.state !== expectedState) {
    fail(
      "WF3_LIFECYCLE_INVALID",
      "Alert state and delivery outcome are inconsistent.",
    );
  }
}

function validateLifecycle(value) {
  assertExactObject(value, RECORD_FIELDS, "lifecycle");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail("WF3_LIFECYCLE_INVALID", "Unsupported lifecycle schema version.");
  }
  validateIdentifier(value.reportId, "reportId");
  if (!STATUS_VALUES.has(value.status)) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle status is invalid.");
  }
  if (value.decision !== null && !DECISION_VALUES.has(value.decision)) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle decision is invalid.");
  }
  if (typeof value.finalized !== "boolean") {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle finalized must be a boolean.");
  }
  if (
    value.txHash !== null &&
    (typeof value.txHash !== "string" || !TX_HASH_PATTERN.test(value.txHash))
  ) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle txHash is invalid.");
  }
  if (
    value.errorCode !== null &&
    (typeof value.errorCode !== "string" ||
      !SAFE_CODE_PATTERN.test(value.errorCode))
  ) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle errorCode is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle revision is invalid.");
  }
  validateIsoTimestamp(value.createdAt, "createdAt");
  validateIsoTimestamp(value.updatedAt, "updatedAt");
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    fail("WF3_LIFECYCLE_INVALID", "updatedAt cannot precede createdAt.");
  }
  validateAlert(value.alert, value.revision);

  const noChainResult = value.txHash === null;
  const noFailure = value.errorCode === null;
  const noDispatch = value.alert.required === false;

  if (value.status === STATUSES.QUEUED) {
    if (
      value.decision !== null ||
      value.finalized ||
      !noChainResult ||
      !noFailure ||
      !noDispatch
    ) {
      fail("WF3_LIFECYCLE_INVALID", "Queued lifecycle invariants failed.");
    }
  } else if (value.status === STATUSES.ANALYZING) {
    const activeAnalysis =
      value.decision === null && value.finalized === false && noDispatch;
    const completedLogOnly =
      value.decision === DECISIONS.LOG_ONLY &&
      value.finalized === true &&
      noDispatch;
    if (
      (!activeAnalysis && !completedLogOnly) ||
      !noChainResult ||
      !noFailure
    ) {
      fail("WF3_LIFECYCLE_INVALID", "Analyzing lifecycle invariants failed.");
    }
  } else if (value.status === STATUSES.MANUAL_REVIEW) {
    if (
      value.decision !== DECISIONS.MANUAL_REVIEW ||
      !value.finalized ||
      !noChainResult ||
      !noFailure ||
      value.alert.kind !== ALERT_KINDS.MANUAL_REVIEW
    ) {
      fail(
        "WF3_LIFECYCLE_INVALID",
        "Manual-review lifecycle invariants failed.",
      );
    }
  } else if (value.status === STATUSES.REPORTING) {
    if (
      value.decision !== DECISIONS.REPORT ||
      value.finalized ||
      !noChainResult ||
      !noFailure ||
      !noDispatch
    ) {
      fail("WF3_LIFECYCLE_INVALID", "Reporting lifecycle invariants failed.");
    }
  } else if (
    value.status === STATUSES.REPORTED ||
    value.status === STATUSES.ALREADY_BLACKLISTED
  ) {
    if (
      value.decision !== DECISIONS.REPORT ||
      !value.finalized ||
      !value.txHash ||
      !noFailure ||
      value.alert.kind !== ALERT_KINDS.CHAIN_RESULT
    ) {
      fail(
        "WF3_LIFECYCLE_INVALID",
        "Chain-result lifecycle invariants failed.",
      );
    }
  } else if (value.status === STATUSES.FAILED) {
    if (
      !value.finalized ||
      !noChainResult ||
      !value.errorCode ||
      (value.decision !== null && value.decision !== DECISIONS.REPORT) ||
      value.alert.kind !== ALERT_KINDS.PIPELINE_FAILURE
    ) {
      fail("WF3_LIFECYCLE_INVALID", "Failed lifecycle invariants failed.");
    }
  }

  return freezeLifecycle(value);
}

function createLifecycle(reportId, { now = Date.now } = {}) {
  const createdAt = timestamp(now);
  return validateLifecycle({
    schemaVersion: SCHEMA_VERSION,
    reportId: validateLifecycleReportId(reportId),
    status: STATUSES.QUEUED,
    decision: null,
    finalized: false,
    txHash: null,
    errorCode: null,
    alert: noAlert(),
    revision: 0,
    createdAt,
    updatedAt: createdAt,
  });
}

function assertExpectedRevision(current, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    fail("WF3_LIFECYCLE_INVALID", "expectedRevision is invalid.");
  }
  if (current.revision !== expectedRevision) {
    fail("WF3_LIFECYCLE_CONFLICT", "Lifecycle revision conflict.");
  }
}

function nextLifecycle(
  current,
  patch,
  { expectedRevision, now = Date.now } = {},
) {
  const validated = validateLifecycle(current);
  assertExpectedRevision(validated, expectedRevision);
  const updatedAt = timestamp(now);
  if (Date.parse(updatedAt) < Date.parse(validated.updatedAt)) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle time cannot move backwards.");
  }
  return validateLifecycle({
    ...validated,
    ...patch,
    revision: validated.revision + 1,
    updatedAt,
  });
}

function assertOpen(current) {
  if (current.finalized) {
    fail("WF3_LIFECYCLE_FINALIZED", "Lifecycle is already finalized.");
  }
}

function startAnalysis(current, options = {}) {
  const validated = validateLifecycle(current);
  assertOpen(validated);
  if (validated.status !== STATUSES.QUEUED) {
    fail("WF3_LIFECYCLE_TRANSITION", "Only queued reports can start analysis.");
  }
  return nextLifecycle(validated, { status: STATUSES.ANALYZING }, options);
}

function applyDecision(current, decision, options = {}) {
  const validated = validateLifecycle(current);
  assertOpen(validated);
  if (validated.status !== STATUSES.ANALYZING || validated.decision !== null) {
    fail(
      "WF3_LIFECYCLE_TRANSITION",
      "A decision requires an active analyzing report.",
    );
  }
  if (!DECISION_VALUES.has(decision)) {
    fail("WF3_LIFECYCLE_INVALID", "Decision is invalid.");
  }

  if (decision === DECISIONS.LOG_ONLY) {
    return nextLifecycle(validated, { decision, finalized: true }, options);
  }
  if (decision === DECISIONS.MANUAL_REVIEW) {
    return nextLifecycle(
      validated,
      {
        status: STATUSES.MANUAL_REVIEW,
        decision,
        finalized: true,
        alert: pendingAlert(ALERT_KINDS.MANUAL_REVIEW),
      },
      options,
    );
  }
  return nextLifecycle(
    validated,
    { status: STATUSES.REPORTING, decision },
    options,
  );
}

function completeReport(current, result, options = {}) {
  const validated = validateLifecycle(current);
  assertOpen(validated);
  if (validated.status !== STATUSES.REPORTING) {
    fail(
      "WF3_LIFECYCLE_TRANSITION",
      "A chain result requires a reporting lifecycle.",
    );
  }
  assertExactObject(result, ["status", "txHash"], "result");
  if (
    (result.status !== STATUSES.REPORTED &&
      result.status !== STATUSES.ALREADY_BLACKLISTED) ||
    typeof result.txHash !== "string" ||
    !TX_HASH_PATTERN.test(result.txHash)
  ) {
    fail(
      "WF3_LIFECYCLE_INVALID",
      "A confirmed chain result requires a valid status and txHash.",
    );
  }
  return nextLifecycle(
    validated,
    {
      status: result.status,
      finalized: true,
      txHash: result.txHash,
      alert: pendingAlert(ALERT_KINDS.CHAIN_RESULT),
    },
    options,
  );
}

function failLifecycle(current, errorCode, options = {}) {
  const validated = validateLifecycle(current);
  assertOpen(validated);
  if (typeof errorCode !== "string" || !SAFE_CODE_PATTERN.test(errorCode)) {
    fail("WF3_LIFECYCLE_INVALID", "errorCode must be a safe machine code.");
  }
  return nextLifecycle(
    validated,
    {
      status: STATUSES.FAILED,
      finalized: true,
      errorCode,
      alert: pendingAlert(ALERT_KINDS.PIPELINE_FAILURE),
    },
    options,
  );
}

function claimFinalAlert(
  current,
  { expectedRevision, claimId, now = Date.now } = {},
) {
  const validated = validateLifecycle(current);
  assertExpectedRevision(validated, expectedRevision);

  if (validated.alert.state !== ALERT_STATES.PENDING) {
    return Object.freeze({
      claimCreated: false,
      reason: validated.alert.required
        ? "final_alert_already_claimed"
        : "final_alert_not_required",
      lifecycle: validated,
    });
  }

  const claimedAt = timestamp(now);
  if (Date.parse(claimedAt) < Date.parse(validated.updatedAt)) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle time cannot move backwards.");
  }
  const claimRevision = validated.revision + 1;
  const lifecycle = validateLifecycle({
    ...validated,
    alert: {
      ...validated.alert,
      state: ALERT_STATES.CLAIMED,
      claimId: validateIdentifier(claimId, "claimId"),
      claimRevision,
      claimedAt,
    },
    revision: claimRevision,
    updatedAt: claimedAt,
  });

  return Object.freeze({
    claimCreated: true,
    reason: "final_alert_claimed",
    claim: Object.freeze({
      claimId: lifecycle.alert.claimId,
      claimRevision,
    }),
    lifecycle,
  });
}

function authorizeFinalAlertDispatch(current, { claimId, claimRevision } = {}) {
  const validated = validateLifecycle(current);
  validateIdentifier(claimId, "claimId");
  if (!Number.isSafeInteger(claimRevision) || claimRevision < 1) {
    fail("WF3_LIFECYCLE_INVALID", "claimRevision is invalid.");
  }
  return (
    validated.alert.state === ALERT_STATES.CLAIMED &&
    validated.alert.claimId === claimId &&
    validated.alert.claimRevision === claimRevision &&
    validated.revision === claimRevision
  );
}

function settleFinalAlert(
  current,
  { expectedRevision, claimId, claimRevision, outcome, now = Date.now } = {},
) {
  const validated = validateLifecycle(current);
  assertExpectedRevision(validated, expectedRevision);
  validateIdentifier(claimId, "claimId");
  if (!Number.isSafeInteger(claimRevision) || claimRevision < 1) {
    fail("WF3_LIFECYCLE_INVALID", "claimRevision is invalid.");
  }
  if (!DELIVERY_OUTCOME_VALUES.has(outcome)) {
    fail("WF3_LIFECYCLE_INVALID", "Delivery outcome is invalid.");
  }

  const sameClaim =
    validated.alert.claimId === claimId &&
    validated.alert.claimRevision === claimRevision;
  const alreadySettled = [
    ALERT_STATES.SENT,
    ALERT_STATES.CLOSED_FAILED,
    ALERT_STATES.CLOSED_UNCERTAIN,
  ].includes(validated.alert.state);

  if (alreadySettled && sameClaim && validated.alert.outcome === outcome) {
    return validated;
  }
  if (validated.alert.state !== ALERT_STATES.CLAIMED || !sameClaim) {
    fail(
      "WF3_LIFECYCLE_CLAIM_MISMATCH",
      "Final-alert claim does not match the active claim.",
    );
  }

  const completedAt = timestamp(now);
  if (Date.parse(completedAt) < Date.parse(validated.updatedAt)) {
    fail("WF3_LIFECYCLE_INVALID", "Lifecycle time cannot move backwards.");
  }
  const state = {
    [DELIVERY_OUTCOMES.SENT]: ALERT_STATES.SENT,
    [DELIVERY_OUTCOMES.FAILED]: ALERT_STATES.CLOSED_FAILED,
    [DELIVERY_OUTCOMES.UNCERTAIN]: ALERT_STATES.CLOSED_UNCERTAIN,
  }[outcome];

  return validateLifecycle({
    ...validated,
    alert: {
      ...validated.alert,
      state,
      completedAt,
      outcome,
    },
    revision: validated.revision + 1,
    updatedAt: completedAt,
  });
}

function validateLifecycleSuccessor(current, candidate) {
  const validatedCurrent = validateLifecycle(current);
  const validatedCandidate = validateLifecycle(candidate);
  if (
    validatedCurrent.reportId !== validatedCandidate.reportId ||
    validatedCurrent.createdAt !== validatedCandidate.createdAt ||
    validatedCurrent.revision === Number.MAX_SAFE_INTEGER ||
    validatedCandidate.revision !== validatedCurrent.revision + 1
  ) {
    fail(
      "WF3_LIFECYCLE_TRANSITION",
      "Lifecycle candidate is not the next valid revision.",
    );
  }

  const options = {
    expectedRevision: validatedCurrent.revision,
    now: () => validatedCandidate.updatedAt,
  };
  let expected;

  if (!validatedCurrent.finalized) {
    if (validatedCandidate.status === STATUSES.FAILED) {
      expected = failLifecycle(
        validatedCurrent,
        validatedCandidate.errorCode,
        options,
      );
    } else if (validatedCurrent.status === STATUSES.QUEUED) {
      expected = startAnalysis(validatedCurrent, options);
    } else if (validatedCurrent.status === STATUSES.ANALYZING) {
      expected = applyDecision(
        validatedCurrent,
        validatedCandidate.decision,
        options,
      );
    } else if (validatedCurrent.status === STATUSES.REPORTING) {
      expected = completeReport(
        validatedCurrent,
        {
          status: validatedCandidate.status,
          txHash: validatedCandidate.txHash,
        },
        options,
      );
    }
  } else if (validatedCurrent.alert.state === ALERT_STATES.PENDING) {
    expected = claimFinalAlert(validatedCurrent, {
      ...options,
      claimId: validatedCandidate.alert.claimId,
    }).lifecycle;
  } else if (validatedCurrent.alert.state === ALERT_STATES.CLAIMED) {
    expected = settleFinalAlert(validatedCurrent, {
      ...options,
      claimId: validatedCandidate.alert.claimId,
      claimRevision: validatedCandidate.alert.claimRevision,
      outcome: validatedCandidate.alert.outcome,
    });
  }

  if (!expected || !isDeepStrictEqual(expected, validatedCandidate)) {
    fail(
      "WF3_LIFECYCLE_TRANSITION",
      "Lifecycle candidate does not match an allowed transition.",
    );
  }
  return validatedCandidate;
}

module.exports = {
  ALERT_KINDS,
  ALERT_STATES,
  DECISIONS,
  DELIVERY_OUTCOMES,
  SCHEMA_VERSION,
  STATUSES,
  Wf3LifecycleError,
  applyDecision,
  authorizeFinalAlertDispatch,
  claimFinalAlert,
  completeReport,
  createLifecycle,
  failLifecycle,
  settleFinalAlert,
  startAnalysis,
  validateLifecycle,
  validateLifecycleReportId,
  validateLifecycleSuccessor,
};
