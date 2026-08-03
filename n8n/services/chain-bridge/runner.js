"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  ERROR_POLICIES,
  getChainErrorPolicy,
} = require("../../../scripts/lib/chainErrors");
const { validateActionPayload } = require("./validation");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1_024;

const PROCESS_ERROR_POLICIES = Object.freeze({
  ...ERROR_POLICIES,
  EMPTY_OUTPUT: Object.freeze({ retryable: false }),
  INVALID_OUTPUT: Object.freeze({ retryable: false }),
  OUTPUT_LIMIT_EXCEEDED: Object.freeze({ retryable: false }),
  PROCESS_START_FAILED: Object.freeze({ retryable: false }),
});

const SCRIPT_NAMES = Object.freeze({
  check: "check.js",
  report: "report.js",
});

const COMMON_CHILD_ENVIRONMENT = [
  "AMOY_RPC_URL",
  "REGISTRY_CONTRACT_ADDRESS",
  "REGISTRY_DEPLOYMENT_BLOCK",
];

class ChainProcessError extends Error {
  constructor(code, message, { recheckRequired = false } = {}) {
    super(message);
    this.name = "ChainProcessError";
    this.code = Object.prototype.hasOwnProperty.call(
      PROCESS_ERROR_POLICIES,
      code,
    )
      ? code
      : "CHAIN_OPERATION_FAILED";
    this.statusCode = 502;
    this.retryable = PROCESS_ERROR_POLICIES[this.code].retryable;
    this.recheckRequired = this.retryable && recheckRequired;
  }
}

function buildChildEnvironment(action, sourceEnvironment = process.env) {
  const environment = {
    NODE_ENV: "production",
    SKIP_PROJECT_DOTENV: "1",
  };

  for (const name of COMMON_CHILD_ENVIRONMENT) {
    const value = sourceEnvironment[name];
    if (typeof value === "string" && value) environment[name] = value;
  }

  if (
    action === "report" &&
    typeof sourceEnvironment.REPORTER_PRIVATE_KEY === "string" &&
    sourceEnvironment.REPORTER_PRIVATE_KEY
  ) {
    environment.REPORTER_PRIVATE_KEY = sourceEnvironment.REPORTER_PRIVATE_KEY;
  }

  return environment;
}

function prepareChainAction(action, payload, sourceEnvironment = process.env) {
  const validated = validateActionPayload(action, payload);
  const scriptName = SCRIPT_NAMES[action];
  const args = [
    path.join(PROJECT_ROOT, "scripts", scriptName),
    "--type",
    validated.type,
    "--value",
    validated.value,
  ];

  if (action === "report") {
    args.push(
      "--category",
      validated.category,
      "--score",
      String(validated.score),
    );
  }

  return {
    command: process.execPath,
    args,
    options: {
      cwd: PROJECT_ROOT,
      env: buildChildEnvironment(action, sourceEnvironment),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  };
}

function stopChild(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    // The process may already have exited between the check and kill call.
  }
}

function parseSuccessfulOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ChainProcessError(
      "EMPTY_OUTPUT",
      "Blockchain process returned no JSON output.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ChainProcessError(
      "INVALID_OUTPUT",
      "Blockchain process returned invalid JSON.",
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChainProcessError(
      "INVALID_OUTPUT",
      "Blockchain process JSON output must be an object.",
    );
  }
  return parsed;
}

function parseFailedOutput(stderr, action) {
  let parsed;
  try {
    parsed = JSON.parse(stderr.trim());
  } catch {
    parsed = null;
  }

  const code = parsed?.status === "error" ? parsed.error?.code : null;
  const safeCode = Object.prototype.hasOwnProperty.call(ERROR_POLICIES, code)
    ? code
    : "CHAIN_OPERATION_FAILED";
  const { retryable } = getChainErrorPolicy(safeCode);

  return new ChainProcessError(
    safeCode,
    `Blockchain ${action} process failed.`,
    {
      recheckRequired: action === "report" && retryable,
    },
  );
}

function runChainAction(action, payload, options = {}) {
  const {
    spawnImpl = spawn,
    sourceEnvironment = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = options;
  const invocation = prepareChainAction(action, payload, sourceEnvironment);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(
        invocation.command,
        invocation.args,
        invocation.options,
      );
    } catch {
      reject(
        new ChainProcessError(
          "PROCESS_START_FAILED",
          "Blockchain process could not be started.",
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let settled = false;
    let timer;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const collect = (target, chunk) => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      totalBytes += buffer.length;
      if (totalBytes > maxOutputBytes) {
        stopChild(child);
        finish(
          new ChainProcessError(
            "OUTPUT_LIMIT_EXCEEDED",
            "Blockchain process exceeded its output limit.",
          ),
        );
        return target;
      }
      return `${target}${buffer.toString("utf8")}`;
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(stderr, chunk);
    });
    child.once("error", () => {
      finish(
        new ChainProcessError(
          "PROCESS_START_FAILED",
          "Blockchain process could not be started.",
        ),
      );
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      if (exitCode !== 0) {
        finish(parseFailedOutput(stderr, action));
        return;
      }

      try {
        finish(null, parseSuccessfulOutput(stdout));
      } catch (error) {
        finish(error);
      }
    });

    timer = setTimeout(() => {
      stopChild(child);
      finish(
        new ChainProcessError(
          "CHAIN_TIMEOUT",
          `Blockchain ${action} process timed out.`,
          {
            recheckRequired: action === "report",
          },
        ),
      );
    }, timeoutMs);
  });
}

module.exports = {
  ChainProcessError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  PROCESS_ERROR_POLICIES,
  buildChildEnvironment,
  parseFailedOutput,
  parseSuccessfulOutput,
  prepareChainAction,
  runChainAction,
};
