"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const {
  STATUSES,
  validateLifecycle,
  validateLifecycleReportId,
  validateLifecycleSuccessor,
} = require("../../lib/wf3Lifecycle");

const DEFAULT_LIFECYCLE_DATABASE_PATH = path.resolve(
  __dirname,
  "../../data/wf3-lifecycle.sqlite",
);
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const TABLE_NAME = "wf3_lifecycles";
const CONTEXT_TABLE_NAME = "wf3_context_bindings";
const EXECUTION_TABLE_NAME = "wf3_execution_bindings";
const CONTEXT_HASH_PATTERN = /^[0-9a-f]{64}$/;

class LifecycleStoreError extends Error {
  constructor(
    code,
    message,
    statusCode,
    { retryable = false, recheckRequired = false } = {},
  ) {
    super(message);
    this.name = "LifecycleStoreError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.recheckRequired = recheckRequired;
  }
}

function storeError(code, message, statusCode, options) {
  return new LifecycleStoreError(code, message, statusCode, options);
}

function invalidRecord() {
  return storeError(
    "LIFECYCLE_RECORD_INVALID",
    "Lifecycle record is invalid.",
    400,
  );
}

function unavailable({ recheckRequired = false } = {}) {
  return storeError(
    "LIFECYCLE_STORE_UNAVAILABLE",
    "Lifecycle store is unavailable.",
    503,
    { retryable: true, recheckRequired },
  );
}

function corruptRecord() {
  return storeError(
    "LIFECYCLE_STORE_CORRUPT",
    "Stored lifecycle record failed integrity validation.",
    500,
  );
}

function validateDatabasePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw unavailable();
  }
  return value === ":memory:" ? value : path.resolve(value);
}

function validateReportId(value) {
  try {
    return validateLifecycleReportId(value);
  } catch {
    throw invalidRecord();
  }
}

function validateRecord(value) {
  try {
    return validateLifecycle(value);
  } catch {
    throw invalidRecord();
  }
}

function validateExpectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidRecord();
  }
  return value;
}

function validateContextHash(value) {
  if (typeof value !== "string" || !CONTEXT_HASH_PATTERN.test(value)) {
    throw invalidRecord();
  }
  return value;
}

function validateExecutionId(value) {
  return validateReportId(value);
}

function serialize(record) {
  try {
    return JSON.stringify(record);
  } catch {
    throw invalidRecord();
  }
}

function hydrate(row) {
  if (!row) return null;

  if (
    typeof row.report_id !== "string" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    typeof row.record_json !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw corruptRecord();
  }

  let parsed;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    throw corruptRecord();
  }

  let lifecycle;
  try {
    lifecycle = validateLifecycle(parsed);
  } catch {
    throw corruptRecord();
  }

  if (
    lifecycle.reportId !== row.report_id ||
    lifecycle.revision !== row.revision ||
    lifecycle.createdAt !== row.created_at ||
    lifecycle.updatedAt !== row.updated_at
  ) {
    throw corruptRecord();
  }

  return lifecycle;
}

class LifecycleStore {
  constructor(
    databasePath = DEFAULT_LIFECYCLE_DATABASE_PATH,
    { busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS } = {},
  ) {
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 1) {
      throw unavailable();
    }

    this.databasePath = validateDatabasePath(databasePath);
    this.closed = false;

    if (this.databasePath !== ":memory:") {
      try {
        fs.mkdirSync(path.dirname(this.databasePath), {
          recursive: true,
          mode: 0o700,
        });
      } catch {
        throw unavailable();
      }
    }

    try {
      this.database = new DatabaseSync(this.databasePath);
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = ${busyTimeoutMs};
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          report_id TEXT PRIMARY KEY NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          record_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_wf3_lifecycles_updated_at
          ON ${TABLE_NAME} (updated_at);
        CREATE TABLE IF NOT EXISTS ${CONTEXT_TABLE_NAME} (
          report_id TEXT PRIMARY KEY NOT NULL,
          context_hash TEXT NOT NULL CHECK (length(context_hash) = 64)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS ${EXECUTION_TABLE_NAME} (
          report_id TEXT PRIMARY KEY NOT NULL,
          execution_id TEXT NOT NULL
        ) STRICT;
      `);

      this.insertStatement = this.database.prepare(`
        INSERT INTO ${TABLE_NAME} (
          report_id,
          revision,
          record_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(report_id) DO NOTHING
        RETURNING report_id, revision, record_json, created_at, updated_at
      `);
      this.selectStatement = this.database.prepare(`
        SELECT report_id, revision, record_json, created_at, updated_at
        FROM ${TABLE_NAME}
        WHERE report_id = ?
      `);
      this.updateStatement = this.database.prepare(`
        UPDATE ${TABLE_NAME}
        SET revision = ?, record_json = ?, updated_at = ?
        WHERE report_id = ? AND revision = ?
        RETURNING report_id, revision, record_json, created_at, updated_at
      `);
      this.healthStatement = this.database.prepare("SELECT 1 AS healthy");
      this.insertContextStatement = this.database.prepare(`
        INSERT INTO ${CONTEXT_TABLE_NAME} (report_id, context_hash)
        VALUES (?, ?)
        ON CONFLICT(report_id) DO NOTHING
        RETURNING report_id, context_hash
      `);
      this.selectContextStatement = this.database.prepare(`
        SELECT report_id, context_hash
        FROM ${CONTEXT_TABLE_NAME}
        WHERE report_id = ?
      `);
      this.insertExecutionStatement = this.database.prepare(`
        INSERT INTO ${EXECUTION_TABLE_NAME} (report_id, execution_id)
        VALUES (?, ?)
        ON CONFLICT(report_id) DO NOTHING
        RETURNING report_id, execution_id
      `);
      this.selectExecutionStatement = this.database.prepare(`
        SELECT report_id, execution_id
        FROM ${EXECUTION_TABLE_NAME}
        WHERE report_id = ?
      `);
    } catch {
      try {
        this.database?.close();
      } catch {
        // Preserve the safe initialization error.
      }
      throw unavailable();
    }
  }

  assertOpen() {
    if (this.closed) throw unavailable();
  }

  healthCheck() {
    this.assertOpen();
    try {
      return this.healthStatement.get()?.healthy === 1;
    } catch {
      throw unavailable();
    }
  }

  read(reportId) {
    this.assertOpen();
    const validatedReportId = validateReportId(reportId);
    let row;
    try {
      row = this.selectStatement.get(validatedReportId);
    } catch {
      throw unavailable();
    }
    return hydrate(row);
  }

  bindContext(reportId, contextHash) {
    this.assertOpen();
    const validatedReportId = validateReportId(reportId);
    const validatedContextHash = validateContextHash(contextHash);
    let inserted;
    try {
      inserted = this.insertContextStatement.get(
        validatedReportId,
        validatedContextHash,
      );
    } catch {
      throw unavailable({ recheckRequired: true });
    }

    if (inserted) {
      return Object.freeze({
        created: true,
        contextHash: validatedContextHash,
      });
    }

    let existing;
    try {
      existing = this.selectContextStatement.get(validatedReportId);
    } catch {
      throw unavailable();
    }
    if (
      !existing ||
      existing.report_id !== validatedReportId ||
      typeof existing.context_hash !== "string" ||
      !CONTEXT_HASH_PATTERN.test(existing.context_hash)
    ) {
      throw corruptRecord();
    }
    if (existing.context_hash !== validatedContextHash) {
      throw storeError(
        "WF3_CONTEXT_CONFLICT",
        "The reportId is already bound to a different WF3 context.",
        409,
      );
    }
    return Object.freeze({
      created: false,
      contextHash: existing.context_hash,
    });
  }

  bindExecution(reportId, executionId) {
    this.assertOpen();
    const validatedReportId = validateReportId(reportId);
    const validatedExecutionId = validateExecutionId(executionId);
    let inserted;
    try {
      inserted = this.insertExecutionStatement.get(
        validatedReportId,
        validatedExecutionId,
      );
    } catch {
      throw unavailable({ recheckRequired: true });
    }

    if (inserted) {
      return Object.freeze({
        created: true,
        executionId: validatedExecutionId,
      });
    }

    let existing;
    try {
      existing = this.selectExecutionStatement.get(validatedReportId);
    } catch {
      throw unavailable();
    }
    if (
      !existing ||
      existing.report_id !== validatedReportId ||
      typeof existing.execution_id !== "string"
    ) {
      throw corruptRecord();
    }
    let existingExecutionId;
    try {
      existingExecutionId = validateLifecycleReportId(existing.execution_id);
    } catch {
      throw corruptRecord();
    }
    if (existingExecutionId !== validatedExecutionId) {
      throw storeError(
        "WF3_EXECUTION_CONFLICT",
        "The reportId is already owned by a different WF3 execution.",
        409,
      );
    }
    return Object.freeze({
      created: false,
      executionId: existingExecutionId,
    });
  }

  create(record) {
    this.assertOpen();
    const lifecycle = validateRecord(record);
    if (lifecycle.revision !== 0 || lifecycle.status !== STATUSES.QUEUED) {
      throw invalidRecord();
    }

    let row;
    try {
      row = this.insertStatement.get(
        lifecycle.reportId,
        lifecycle.revision,
        serialize(lifecycle),
        lifecycle.createdAt,
        lifecycle.updatedAt,
      );
    } catch {
      throw unavailable({ recheckRequired: true });
    }

    if (!row) {
      throw storeError(
        "LIFECYCLE_ALREADY_EXISTS",
        "Lifecycle already exists.",
        409,
      );
    }

    const persisted = hydrate(row);
    if (!isDeepStrictEqual(persisted, lifecycle)) {
      throw corruptRecord();
    }
    return persisted;
  }

  compareAndSwap(reportId, expectedRevision, nextRecord) {
    this.assertOpen();
    const validatedReportId = validateReportId(reportId);
    const validatedExpectedRevision =
      validateExpectedRevision(expectedRevision);
    const lifecycle = validateRecord(nextRecord);

    if (
      lifecycle.reportId !== validatedReportId ||
      validatedExpectedRevision === Number.MAX_SAFE_INTEGER ||
      lifecycle.revision !== validatedExpectedRevision + 1
    ) {
      throw invalidRecord();
    }

    const current = this.read(validatedReportId);
    if (!current) {
      throw storeError("LIFECYCLE_NOT_FOUND", "Lifecycle was not found.", 404);
    }
    // Validate only against the revision the caller actually read. If a newer
    // revision already exists, the conditional UPDATE below cannot write; the
    // later read distinguishes an exact replay from a competing successor.
    if (current.revision === validatedExpectedRevision) {
      validateLifecycleSuccessor(current, lifecycle);
    }

    let row;
    try {
      row = this.updateStatement.get(
        lifecycle.revision,
        serialize(lifecycle),
        lifecycle.updatedAt,
        validatedReportId,
        validatedExpectedRevision,
      );
    } catch {
      throw unavailable({ recheckRequired: true });
    }

    if (row) {
      const persisted = hydrate(row);
      if (!isDeepStrictEqual(persisted, lifecycle)) {
        throw corruptRecord();
      }
      return Object.freeze({ applied: true, lifecycle: persisted });
    }

    const persisted = this.read(validatedReportId);
    if (!persisted) {
      throw storeError("LIFECYCLE_NOT_FOUND", "Lifecycle was not found.", 404);
    }
    if (
      persisted.revision === lifecycle.revision &&
      isDeepStrictEqual(persisted, lifecycle)
    ) {
      return Object.freeze({ applied: false, lifecycle: persisted });
    }

    throw storeError("LIFECYCLE_CONFLICT", "Lifecycle revision conflict.", 409);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.close();
    } catch {
      // Closing is best effort during process shutdown.
    }
  }
}

module.exports = {
  DEFAULT_BUSY_TIMEOUT_MS,
  DEFAULT_LIFECYCLE_DATABASE_PATH,
  LifecycleStore,
  LifecycleStoreError,
};
