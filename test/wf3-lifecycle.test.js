"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALERT_STATES,
  DECISIONS,
  DELIVERY_OUTCOMES,
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
} = require("../n8n/lib/wf3Lifecycle");

const REPORT_ID = "r_20260801_120000_0123456789abcdef";
const TX_HASH = `0x${"a".repeat(64)}`;
const TIMES = Object.freeze({
  queued: "2026-08-01T12:00:00.000Z",
  analyzing: "2026-08-01T12:00:01.000Z",
  decided: "2026-08-01T12:00:02.000Z",
  claimed: "2026-08-01T12:00:03.000Z",
  settled: "2026-08-01T12:00:04.000Z",
});

function at(value) {
  return () => value;
}

function analyzingLifecycle() {
  const queued = createLifecycle(REPORT_ID, { now: at(TIMES.queued) });
  return startAnalysis(queued, {
    expectedRevision: 0,
    now: at(TIMES.analyzing),
  });
}

function terminalLifecycle(decision = DECISIONS.MANUAL_REVIEW) {
  const analyzing = analyzingLifecycle();
  if (decision === DECISIONS.REPORT) {
    const reporting = applyDecision(analyzing, decision, {
      expectedRevision: 1,
      now: at(TIMES.decided),
    });
    return completeReport(
      reporting,
      { status: STATUSES.REPORTED, txHash: TX_HASH },
      { expectedRevision: 2, now: at(TIMES.claimed) },
    );
  }
  return applyDecision(analyzing, decision, {
    expectedRevision: 1,
    now: at(TIMES.decided),
  });
}

test("creates an exact immutable queued lifecycle", () => {
  const lifecycle = createLifecycle(REPORT_ID, { now: at(TIMES.queued) });

  assert.deepEqual(lifecycle, {
    schemaVersion: 1,
    reportId: REPORT_ID,
    status: "queued",
    decision: null,
    finalized: false,
    txHash: null,
    errorCode: null,
    alert: {
      required: false,
      kind: null,
      state: "not_required",
      claimId: null,
      claimRevision: null,
      claimedAt: null,
      completedAt: null,
      outcome: null,
    },
    revision: 0,
    createdAt: TIMES.queued,
    updatedAt: TIMES.queued,
  });
  assert.equal(Object.isFrozen(lifecycle), true);
  assert.equal(Object.isFrozen(lifecycle.alert), true);
});

test("log-only finalizes analyzing without creating an alert", () => {
  const completed = applyDecision(analyzingLifecycle(), DECISIONS.LOG_ONLY, {
    expectedRevision: 1,
    now: at(TIMES.decided),
  });

  assert.equal(completed.status, STATUSES.ANALYZING);
  assert.equal(completed.decision, DECISIONS.LOG_ONLY);
  assert.equal(completed.finalized, true);
  assert.equal(completed.alert.state, ALERT_STATES.NOT_REQUIRED);

  const claim = claimFinalAlert(completed, {
    expectedRevision: 2,
    claimId: "execution-1",
    now: at(TIMES.claimed),
  });
  assert.equal(claim.claimCreated, false);
  assert.equal(claim.reason, "final_alert_not_required");
});

test("manual review creates one pending final alert", () => {
  const manual = terminalLifecycle();

  assert.equal(manual.status, STATUSES.MANUAL_REVIEW);
  assert.equal(manual.finalized, true);
  assert.equal(manual.alert.required, true);
  assert.equal(manual.alert.kind, "manual_review");
  assert.equal(manual.alert.state, ALERT_STATES.PENDING);
});

test("reported and already-blacklisted results require a confirmed txHash", () => {
  const analyzing = analyzingLifecycle();
  const reporting = applyDecision(analyzing, DECISIONS.REPORT, {
    expectedRevision: 1,
    now: at(TIMES.decided),
  });

  assert.equal(reporting.status, STATUSES.REPORTING);
  assert.throws(
    () =>
      completeReport(
        reporting,
        { status: STATUSES.REPORTED, txHash: "0x1234" },
        { expectedRevision: 2, now: at(TIMES.claimed) },
      ),
    Wf3LifecycleError,
  );
  assert.throws(
    () =>
      completeReport(
        reporting,
        {
          status: STATUSES.REPORTED,
          txHash: TX_HASH,
          providerDetail: "must-not-persist",
        },
        { expectedRevision: 2, now: at(TIMES.claimed) },
      ),
    Wf3LifecycleError,
  );

  const existing = completeReport(
    reporting,
    { status: STATUSES.ALREADY_BLACKLISTED, txHash: TX_HASH },
    { expectedRevision: 2, now: at(TIMES.claimed) },
  );
  assert.equal(existing.status, STATUSES.ALREADY_BLACKLISTED);
  assert.equal(existing.txHash, TX_HASH);
  assert.equal(existing.alert.kind, "chain_result");
  assert.equal(existing.alert.state, ALERT_STATES.PENDING);
});

test("pipeline failure stores only a bounded machine code and requests notification", () => {
  const failed = failLifecycle(analyzingLifecycle(), "CHAIN_TIMEOUT", {
    expectedRevision: 1,
    now: at(TIMES.decided),
  });

  assert.equal(failed.status, STATUSES.FAILED);
  assert.equal(failed.errorCode, "CHAIN_TIMEOUT");
  assert.equal(failed.alert.kind, "pipeline_failure");
  assert.equal(JSON.stringify(failed).includes("provider"), false);

  assert.throws(
    () =>
      failLifecycle(analyzingLifecycle(), "RPC failed: secret endpoint", {
        expectedRevision: 1,
        now: at(TIMES.decided),
      }),
    Wf3LifecycleError,
  );
});

test("a revision-checked claim authorizes exactly one final-alert dispatcher", () => {
  const manual = terminalLifecycle();
  const first = claimFinalAlert(manual, {
    expectedRevision: 2,
    claimId: "execution-123",
    now: at(TIMES.claimed),
  });

  assert.equal(first.claimCreated, true);
  assert.deepEqual(first.claim, {
    claimId: "execution-123",
    claimRevision: 3,
  });
  assert.equal(first.lifecycle.alert.state, ALERT_STATES.CLAIMED);
  assert.equal(authorizeFinalAlertDispatch(first.lifecycle, first.claim), true);
  assert.equal(
    authorizeFinalAlertDispatch(first.lifecycle, {
      claimId: "execution-duplicate",
      claimRevision: first.claim.claimRevision,
    }),
    false,
  );

  const duplicate = claimFinalAlert(first.lifecycle, {
    expectedRevision: 3,
    claimId: "execution-duplicate",
    now: at(TIMES.settled),
  });
  assert.equal(duplicate.claimCreated, false);
  assert.equal(duplicate.reason, "final_alert_already_claimed");

  assert.throws(
    () =>
      claimFinalAlert(first.lifecycle, {
        expectedRevision: 2,
        claimId: "stale-execution",
        now: at(TIMES.settled),
      }),
    (error) => error.code === "WF3_LIFECYCLE_CONFLICT",
  );
});

test("successful alert settlement is idempotent for the same claim", () => {
  const claimed = claimFinalAlert(terminalLifecycle(DECISIONS.REPORT), {
    expectedRevision: 3,
    claimId: "execution-chain-alert",
    now: at(TIMES.settled),
  });
  const sent = settleFinalAlert(claimed.lifecycle, {
    ...claimed.claim,
    expectedRevision: claimed.lifecycle.revision,
    outcome: DELIVERY_OUTCOMES.SENT,
    now: at("2026-08-01T12:00:05.000Z"),
  });

  assert.equal(sent.alert.state, ALERT_STATES.SENT);
  assert.equal(sent.alert.outcome, DELIVERY_OUTCOMES.SENT);
  assert.equal(sent.revision, 5);
  assert.equal(authorizeFinalAlertDispatch(sent, claimed.claim), false);

  const repeated = settleFinalAlert(sent, {
    ...claimed.claim,
    expectedRevision: sent.revision,
    outcome: DELIVERY_OUTCOMES.SENT,
    now: at("2026-08-01T12:00:06.000Z"),
  });
  assert.deepEqual(repeated, sent);
  assert.equal(repeated.revision, sent.revision);
});

test("failed or uncertain delivery closes automatic redispatch", () => {
  for (const [outcome, expectedState] of [
    [DELIVERY_OUTCOMES.FAILED, ALERT_STATES.CLOSED_FAILED],
    [DELIVERY_OUTCOMES.UNCERTAIN, ALERT_STATES.CLOSED_UNCERTAIN],
  ]) {
    const manual = terminalLifecycle();
    const claimed = claimFinalAlert(manual, {
      expectedRevision: 2,
      claimId: `execution-${outcome}`,
      now: at(TIMES.claimed),
    });
    const closed = settleFinalAlert(claimed.lifecycle, {
      ...claimed.claim,
      expectedRevision: claimed.lifecycle.revision,
      outcome,
      now: at(TIMES.settled),
    });

    assert.equal(closed.alert.state, expectedState);
    const duplicate = claimFinalAlert(closed, {
      expectedRevision: 4,
      claimId: `retry-${outcome}`,
      now: at("2026-08-01T12:00:05.000Z"),
    });
    assert.equal(duplicate.claimCreated, false);
    assert.equal(duplicate.reason, "final_alert_already_claimed");
  }
});

test("a different claim cannot settle or rewrite an alert outcome", () => {
  const claimed = claimFinalAlert(terminalLifecycle(), {
    expectedRevision: 2,
    claimId: "execution-owner",
    now: at(TIMES.claimed),
  });

  assert.throws(
    () =>
      settleFinalAlert(claimed.lifecycle, {
        expectedRevision: claimed.lifecycle.revision,
        claimId: "execution-attacker",
        claimRevision: claimed.claim.claimRevision,
        outcome: DELIVERY_OUTCOMES.SENT,
        now: at(TIMES.settled),
      }),
    (error) => error.code === "WF3_LIFECYCLE_CLAIM_MISMATCH",
  );

  const sent = settleFinalAlert(claimed.lifecycle, {
    ...claimed.claim,
    expectedRevision: claimed.lifecycle.revision,
    outcome: DELIVERY_OUTCOMES.SENT,
    now: at(TIMES.settled),
  });
  assert.throws(
    () =>
      settleFinalAlert(sent, {
        ...claimed.claim,
        expectedRevision: sent.revision,
        outcome: DELIVERY_OUTCOMES.UNCERTAIN,
        now: at("2026-08-01T12:00:05.000Z"),
      }),
    (error) => error.code === "WF3_LIFECYCLE_CLAIM_MISMATCH",
  );

  assert.throws(
    () =>
      settleFinalAlert(sent, {
        ...claimed.claim,
        expectedRevision: claimed.lifecycle.revision,
        outcome: DELIVERY_OUTCOMES.SENT,
        now: at("2026-08-01T12:00:05.000Z"),
      }),
    (error) => error.code === "WF3_LIFECYCLE_CONFLICT",
  );
});

test("finalized and out-of-order lifecycle transitions are rejected", () => {
  const queued = createLifecycle(REPORT_ID, { now: at(TIMES.queued) });
  assert.throws(
    () =>
      applyDecision(queued, DECISIONS.REPORT, {
        expectedRevision: 0,
        now: at(TIMES.analyzing),
      }),
    (error) => error.code === "WF3_LIFECYCLE_TRANSITION",
  );

  const manual = terminalLifecycle();
  assert.throws(
    () =>
      failLifecycle(manual, "CHAIN_TIMEOUT", {
        expectedRevision: 2,
        now: at(TIMES.claimed),
      }),
    (error) => error.code === "WF3_LIFECYCLE_FINALIZED",
  );
});

test("strict hydration rejects unknown fields and tampered invariants", () => {
  const lifecycle = createLifecycle(REPORT_ID, { now: at(TIMES.queued) });

  assert.throws(
    () => validateLifecycle({ ...lifecycle, secret: "must-not-persist" }),
    Wf3LifecycleError,
  );
  assert.throws(
    () =>
      validateLifecycle({
        ...lifecycle,
        status: STATUSES.REPORTED,
        finalized: true,
        decision: DECISIONS.REPORT,
        txHash: { toString: () => TX_HASH },
        alert: {
          ...lifecycle.alert,
          required: true,
          kind: "chain_result",
          state: ALERT_STATES.PENDING,
        },
      }),
    Wf3LifecycleError,
  );
  assert.throws(
    () =>
      startAnalysis(lifecycle, {
        expectedRevision: 1,
        now: at(TIMES.analyzing),
      }),
    (error) => error.code === "WF3_LIFECYCLE_CONFLICT",
  );
});
