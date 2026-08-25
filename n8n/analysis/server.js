#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { analyze } = require("../../ai/client/llmClient");
const { calculateUrlFeatures } = require("../../ai/features/urlFeatures");

const MAX_BODY_BYTES = 32 * 1024;

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  response.end(payload);
}

function authorized(request, secret) {
  const token = request.headers.authorization?.replace(/^Bearer /, "") || "";
  const left = Buffer.from(token);
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

function decide(result, scoreFinal) {
  if (result.verdict === "malicious" && scoreFinal >= 0.8) return { status: "reporting", decision: "reporting" };
  // RF-N9 / tableau d'integration : legitimate est toujours journalise
  // seulement, quel que soit scoreFinal.
  if (result.verdict === "legitimate") return { status: "analyzing", decision: "logged_only" };
  if (result.verdict === "suspicious" || (scoreFinal >= 0.5 && scoreFinal < 0.8)) return { status: "manual_review", decision: "manual_review" };
  return { status: "analyzing", decision: "logged_only" };
}

// La confiance du LLM mesure la certitude du verdict rendu, pas un risque de
// phishing : 98% de confiance sur "legitimate" doit contribuer ~2% de risque,
// pas 98%. `suspicious` n'a pas de sens directionnel, donc 0.5 neutre.
function llmRisk(verdict, confidence) {
  if (verdict === "malicious") return confidence;
  if (verdict === "legitimate") return 1 - confidence;
  return 0.5;
}

function createAnalysisServer({ secret, analyzeContent = analyze, scoreUrl = calculateUrlFeatures }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("BRIDGE_SHARED_SECRET invalide.");
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return sendJson(response, 200, { status: "ok" });
      if (!authorized(request, secret)) return sendJson(response, 401, { error: "unauthorized" });
      if (request.method !== "POST" || request.url !== "/analyze") return sendJson(response, 404, { error: "not_found" });
      const body = await readBody(request);
      const allowed = new Set(["url", "finalUrl", "textExcerpt", "structuralDigest"]);
      if (Object.keys(body).some((key) => !allowed.has(key)) || typeof body.url !== "string" || typeof body.textExcerpt !== "string" || typeof body.structuralDigest !== "object" || body.structuralDigest === null || body.textExcerpt.length > 20_001 || JSON.stringify(body.structuralDigest).length > 5_001) {
        return sendJson(response, 400, { error: "invalid_analysis_input" });
      }
      const [llm, features] = await Promise.all([
        analyzeContent({ url: body.url, textExcerpt: body.textExcerpt, structuralDigest: body.structuralDigest }),
        scoreUrl(body.url, body.finalUrl || body.url),
      ]);
      const scoreFinal = Number((0.7 * llmRisk(llm.verdict, llm.confidence) + 0.3 * features.score).toFixed(4));
      sendJson(response, 200, { ...llm, urlFeatures: features, scoreFinal, ...decide(llm, scoreFinal) });
    } catch (error) {
      sendJson(response, error.status || 502, { error: "analysis_failed", message: error.message });
    }
  });
}

if (require.main === module) {
  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.NVIDIA_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY ou NVIDIA_API_KEY est requise pour WF2.");
  }
  const server = createAnalysisServer({ secret: process.env.BRIDGE_SHARED_SECRET || "" });
  server.listen(Number(process.env.ANALYSIS_PORT || 8789), "0.0.0.0");
}

module.exports = { createAnalysisServer, decide, llmRisk };
