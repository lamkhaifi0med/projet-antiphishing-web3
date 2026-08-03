"use strict";

const http = require("node:http");
const { randomUUID, timingSafeEqual } = require("node:crypto");
const { Wf3DiscordValidationError } = require("../../lib/wf3Discord");
const { Wf3ValidationError } = require("../../lib/wf3Decision");
const {
  Wf3LifecycleError,
  createLifecycle,
} = require("../../lib/wf3Lifecycle");
const { Wf3RetryValidationError } = require("../../lib/wf3Retry");
const { ChainProcessError, runChainAction } = require("./runner");
const {
  DEFAULT_LIFECYCLE_DATABASE_PATH,
  LifecycleStore,
  LifecycleStoreError,
} = require("./lifecycleStore");
const {
  BridgeValidationError,
  validateActionPayload,
} = require("./validation");
const { Wf3Coordinator, Wf3CoordinatorError } = require("./wf3Coordinator");

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3001;
const DEFAULT_MAX_BODY_BYTES = 16 * 1_024;
const MIN_TOKEN_LENGTH = 32;

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireBridgeToken(value) {
  if (typeof value !== "string" || value.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `CHAIN_BRIDGE_TOKEN must contain at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }
  return value;
}

function isAuthorized(request, expectedToken) {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return false;
  }

  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": payload.length,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(payload);
}

function readJsonBody(request, maxBodyBytes) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
    );
  }

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new HttpError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Invalid Content-Length.",
      );
    }
    if (declaredLength > maxBodyBytes) {
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let complete = false;

    const fail = (error) => {
      if (complete) return;
      complete = true;
      reject(error);
    };

    request.on("data", (chunk) => {
      if (complete) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBodyBytes) {
        fail(
          new HttpError(413, "BODY_TOO_LARGE", "Request body is too large."),
        );
        return;
      }
      chunks.push(buffer);
    });
    request.once("aborted", () => {
      fail(new HttpError(400, "REQUEST_ABORTED", "Request was aborted."));
    });
    request.once("error", () => {
      fail(
        new HttpError(
          400,
          "REQUEST_READ_FAILED",
          "Request body could not be read.",
        ),
      );
    });
    request.once("end", () => {
      if (complete) return;
      complete = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        reject(
          new HttpError(400, "EMPTY_BODY", "Request body must not be empty."),
        );
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(
          new HttpError(
            400,
            "INVALID_JSON",
            "Request body contains invalid JSON.",
          ),
        );
      }
    });
  });
}

function assertExactBody(body, requiredFields) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "INVALID_LIFECYCLE_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const allowed = new Set(requiredFields);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));
  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(body, field),
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw new HttpError(
      400,
      "INVALID_LIFECYCLE_REQUEST",
      "Request body must contain exactly the lifecycle route fields.",
    );
  }
}

function handleLifecycleRequest(route, body, lifecycleStore, now = Date.now) {
  if (!lifecycleStore) {
    throw new LifecycleStoreError(
      "LIFECYCLE_STORE_UNAVAILABLE",
      "Lifecycle store is unavailable.",
      503,
      { retryable: true },
    );
  }

  if (route === "create") {
    assertExactBody(body, ["reportId"]);
    const lifecycle = lifecycleStore.create(
      createLifecycle(body.reportId, { now }),
    );
    return { statusCode: 201, body: { lifecycle } };
  }
  if (route === "read") {
    assertExactBody(body, ["reportId"]);
    const lifecycle = lifecycleStore.read(body.reportId);
    if (!lifecycle) {
      throw new LifecycleStoreError(
        "LIFECYCLE_NOT_FOUND",
        "Lifecycle was not found.",
        404,
      );
    }
    return { statusCode: 200, body: { lifecycle } };
  }
  if (route === "cas") {
    assertExactBody(body, ["reportId", "expectedRevision", "lifecycle"]);
    const result = lifecycleStore.compareAndSwap(
      body.reportId,
      body.expectedRevision,
      body.lifecycle,
    );
    return { statusCode: 200, body: result };
  }

  throw new HttpError(404, "NOT_FOUND", "Route not found.");
}

function errorResponse(error) {
  if (error instanceof Wf3CoordinatorError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable === true,
          recheckRequired: false,
        },
      },
    };
  }

  if (
    error instanceof Wf3ValidationError ||
    error instanceof Wf3RetryValidationError ||
    error instanceof Wf3DiscordValidationError
  ) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          recheckRequired: false,
        },
      },
    };
  }

  if (error instanceof BridgeValidationError || error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          recheckRequired: false,
        },
      },
    };
  }

  if (error instanceof LifecycleStoreError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable === true,
          recheckRequired: error.recheckRequired === true,
        },
      },
    };
  }

  if (error instanceof Wf3LifecycleError) {
    const conflictCodes = new Set([
      "WF3_LIFECYCLE_CLAIM_MISMATCH",
      "WF3_LIFECYCLE_CONFLICT",
      "WF3_LIFECYCLE_FINALIZED",
      "WF3_LIFECYCLE_TRANSITION",
    ]);
    return {
      statusCode: conflictCodes.has(error.code) ? 409 : 400,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          recheckRequired: false,
        },
      },
    };
  }

  if (error instanceof ChainProcessError) {
    return {
      statusCode: 502,
      body: {
        error: {
          code: error.code || "CHAIN_PROCESS_FAILED",
          message: "Blockchain operation failed.",
          retryable: error.retryable === true,
          recheckRequired: error.recheckRequired === true,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal bridge error.",
        retryable: false,
        recheckRequired: false,
      },
    },
  };
}

function createBridgeServer({
  token,
  runAction = runChainAction,
  lifecycleStore = null,
  lifecycleNow = Date.now,
  wf3Coordinator = null,
  wf3Random = Math.random,
  wf3Wait,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  logger = console,
}) {
  const expectedToken = requireBridgeToken(token);
  const coordinator =
    wf3Coordinator ||
    new Wf3Coordinator({
      lifecycleStore,
      runAction,
      now: lifecycleNow,
      random: wf3Random,
      ...(wf3Wait ? { wait: wf3Wait } : {}),
    });

  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);

    try {
      const url = new URL(request.url, "http://chain-bridge.internal");

      if (request.method === "GET" && url.pathname === "/health") {
        if (lifecycleStore && !lifecycleStore.healthCheck()) {
          throw new LifecycleStoreError(
            "LIFECYCLE_STORE_UNAVAILABLE",
            "Lifecycle store is unavailable.",
            503,
            { retryable: true },
          );
        }
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (!isAuthorized(request, expectedToken)) {
        sendJson(
          response,
          401,
          {
            error: {
              code: "UNAUTHORIZED",
              message: "Unauthorized.",
              retryable: false,
              recheckRequired: false,
            },
          },
          { "www-authenticate": "Bearer" },
        );
        return;
      }

      const wf3Routes = {
        "/internal/wf3/execute": "execute",
        "/internal/wf3/claim": "claim",
        "/internal/wf3/settle": "settle",
      };
      const wf3Route = wf3Routes[url.pathname];
      if (wf3Route) {
        if (request.method !== "POST") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        }
        const body = await readJsonBody(request, maxBodyBytes);
        const result = await coordinator[wf3Route](body);
        sendJson(response, 200, result);
        return;
      }

      const lifecycleRoutes = {
        "/internal/lifecycle/create": "create",
        "/internal/lifecycle/read": "read",
        "/internal/lifecycle/cas": "cas",
      };
      const lifecycleRoute = lifecycleRoutes[url.pathname];
      if (lifecycleRoute) {
        if (request.method !== "POST") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        }
        const body = await readJsonBody(request, maxBodyBytes);
        const result = handleLifecycleRequest(
          lifecycleRoute,
          body,
          lifecycleStore,
          lifecycleNow,
        );
        sendJson(response, result.statusCode, result.body);
        return;
      }

      const routes = {
        "/internal/check": "check",
        "/internal/report": "report",
      };
      const action = routes[url.pathname];
      if (!action) {
        throw new HttpError(404, "NOT_FOUND", "Route not found.");
      }
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
      }

      const body = await readJsonBody(request, maxBodyBytes);
      const validated = validateActionPayload(action, body);
      const result = await runAction(action, validated);
      sendJson(response, 200, result);
    } catch (error) {
      const { statusCode, body } = errorResponse(error);
      if (statusCode >= 500) {
        logger.error?.("chain_bridge_request_failed", {
          requestId,
          code: error?.code || "INTERNAL_ERROR",
        });
      }
      sendJson(response, statusCode, body);
    }
  });
}

function parsePort(value) {
  const port = value === undefined ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CHAIN_BRIDGE_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

function start() {
  const token = requireBridgeToken(process.env.CHAIN_BRIDGE_TOKEN);
  const host = process.env.CHAIN_BRIDGE_HOST || DEFAULT_HOST;
  const port = parsePort(process.env.CHAIN_BRIDGE_PORT);
  const lifecycleStore = new LifecycleStore(
    process.env.WF3_LIFECYCLE_DB_PATH || DEFAULT_LIFECYCLE_DATABASE_PATH,
  );
  const server = createBridgeServer({ token, lifecycleStore });

  server.listen(port, host, () => {
    console.log(JSON.stringify({ status: "listening", host, port }));
  });

  server.once("error", () => lifecycleStore.close());
  const shutdown = () =>
    server.close(() => {
      lifecycleStore.close();
      process.exit(0);
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(JSON.stringify({ status: "error", message: error.message }));
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  HttpError,
  MIN_TOKEN_LENGTH,
  createBridgeServer,
  errorResponse,
  handleLifecycleRequest,
  isAuthorized,
  parsePort,
  readJsonBody,
  requireBridgeToken,
  sendJson,
};
