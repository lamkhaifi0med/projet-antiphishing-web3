"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { buildFinalDiscordPayload } = require("../../lib/wf3Discord");
const { decideWf3Action } = require("../../lib/wf3Decision");
const {
  ALERT_STATES,
  STATUSES,
  applyDecision,
  authorizeFinalAlertDispatch,
  claimFinalAlert,
  completeReport,
  createLifecycle,
  failLifecycle,
  settleFinalAlert,
  startAnalysis,
} = require("../../lib/wf3Lifecycle");
const {
  MAX_ATTEMPTS,
  planAfterBridgeFailure,
  planAfterReportRecheck,
} = require("../../lib/wf3Retry");
const { LifecycleStoreError } = require("./lifecycleStore");

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTEXT_FIELDS = Object.freeze([
  "reportId",
  "type",
  "value",
  "verdict",
  "category",
  "scoreFinal",
  "indicators",
]);
const OPTIONAL_CONTEXT_FIELDS = Object.freeze([
  "llmConfidence",
  "featureScore",
]);
const EXECUTE_FIELDS = Object.freeze([...CONTEXT_FIELDS, "executionId"]);
const CLAIM_FIELDS = Object.freeze(["context", "claimId"]);
const SETTLE_FIELDS = Object.freeze(["reportId", "claim", "outcome"]);
const CLAIM_VALUE_FIELDS = Object.freeze(["claimId", "claimRevision"]);

class Wf3CoordinatorError extends Error {
  constructor(statusCode, code, message, { retryable = false } = {}) {
    super(message);
    this.name = "Wf3CoordinatorError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function coordinatorError(statusCode, code, message, options) {
  return new Wf3CoordinatorError(statusCode, code, message, options);
}

function assertExactObject(value, fields, label, optionalFields = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw coordinatorError(
      400,
      "WF3_REQUEST_INVALID",
      `${label} must be an object.`,
    );
  }
  const allowed = new Set([...fields, ...optionalFields]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw coordinatorError(
      400,
      "WF3_REQUEST_INVALID",
      `${label} must contain exactly its allowed fields.`,
    );
  }
}

function contextFromDecision(decision) {
  return Object.freeze({
    reportId: decision.reportId,
    type: decision.type,
    value: decision.value,
    verdict: decision.verdict,
    category: decision.category,
    scoreFinal: decision.scoreFinal,
    indicators: Object.freeze([...decision.indicators]),
    llmConfidence: decision.llmConfidence ?? null,
    featureScore: decision.featureScore ?? null,
  });
}

function executionContext(input) {
  return Object.fromEntries(
    [...CONTEXT_FIELDS, ...OPTIONAL_CONTEXT_FIELDS]
      .filter((field) => Object.prototype.hasOwnProperty.call(input, field))
      .map((field) => [field, input[field]]),
  );
}

function validateExecutionId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
  ) {
    throw coordinatorError(
      400,
      "WF3_REQUEST_INVALID",
      "executionId is invalid.",
    );
  }
  return value;
}

function hashContext(context) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function validateClaimValue(value) {
  assertExactObject(value, CLAIM_VALUE_FIELDS, "claim");
  if (
    typeof value.claimId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value.claimId) ||
    !Number.isSafeInteger(value.claimRevision) ||
    value.claimRevision < 1
  ) {
    throw coordinatorError(400, "WF3_REQUEST_INVALID", "claim is invalid.");
  }
  return Object.freeze({
    claimId: value.claimId,
    claimRevision: value.claimRevision,
  });
}

function validateChainResult(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw coordinatorError(
      502,
      "CHAIN_RESULT_INVALID",
      "Blockchain operation returned an invalid result.",
    );
  }
  return result;
}

function validateConfirmedResult(status, txHash) {
  if (
    (status !== STATUSES.REPORTED && status !== STATUSES.ALREADY_BLACKLISTED) ||
    typeof txHash !== "string" ||
    !TX_HASH_PATTERN.test(txHash)
  ) {
    throw coordinatorError(
      502,
      "CHAIN_RESULT_UNCONFIRMED",
      "Blockchain operation did not return confirmed transaction evidence.",
    );
  }
  return Object.freeze({ status, txHash });
}

function lifecycleOutput(decision, lifecycle) {
  return Object.freeze({
    reportId: lifecycle.reportId,
    action: decision.action,
    status: lifecycle.status,
    finalized: lifecycle.finalized,
    alertRequired: lifecycle.alert.state === ALERT_STATES.PENDING,
    txHash: lifecycle.txHash,
    errorCode: lifecycle.errorCode,
  });
}

function executionIsOpen(lifecycle) {
  return (
    !lifecycle.finalized ||
    lifecycle.alert.state === ALERT_STATES.PENDING ||
    lifecycle.alert.state === ALERT_STATES.CLAIMED
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class Wf3Coordinator {
  constructor({
    lifecycleStore,
    runAction,
    now = Date.now,
    random = Math.random,
    wait = sleep,
  }) {
    this.lifecycleStore = lifecycleStore;
    this.runAction = runAction;
    this.now = now;
    this.random = random;
    this.wait = wait;
    this.executionLocks = new Map();
  }

  requireDependencies() {
    if (
      !this.lifecycleStore ||
      typeof this.lifecycleStore.read !== "function" ||
      typeof this.lifecycleStore.create !== "function" ||
      typeof this.lifecycleStore.compareAndSwap !== "function" ||
      typeof this.lifecycleStore.bindContext !== "function" ||
      typeof this.lifecycleStore.bindExecution !== "function" ||
      typeof this.runAction !== "function" ||
      typeof this.now !== "function" ||
      typeof this.random !== "function" ||
      typeof this.wait !== "function"
    ) {
      throw coordinatorError(
        503,
        "WF3_COORDINATOR_UNAVAILABLE",
        "WF3 coordinator is unavailable.",
        { retryable: true },
      );
    }
  }

  withExecutionLock(reportId, operation) {
    const previous = this.executionLocks.get(reportId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.executionLocks.set(reportId, current);
    return current.finally(() => {
      if (this.executionLocks.get(reportId) === current) {
        this.executionLocks.delete(reportId);
      }
    });
  }

  createOrRead(reportId) {
    const existing = this.lifecycleStore.read(reportId);
    if (existing) return existing;

    try {
      return this.lifecycleStore.create(
        createLifecycle(reportId, { now: this.now }),
      );
    } catch (error) {
      if (
        error instanceof LifecycleStoreError &&
        error.code === "LIFECYCLE_ALREADY_EXISTS"
      ) {
        const concurrent = this.lifecycleStore.read(reportId);
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  persistSuccessor(current, candidate) {
    return this.lifecycleStore.compareAndSwap(
      current.reportId,
      current.revision,
      candidate,
    ).lifecycle;
  }

  prepareLifecycle(context, decision, executionId) {
    this.lifecycleStore.bindContext(context.reportId, hashContext(context));
    let lifecycle = this.lifecycleStore.read(context.reportId);
    if (!lifecycle || executionIsOpen(lifecycle)) {
      this.lifecycleStore.bindExecution(context.reportId, executionId);
    }
    if (!lifecycle) lifecycle = this.createOrRead(context.reportId);
    const startedInReporting = lifecycle.status === STATUSES.REPORTING;

    if (lifecycle.status === STATUSES.QUEUED) {
      lifecycle = this.persistSuccessor(
        lifecycle,
        startAnalysis(lifecycle, {
          expectedRevision: lifecycle.revision,
          now: this.now,
        }),
      );
    }

    if (
      lifecycle.status === STATUSES.ANALYZING &&
      lifecycle.decision === null &&
      lifecycle.finalized === false
    ) {
      lifecycle = this.persistSuccessor(
        lifecycle,
        applyDecision(lifecycle, decision.action, {
          expectedRevision: lifecycle.revision,
          now: this.now,
        }),
      );
    }

    if (lifecycle.decision !== decision.action) {
      throw coordinatorError(
        409,
        "WF3_DECISION_CONFLICT",
        "The persisted WF3 decision conflicts with this execution.",
      );
    }

    return Object.freeze({ lifecycle, recoveredReporting: startedInReporting });
  }

  completeLifecycle(current, result) {
    const confirmed = validateConfirmedResult(result.status, result.txHash);
    return this.persistSuccessor(
      current,
      completeReport(current, confirmed, {
        expectedRevision: current.revision,
        now: this.now,
      }),
    );
  }

  failLifecycle(current, errorCode) {
    if (current.finalized) return current;
    return this.persistSuccessor(
      current,
      failLifecycle(current, errorCode, {
        expectedRevision: current.revision,
        now: this.now,
      }),
    );
  }

  async checkExisting(decision) {
    const result = validateChainResult(
      await this.runAction("check", {
        type: decision.type,
        value: decision.value,
      }),
    );
    if (typeof result.blacklisted !== "boolean") {
      throw coordinatorError(
        502,
        "CHAIN_RESULT_INVALID",
        "Blockchain check returned an invalid result.",
      );
    }
    return result;
  }

  async confirmedExisting(decision) {
    const checked = await this.checkExisting(decision);
    if (!checked.blacklisted) return null;
    return validateConfirmedResult(
      STATUSES.ALREADY_BLACKLISTED,
      checked.txHash,
    );
  }

  async completeReportedResult(current, decision, result) {
    const validated = validateChainResult(result);
    if (validated.status === STATUSES.REPORTED) {
      return this.completeLifecycle(
        current,
        validateConfirmedResult(STATUSES.REPORTED, validated.txHash),
      );
    }
    if (validated.status === STATUSES.ALREADY_BLACKLISTED) {
      const existing = await this.confirmedExisting(decision);
      if (!existing) {
        throw coordinatorError(
          502,
          "CHAIN_RESULT_UNCONFIRMED",
          "Existing blockchain entry could not be confirmed.",
        );
      }
      return this.completeLifecycle(current, existing);
    }
    throw coordinatorError(
      502,
      "CHAIN_RESULT_INVALID",
      "Blockchain report returned an invalid result.",
    );
  }

  failureInput(error) {
    return {
      statusCode:
        error instanceof Wf3CoordinatorError ? null : error?.statusCode,
      code: error?.code,
      body: error?.body,
    };
  }

  async recoverReporting(decision) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.checkExisting(decision);
        if (!result.blacklisted) {
          return Object.freeze({ action: "continue_report" });
        }
        return Object.freeze({
          action: "complete_existing",
          result: validateConfirmedResult(
            STATUSES.ALREADY_BLACKLISTED,
            result.txHash,
          ),
        });
      } catch (error) {
        const plan = planAfterBridgeFailure({
          operation: "check",
          attempt,
          failure: this.failureInput(error),
          delayOptions: { random: this.random },
        });
        if (plan.action !== "retry") return plan;
        await this.wait(plan.delayMs);
      }
    }
    return Object.freeze({
      action: "fail",
      code: "CHAIN_RECHECK_FAILED",
      reason: "attempts_exhausted",
    });
  }

  async recheckAfterReportFailure(decision, reportAttempt, errorCode) {
    let lastFailure = null;
    for (
      let checkAttempt = 1;
      checkAttempt <= MAX_ATTEMPTS;
      checkAttempt += 1
    ) {
      try {
        const checkResult = await this.checkExisting(decision);
        const plan = planAfterReportRecheck({
          reportAttempt,
          errorCode,
          checkResult,
          delayOptions: { random: this.random },
        });
        if (plan.action === "complete_existing") {
          return Object.freeze({
            ...plan,
            result: validateConfirmedResult(
              STATUSES.ALREADY_BLACKLISTED,
              checkResult.txHash,
            ),
          });
        }
        return plan;
      } catch (error) {
        lastFailure = error;
        const plan = planAfterBridgeFailure({
          operation: "check",
          attempt: checkAttempt,
          failure: this.failureInput(error),
          delayOptions: { random: this.random },
        });
        if (plan.action !== "retry") break;
        await this.wait(plan.delayMs);
      }
    }

    return Object.freeze({
      action: "fail",
      code:
        typeof lastFailure?.code === "string"
          ? lastFailure.code
          : "CHAIN_RECHECK_FAILED",
      reason: "recheck_failed",
    });
  }

  async executeReport(current, decision, recoveredReporting) {
    let lifecycle = current;

    if (recoveredReporting) {
      const recovery = await this.recoverReporting(decision);
      if (recovery.action === "complete_existing") {
        return this.completeLifecycle(lifecycle, recovery.result);
      }
      if (recovery.action === "fail") {
        return this.failLifecycle(lifecycle, recovery.code);
      }
    }

    let attempt = 1;
    while (attempt <= MAX_ATTEMPTS) {
      try {
        const result = await this.runAction("report", decision.bridgePayload);
        return await this.completeReportedResult(lifecycle, decision, result);
      } catch (error) {
        const plan = planAfterBridgeFailure({
          operation: "report",
          attempt,
          failure: this.failureInput(error),
          delayOptions: { random: this.random },
        });
        if (plan.action === "fail") {
          return this.failLifecycle(lifecycle, plan.code);
        }

        const afterRecheck = await this.recheckAfterReportFailure(
          decision,
          attempt,
          plan.errorCode,
        );
        if (afterRecheck.action === "complete_existing") {
          return this.completeLifecycle(lifecycle, afterRecheck.result);
        }
        if (afterRecheck.action === "fail") {
          return this.failLifecycle(lifecycle, afterRecheck.code);
        }

        await this.wait(afterRecheck.delayMs);
        attempt = afterRecheck.nextAttempt;
      }
    }

    return this.failLifecycle(lifecycle, "CHAIN_ATTEMPTS_EXHAUSTED");
  }

  async execute(input) {
    this.requireDependencies();
    assertExactObject(
      input,
      EXECUTE_FIELDS,
      "WF3 execution request",
      OPTIONAL_CONTEXT_FIELDS,
    );
    const executionId = validateExecutionId(input.executionId);
    const decision = decideWf3Action(executionContext(input));
    const context = contextFromDecision(decision);

    return this.withExecutionLock(context.reportId, async () => {
      const prepared = this.prepareLifecycle(context, decision, executionId);
      let lifecycle = prepared.lifecycle;

      if (
        decision.action === "report" &&
        lifecycle.status === STATUSES.REPORTING &&
        !lifecycle.finalized
      ) {
        lifecycle = await this.executeReport(
          lifecycle,
          decision,
          prepared.recoveredReporting,
        );
      }
      return lifecycleOutput(decision, lifecycle);
    });
  }

  buildAuthorizedClaim(lifecycle, claim, context) {
    if (!authorizeFinalAlertDispatch(lifecycle, claim)) {
      return Object.freeze({
        authorized: false,
        reason: "claim_not_authorized",
        reportId: lifecycle.reportId,
      });
    }
    const payload = buildFinalDiscordPayload({ lifecycle, claim, context });
    return Object.freeze({
      authorized: true,
      reportId: lifecycle.reportId,
      claim,
      channel: payload.channel,
      discord: payload.discord,
    });
  }

  async claim(input) {
    this.requireDependencies();
    assertExactObject(input, CLAIM_FIELDS, "WF3 claim request");
    if (
      typeof input.claimId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.claimId)
    ) {
      throw coordinatorError(400, "WF3_REQUEST_INVALID", "claimId is invalid.");
    }

    const decision = decideWf3Action(input.context);
    const context = contextFromDecision(decision);
    return this.withExecutionLock(context.reportId, async () => {
      this.lifecycleStore.bindContext(context.reportId, hashContext(context));
      let lifecycle = this.lifecycleStore.read(context.reportId);
      if (!lifecycle) {
        throw new LifecycleStoreError(
          "LIFECYCLE_NOT_FOUND",
          "Lifecycle was not found.",
          404,
        );
      }

      if (executionIsOpen(lifecycle)) {
        this.lifecycleStore.bindExecution(context.reportId, input.claimId);
      }

      if (lifecycle.alert.state !== ALERT_STATES.PENDING) {
        return Object.freeze({
          authorized: false,
          reason: lifecycle.alert.required
            ? "final_alert_already_claimed"
            : "final_alert_not_required",
          reportId: lifecycle.reportId,
        });
      }

      const candidate = claimFinalAlert(lifecycle, {
        expectedRevision: lifecycle.revision,
        claimId: input.claimId,
        now: this.now,
      });
      let applied = false;
      try {
        applied = this.lifecycleStore.compareAndSwap(
          lifecycle.reportId,
          lifecycle.revision,
          candidate.lifecycle,
        ).applied;
      } catch (error) {
        if (
          !(error instanceof LifecycleStoreError) ||
          error.code !== "LIFECYCLE_CONFLICT"
        ) {
          throw error;
        }
      }

      lifecycle = this.lifecycleStore.read(context.reportId);
      if (!lifecycle) {
        throw new LifecycleStoreError(
          "LIFECYCLE_NOT_FOUND",
          "Lifecycle was not found.",
          404,
        );
      }
      if (!applied) {
        return Object.freeze({
          authorized: false,
          reason: "final_alert_already_claimed",
          reportId: lifecycle.reportId,
        });
      }
      return this.buildAuthorizedClaim(lifecycle, candidate.claim, context);
    });
  }

  async settle(input) {
    this.requireDependencies();
    assertExactObject(input, SETTLE_FIELDS, "WF3 settlement request");
    const claim = validateClaimValue(input.claim);

    return this.withExecutionLock(input.reportId, async () => {
      const current = this.lifecycleStore.read(input.reportId);
      if (!current) {
        throw new LifecycleStoreError(
          "LIFECYCLE_NOT_FOUND",
          "Lifecycle was not found.",
          404,
        );
      }
      const candidate = settleFinalAlert(current, {
        ...claim,
        expectedRevision: current.revision,
        outcome: input.outcome,
        now: this.now,
      });
      const lifecycle = isDeepStrictEqual(candidate, current)
        ? current
        : this.persistSuccessor(current, candidate);
      return Object.freeze({
        settled: true,
        reportId: lifecycle.reportId,
        status: lifecycle.status,
        alertState: lifecycle.alert.state,
        txHash: lifecycle.txHash,
        errorCode: lifecycle.errorCode,
      });
    });
  }
}

module.exports = {
  Wf3Coordinator,
  Wf3CoordinatorError,
  contextFromDecision,
  hashContext,
};
