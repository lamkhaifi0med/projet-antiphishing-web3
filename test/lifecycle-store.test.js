"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DECISIONS,
  applyDecision,
  authorizeFinalAlertDispatch,
  claimFinalAlert,
  createLifecycle,
  failLifecycle,
  startAnalysis,
} = require("../n8n/lib/wf3Lifecycle");
const {
  LifecycleStore,
  LifecycleStoreError,
} = require("../n8n/services/chain-bridge/lifecycleStore");

const REPORT_ID = "r_20260801_4f_store";
const TIMES = Object.freeze({
  queued: "2026-08-01T14:00:00.000Z",
  analyzing: "2026-08-01T14:00:01.000Z",
  decided: "2026-08-01T14:00:02.000Z",
  claimed: "2026-08-01T14:00:03.000Z",
});

function at(value) {
  return () => value;
}

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wf3-store-"));
  return {
    databasePath: path.join(directory, "lifecycle.sqlite"),
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function queuedLifecycle(reportId = REPORT_ID) {
  return createLifecycle(reportId, { now: at(TIMES.queued) });
}

function analyzingLifecycle(queued = queuedLifecycle()) {
  return startAnalysis(queued, {
    expectedRevision: queued.revision,
    now: at(TIMES.analyzing),
  });
}

function manualLifecycle(analyzing = analyzingLifecycle()) {
  return applyDecision(analyzing, DECISIONS.MANUAL_REVIEW, {
    expectedRevision: analyzing.revision,
    now: at(TIMES.decided),
  });
}

function runClaimWorker(databasePath, claimId, barrier) {
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const { LifecycleStore } = require(workerData.storeModule);
    const { claimFinalAlert } = require(workerData.lifecycleModule);
    const store = new LifecycleStore(workerData.databasePath);
    try {
      const current = store.read(workerData.reportId);
      const claim = claimFinalAlert(current, {
        expectedRevision: current.revision,
        claimId: workerData.claimId,
        now: () => workerData.claimedAt,
      });
      const barrierView = new Int32Array(workerData.barrier);
      Atomics.add(barrierView, 0, 1);
      Atomics.notify(barrierView, 0);
      while (Atomics.load(barrierView, 0) < 2) {
        const waitResult = Atomics.wait(barrierView, 0, 1, 5_000);
        if (waitResult === "timed-out" && Atomics.load(barrierView, 0) < 2) {
          throw Object.assign(new Error("Claim worker barrier timed out."), {
            code: "WORKER_BARRIER_TIMEOUT",
          });
        }
      }
      const result = store.compareAndSwap(
        workerData.reportId,
        current.revision,
        claim.lifecycle,
      );
      parentPort.postMessage({
        applied: result.applied,
        claimId: result.lifecycle.alert.claimId,
      });
    } catch (error) {
      parentPort.postMessage({ errorCode: error.code || "UNEXPECTED_ERROR" });
    } finally {
      store.close();
    }
  `;

  return new Promise((resolve, reject) => {
    let message;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        barrier,
        claimId,
        claimedAt: TIMES.claimed,
        databasePath,
        lifecycleModule: path.resolve(__dirname, "../n8n/lib/wf3Lifecycle"),
        reportId: REPORT_ID,
        storeModule: path.resolve(
          __dirname,
          "../n8n/services/chain-bridge/lifecycleStore",
        ),
      },
    });
    worker.once("message", (value) => {
      message = value;
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Claim worker exited with code ${code}.`));
      } else if (message === undefined) {
        reject(new Error("Claim worker exited without a result."));
      } else {
        resolve(message);
      }
    });
  });
}

test("persists a validated lifecycle across store restarts", () => {
  const temporary = temporaryDatabase();
  const queued = queuedLifecycle();
  let store = new LifecycleStore(temporary.databasePath);

  try {
    const created = store.create(queued);
    assert.deepEqual(created, queued);
    assert.equal(Object.isFrozen(created), true);
    assert.equal(store.healthCheck(), true);

    const analyzing = analyzingLifecycle(created);
    store.compareAndSwap(REPORT_ID, 0, analyzing);
    const manual = manualLifecycle(analyzing);
    store.compareAndSwap(REPORT_ID, 1, manual);
    const claimed = claimFinalAlert(manual, {
      expectedRevision: 2,
      claimId: "execution-before-restart",
      now: at(TIMES.claimed),
    });
    store.compareAndSwap(REPORT_ID, 2, claimed.lifecycle);
    store.close();

    store = new LifecycleStore(temporary.databasePath);
    const recovered = store.read(REPORT_ID);
    assert.deepEqual(recovered, claimed.lifecycle);
    assert.equal(authorizeFinalAlertDispatch(recovered, claimed.claim), true);
    assert.throws(
      () => store.create(queued),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "LIFECYCLE_ALREADY_EXISTS" &&
        error.statusCode === 409,
    );
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("persists one exact WF3 context binding across store restarts", () => {
  const temporary = temporaryDatabase();
  let store = new LifecycleStore(temporary.databasePath);
  const contextHash = "a".repeat(64);

  try {
    assert.deepEqual(store.bindContext(REPORT_ID, contextHash), {
      created: true,
      contextHash,
    });
    store.close();

    store = new LifecycleStore(temporary.databasePath);
    assert.deepEqual(store.bindContext(REPORT_ID, contextHash), {
      created: false,
      contextHash,
    });
    assert.throws(
      () => store.bindContext(REPORT_ID, "b".repeat(64)),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "WF3_CONTEXT_CONFLICT" &&
        error.statusCode === 409,
    );
    assert.throws(
      () => store.bindContext(REPORT_ID, "not-a-sha256"),
      (error) => error.code === "LIFECYCLE_RECORD_INVALID",
    );
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("persists one exact WF3 execution owner across store restarts", () => {
  const temporary = temporaryDatabase();
  let store = new LifecycleStore(temporary.databasePath);
  const executionId = "n8n-execution-owner";

  try {
    assert.deepEqual(store.bindExecution(REPORT_ID, executionId), {
      created: true,
      executionId,
    });
    store.close();

    store = new LifecycleStore(temporary.databasePath);
    assert.deepEqual(store.bindExecution(REPORT_ID, executionId), {
      created: false,
      executionId,
    });
    assert.throws(
      () => store.bindExecution(REPORT_ID, "n8n-different-execution"),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "WF3_EXECUTION_CONFLICT" &&
        error.statusCode === 409,
    );
    assert.throws(
      () => store.bindExecution(REPORT_ID, "unsafe execution id"),
      (error) => error.code === "LIFECYCLE_RECORD_INVALID",
    );
    store.database
      .prepare(
        "UPDATE wf3_execution_bindings SET execution_id = ? WHERE report_id = ?",
      )
      .run("tampered execution id", REPORT_ID);
    assert.throws(
      () => store.bindExecution(REPORT_ID, executionId),
      (error) => error.code === "LIFECYCLE_STORE_CORRUPT",
    );
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("CAS applies one canonical successor and treats an exact replay as idempotent", () => {
  const store = new LifecycleStore(":memory:");
  const queued = queuedLifecycle();
  const analyzing = analyzingLifecycle(queued);

  try {
    store.create(queued);
    const first = store.compareAndSwap(REPORT_ID, 0, analyzing);
    assert.equal(first.applied, true);
    assert.deepEqual(first.lifecycle, analyzing);

    const replay = store.compareAndSwap(REPORT_ID, 0, analyzing);
    assert.equal(replay.applied, false);
    assert.deepEqual(replay.lifecycle, analyzing);
    assert.equal(store.read(REPORT_ID).revision, 1);
  } finally {
    store.close();
  }
});

test("CAS rejects stale revisions, missing records, and reportId mismatches", () => {
  const store = new LifecycleStore(":memory:");
  const queued = queuedLifecycle();
  const analyzing = analyzingLifecycle(queued);
  const competing = failLifecycle(queued, "CHAIN_TIMEOUT", {
    expectedRevision: 0,
    now: at(TIMES.analyzing),
  });

  try {
    store.create(queued);
    store.compareAndSwap(REPORT_ID, 0, analyzing);

    assert.throws(
      () => store.compareAndSwap(REPORT_ID, 0, competing),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "LIFECYCLE_CONFLICT" &&
        error.statusCode === 409,
    );
    assert.throws(
      () =>
        store.compareAndSwap(
          "missing-report",
          0,
          analyzingLifecycle(queuedLifecycle("missing-report")),
        ),
      (error) => error.code === "LIFECYCLE_NOT_FOUND",
    );
    assert.throws(
      () =>
        store.compareAndSwap("different-report", 1, manualLifecycle(analyzing)),
      (error) => error.code === "LIFECYCLE_RECORD_INVALID",
    );
  } finally {
    store.close();
  }
});

test("CAS rejects a structurally valid state that skips the canonical transition", () => {
  const store = new LifecycleStore(":memory:");
  const queued = queuedLifecycle();
  const manual = manualLifecycle(analyzingLifecycle(queued));
  const skipped = {
    ...manual,
    revision: 1,
    updatedAt: TIMES.analyzing,
  };

  try {
    store.create(queued);
    assert.throws(
      () => store.compareAndSwap(REPORT_ID, 0, skipped),
      (error) => error.code === "WF3_LIFECYCLE_TRANSITION",
    );
    assert.deepEqual(store.read(REPORT_ID), queued);
  } finally {
    store.close();
  }
});

test("two simultaneous connections can persist only one final-alert claim", async () => {
  const temporary = temporaryDatabase();
  const setupStore = new LifecycleStore(temporary.databasePath);

  try {
    const queued = queuedLifecycle();
    const analyzing = analyzingLifecycle(queued);
    const manual = manualLifecycle(analyzing);
    setupStore.create(queued);
    setupStore.compareAndSwap(REPORT_ID, 0, analyzing);
    setupStore.compareAndSwap(REPORT_ID, 1, manual);
    setupStore.close();

    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const results = await Promise.all([
      runClaimWorker(temporary.databasePath, "execution-a", barrier),
      runClaimWorker(temporary.databasePath, "execution-b", barrier),
    ]);
    assert.equal(results.filter((result) => result.applied === true).length, 1);
    assert.equal(
      results.filter((result) => result.errorCode === "LIFECYCLE_CONFLICT")
        .length,
      1,
    );

    const verificationStore = new LifecycleStore(temporary.databasePath);
    const persisted = verificationStore.read(REPORT_ID);
    verificationStore.close();
    const winner = results.find((result) => result.applied === true);
    assert.equal(persisted.alert.claimId, winner.claimId);
    assert.equal(
      authorizeFinalAlertDispatch(persisted, {
        claimId: winner.claimId,
        claimRevision: persisted.revision,
      }),
      true,
    );
  } finally {
    setupStore.close();
    temporary.cleanup();
  }
});

test("rejects invalid creates and detects a tampered persisted row", () => {
  const store = new LifecycleStore(":memory:");
  const queued = queuedLifecycle();

  try {
    assert.throws(
      () => store.create(analyzingLifecycle(queued)),
      (error) => error.code === "LIFECYCLE_RECORD_INVALID",
    );
    store.create(queued);
    store.database
      .prepare("UPDATE wf3_lifecycles SET revision = 9 WHERE report_id = ?")
      .run(REPORT_ID);

    assert.throws(
      () => store.read(REPORT_ID),
      (error) =>
        error instanceof LifecycleStoreError &&
        error.code === "LIFECYCLE_STORE_CORRUPT",
    );
  } finally {
    store.close();
  }
});
