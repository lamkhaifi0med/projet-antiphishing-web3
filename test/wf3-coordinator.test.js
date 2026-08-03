"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Wf3Coordinator,
} = require("../n8n/services/chain-bridge/wf3Coordinator");
const {
  LifecycleStore,
  LifecycleStoreError,
} = require("../n8n/services/chain-bridge/lifecycleStore");
const { ChainProcessError } = require("../n8n/services/chain-bridge/runner");

const TX_HASH = `0x${"a".repeat(64)}`;
const EXISTING_TX_HASH = `0x${"b".repeat(64)}`;
const URL = "https://coordinator.invalid/claim";

function context(overrides = {}) {
  return {
    reportId: "r_20260801_coordinator",
    type: "url",
    value: URL,
    verdict: "malicious",
    category: "fake_airdrop",
    scoreFinal: 0.91,
    indicators: ["Synthetic wallet prompt", "Synthetic urgent claim"],
    ...overrides,
  };
}

function executeInput(value, executionId = "n8n-execution-a") {
  return { ...value, executionId };
}

function clock() {
  let milliseconds = Date.parse("2026-08-01T18:00:00.000Z");
  return () => {
    const current = milliseconds;
    milliseconds += 1_000;
    return current;
  };
}

function coordinator(runAction, options = {}) {
  const lifecycleStore =
    options.lifecycleStore || new LifecycleStore(":memory:");
  const waits = [];
  return {
    lifecycleStore,
    waits,
    subject: new Wf3Coordinator({
      lifecycleStore,
      runAction,
      now: options.now || clock(),
      random: () => 0.5,
      wait: async (milliseconds) => waits.push(milliseconds),
    }),
  };
}

function chainFailure(code = "CHAIN_TIMEOUT") {
  return new ChainProcessError(code, "sensitive provider detail", {
    recheckRequired: true,
  });
}

test("log-only and manual-review decisions never call the blockchain", async () => {
  let calls = 0;
  const fixture = coordinator(async () => {
    calls += 1;
    throw new Error("blockchain must not be called");
  });

  try {
    const logged = await fixture.subject.execute(
      executeInput(
        context({
          reportId: "r_log_only",
          verdict: "legitimate",
          category: null,
          scoreFinal: 0.99,
        }),
      ),
    );
    assert.deepEqual(logged, {
      reportId: "r_log_only",
      action: "log_only",
      status: "analyzing",
      finalized: true,
      alertRequired: false,
    });

    const manual = await fixture.subject.execute(
      executeInput(
        context({
          reportId: "r_manual_review",
          verdict: "suspicious",
          category: null,
          scoreFinal: 0.72,
        }),
      ),
    );
    assert.equal(manual.action, "manual_review");
    assert.equal(manual.status, "manual_review");
    assert.equal(manual.alertRequired, true);
    assert.equal(calls, 0);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("a reported result is persisted only with a confirmed transaction hash", async () => {
  const calls = [];
  const fixture = coordinator(async (action, payload) => {
    calls.push({ action, payload });
    return { status: "reported", txHash: TX_HASH };
  });

  try {
    const result = await fixture.subject.execute(executeInput(context()));
    assert.deepEqual(result, {
      reportId: "r_20260801_coordinator",
      action: "report",
      status: "reported",
      finalized: true,
      alertRequired: true,
    });
    assert.deepEqual(calls, [
      {
        action: "report",
        payload: {
          type: "url",
          value: URL,
          category: "fake_airdrop",
          score: 91,
        },
      },
    ]);
    assert.equal(fixture.lifecycleStore.read(result.reportId).txHash, TX_HASH);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("already-blacklisted reports require a follow-up check with historical tx evidence", async () => {
  const calls = [];
  const fixture = coordinator(async (action) => {
    calls.push(action);
    if (action === "report") return { status: "already_blacklisted" };
    return { blacklisted: true, txHash: EXISTING_TX_HASH };
  });

  try {
    const result = await fixture.subject.execute(
      executeInput(context({ reportId: "r_existing_chain_entry" })),
    );
    assert.equal(result.status, "already_blacklisted");
    assert.deepEqual(calls, ["report", "check"]);
    assert.equal(
      fixture.lifecycleStore.read(result.reportId).txHash,
      EXISTING_TX_HASH,
    );
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("a transient report failure rechecks before its only retry", async () => {
  const calls = [];
  let reportAttempts = 0;
  const fixture = coordinator(async (action) => {
    calls.push(action);
    if (action === "check") return { blacklisted: false };
    reportAttempts += 1;
    if (reportAttempts === 1) throw chainFailure();
    return { status: "reported", txHash: TX_HASH };
  });

  try {
    const result = await fixture.subject.execute(
      executeInput(context({ reportId: "r_retry_after_recheck" })),
    );
    assert.equal(result.status, "reported");
    assert.deepEqual(calls, ["report", "check", "report"]);
    assert.deepEqual(fixture.waits, [1_000]);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("an uncertain report completed by recheck never submits a second transaction", async () => {
  const calls = [];
  const fixture = coordinator(async (action) => {
    calls.push(action);
    if (action === "report") throw chainFailure();
    return { blacklisted: true, txHash: EXISTING_TX_HASH };
  });

  try {
    const result = await fixture.subject.execute(
      executeInput(context({ reportId: "r_uncertain_but_mined" })),
    );
    assert.equal(result.status, "already_blacklisted");
    assert.deepEqual(calls, ["report", "check"]);
    assert.deepEqual(fixture.waits, []);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("transient publication failures stop after three report attempts and rechecks", async () => {
  const calls = [];
  const fixture = coordinator(async (action) => {
    calls.push(action);
    if (action === "check") return { blacklisted: false };
    throw chainFailure();
  });

  try {
    const result = await fixture.subject.execute(
      executeInput(context({ reportId: "r_three_report_attempts" })),
    );
    assert.equal(result.status, "failed");
    assert.deepEqual(calls, [
      "report",
      "check",
      "report",
      "check",
      "report",
      "check",
    ]);
    assert.deepEqual(fixture.waits, [1_000, 2_000]);
    assert.equal(
      fixture.lifecycleStore.read(result.reportId).errorCode,
      "CHAIN_TIMEOUT",
    );
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("permanent report failure finalizes safely without raw error details", async () => {
  const fixture = coordinator(async () => {
    throw chainFailure("CHAIN_INSUFFICIENT_FUNDS");
  });

  try {
    const result = await fixture.subject.execute(
      executeInput(context({ reportId: "r_permanent_failure" })),
    );
    assert.equal(result.status, "failed");
    const lifecycle = fixture.lifecycleStore.read(result.reportId);
    assert.equal(lifecycle.errorCode, "CHAIN_INSUFFICIENT_FUNDS");
    assert.doesNotMatch(JSON.stringify(lifecycle), /provider|sensitive/i);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("a reportId is permanently bound to one exact validated context", async () => {
  const fixture = coordinator(async () => {
    throw new Error("blockchain must not be called");
  });

  try {
    const original = context({
      reportId: "r_context_binding",
      verdict: "suspicious",
      category: null,
      scoreFinal: 0.7,
    });
    await fixture.subject.execute(executeInput(original));

    await assert.rejects(
      fixture.subject.execute(
        executeInput({ ...original, value: "https://other.invalid" }),
      ),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "WF3_CONTEXT_CONFLICT" &&
        error.statusCode === 409,
    );
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("only one concurrent claim is authorized and the winner can settle", async () => {
  const fixture = coordinator(async () => {
    throw new Error("blockchain must not be called");
  });
  const manualContext = context({
    reportId: "r_claim_race",
    verdict: "suspicious",
    category: null,
    scoreFinal: 0.72,
  });

  try {
    await fixture.subject.execute(executeInput(manualContext, "execution-a"));
    await assert.rejects(
      fixture.subject.claim({
        context: manualContext,
        claimId: "execution-b",
      }),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "WF3_EXECUTION_CONFLICT" &&
        error.statusCode === 409,
    );
    const [first, second] = await Promise.all([
      fixture.subject.claim({ context: manualContext, claimId: "execution-a" }),
      fixture.subject.claim({ context: manualContext, claimId: "execution-a" }),
    ]);
    const winner = [first, second].find((result) => result.authorized);
    const loser = [first, second].find((result) => !result.authorized);

    assert.ok(winner);
    assert.ok(loser);
    assert.equal(winner.channel, "manual_review");
    assert.deepEqual(winner.discord.allowed_mentions, {
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    });
    assert.equal(loser.reason, "final_alert_already_claimed");

    const replayedClaim = await fixture.subject.claim({
      context: manualContext,
      claimId: winner.claim.claimId,
    });
    assert.deepEqual(replayedClaim, {
      authorized: false,
      reason: "final_alert_already_claimed",
      reportId: manualContext.reportId,
    });

    const settled = await fixture.subject.settle({
      reportId: manualContext.reportId,
      claim: winner.claim,
      outcome: "sent",
    });
    assert.equal(settled.alertState, "sent");

    const replay = await fixture.subject.settle({
      reportId: manualContext.reportId,
      claim: winner.claim,
      outcome: "sent",
    });
    assert.deepEqual(replay, settled);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("a duplicate execution returns the persisted terminal result without side effects", async () => {
  let calls = 0;
  const fixture = coordinator(async () => {
    calls += 1;
    return { status: "reported", txHash: TX_HASH };
  });
  const input = executeInput(context({ reportId: "r_idempotent_execute" }));

  try {
    const first = await fixture.subject.execute(input);
    const replay = await fixture.subject.execute(input);
    assert.deepEqual(replay, first);
    assert.equal(calls, 1);
  } finally {
    fixture.lifecycleStore.close();
  }
});

test("an open lifecycle is persistently owned by one n8n execution", async () => {
  const lifecycleStore = new LifecycleStore(":memory:");
  const input = context({
    reportId: "r_execution_binding",
    verdict: "suspicious",
    category: null,
    scoreFinal: 0.72,
  });
  const first = coordinator(
    async () => {
      throw new Error("blockchain must not be called");
    },
    { lifecycleStore },
  );

  try {
    const initial = await first.subject.execute(
      executeInput(input, "n8n-execution-owner"),
    );
    assert.equal(initial.finalized, true);
    assert.equal(initial.alertRequired, true);

    const afterRestart = coordinator(
      async () => {
        throw new Error("blockchain must not be called");
      },
      { lifecycleStore },
    );
    assert.deepEqual(
      await afterRestart.subject.execute(
        executeInput(input, "n8n-execution-owner"),
      ),
      initial,
    );
    await assert.rejects(
      afterRestart.subject.execute(
        executeInput(input, "n8n-different-execution"),
      ),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "WF3_EXECUTION_CONFLICT" &&
        error.statusCode === 409,
    );
  } finally {
    lifecycleStore.close();
  }
});
