#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { createJournal } = require("./lib/journal");
const { runCheck } = require("./lib/checkRunner");
const {
  HttpError,
  validateCheckRequest,
  validateReportRecord,
  validateReportUpdate,
} = require("./lib/validation");

const MAX_BODY_BYTES = 8 * 1024;

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function tokensEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAuthorization(request, secret) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Bearer ") || !tokensEqual(header.slice(7), secret)) {
    throw new HttpError(
      401,
      "unauthorized",
      "Authentification bridge invalide.",
    );
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(
          new HttpError(413, "body_too_large", "Corps JSON trop volumineux."),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new HttpError(400, "invalid_json", "Corps JSON invalide."));
      }
    });
    request.on("error", reject);
  });
}

function createBridgeServer({ secret, check = runCheck, journal }) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error(
      "BRIDGE_SHARED_SECRET doit contenir au moins 32 caracteres.",
    );
  }
  if (!journal) throw new Error("journal est requis.");

  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      // Flux public d'activite recente pour le portail : uniquement des
      // champs deja publics (valeur defangee, verdict, score, txHash
      // on-chain). Jamais de contact rapporteur, d'erreurs internes ni
      // d'indicateurs bruts. Pas d'authentification : ces donnees sont
      // equivalentes a ce que le registre expose deja publiquement.
      if (
        request.method === "GET" &&
        request.url.startsWith("/reports/recent")
      ) {
        const publicFields = [
          "reportId",
          "createdAt",
          "updatedAt",
          "type",
          "valueDefanged",
          "status",
          "verdict",
          "scoreFinal",
          "category",
          "txHash",
        ];
        const records = journal
          .recent(10)
          .map((record) =>
            Object.fromEntries(
              publicFields
                .filter((f) => record[f] !== undefined)
                .map((f) => [f, record[f]]),
            ),
          );
        sendJson(response, 200, { records });
        return;
      }

      requireAuthorization(request, secret);

      if (request.method === "POST" && request.url === "/check") {
        const input = validateCheckRequest(await readJsonBody(request));
        const result = await check(input);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && request.url === "/reports") {
        const record = validateReportRecord(await readJsonBody(request));
        const result = await journal.append(record);
        sendJson(response, result.created ? 201 : 200, result);
        return;
      }

      const reportRoute = request.url.match(/^\/reports\/(r_[A-Za-z0-9_-]+)$/);
      if (reportRoute && request.method === "GET") {
        const record = journal.get(reportRoute[1]);
        if (!record)
          throw new HttpError(
            404,
            "report_not_found",
            "Signalement introuvable.",
          );
        sendJson(response, 200, { record });
        return;
      }

      if (reportRoute && request.method === "PATCH") {
        const patch = validateReportUpdate(await readJsonBody(request));
        const record = await journal.update(reportRoute[1], patch);
        if (!record)
          throw new HttpError(
            404,
            "report_not_found",
            "Signalement introuvable.",
          );
        sendJson(response, 200, { record });
        return;
      }

      throw new HttpError(404, "not_found", "Route introuvable.");
    } catch (error) {
      if (response.headersSent) return;
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      console.error(
        JSON.stringify({ event: "bridge_error", message: error.message }),
      );
      sendJson(response, 502, {
        error: "bridge_failure",
        message: "Lecture blockchain indisponible.",
      });
    }
  });
}

function main() {
  const secret = process.env.BRIDGE_SHARED_SECRET || "";
  const port = Number(process.env.BRIDGE_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("BRIDGE_PORT invalide.");

  const journalPath =
    process.env.REPORT_JOURNAL_PATH ||
    path.resolve(__dirname, "data/reports.jsonl");
  const server = createBridgeServer({
    secret,
    journal: createJournal(journalPath),
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "bridge_started", port }));
  });
}

if (require.main === module) main();

module.exports = {
  MAX_BODY_BYTES,
  createBridgeServer,
  readJsonBody,
  tokensEqual,
};
