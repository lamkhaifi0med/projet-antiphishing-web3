#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { captureUrl } = require("../../ai/tools/capture-pages/lib/fetcher");
const { extractTextExcerpt, buildStructuralDigest } = require("../../ai/tools/capture-pages/lib/htmlToDigest");

const MAX_BODY_BYTES = 4 * 1024;

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  response.end(payload);
}

function authorized(request, secret) {
  const value = request.headers.authorization?.replace(/^Bearer /, "") || "";
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return reject(Object.assign(new Error("Corps trop volumineux."), { status: 413 }));
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("JSON invalide."), { status: 400 })); }
    });
    request.on("error", reject);
  });
}

function createCaptureServer({ secret, capture = captureUrl }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("BRIDGE_SHARED_SECRET invalide.");
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return sendJson(response, 200, { status: "ok" });
      if (!authorized(request, secret)) return sendJson(response, 401, { error: "unauthorized" });
      if (request.method !== "POST" || request.url !== "/capture") return sendJson(response, 404, { error: "not_found" });
      const body = await readBody(request);
      if (Object.keys(body).some((key) => key !== "url") || typeof body.url !== "string" || body.url.length > 2048) {
        return sendJson(response, 400, { error: "invalid_url" });
      }
      const parsed = new URL(body.url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return sendJson(response, 400, { error: "invalid_url" });
      const result = await capture(body.url);
      if (!result.html) return sendJson(response, 422, { error: "unusable_response", details: result });
      sendJson(response, 200, {
        finalUrl: result.finalUrl || body.url,
        httpStatus: result.httpStatus,
        truncated: Boolean(result.truncated),
        textExcerpt: extractTextExcerpt(result.html),
        structuralDigest: buildStructuralDigest(result.html, new URL(result.finalUrl || body.url).hostname),
      });
    } catch (error) {
      const clientError = ["SSRF_BLOCKED", "UNSUPPORTED_PROTOCOL", "ENOTFOUND"].includes(error.code);
      sendJson(response, error.status || (clientError ? 422 : 502), { error: clientError ? "capture_blocked" : "capture_failed", message: error.message });
    }
  });
}

if (require.main === module) {
  const server = createCaptureServer({ secret: process.env.BRIDGE_SHARED_SECRET || "" });
  server.listen(Number(process.env.CAPTURE_PORT || 8788), "0.0.0.0");
}

module.exports = { createCaptureServer };
