#!/usr/bin/env node
"use strict";

// Client LLM MVP (RF-A6). Qualifie une URL/contenu de page via Gemini
// (fallback NVIDIA NIM sur timeout/429/5xx), prompts combinés RF-A1+A2+A3,
// sortie validée contre ai/prompts/output-schema.json (RF-A4).
//
// Règle déterministe (Approche B, tranchée) : contenu inexploitable
// (< 200 caractères ou page de défi) -> "suspicious" + revue manuelle,
// JAMAIS d'appel au LLM. Même règle que ai/tools/capture-pages (ai/lib/
// contentQuality.js) — à reprendre telle quelle dans evaluate.js et WF2.
//
// Usage CLI :
//   node ai/client/llmClient.js --from-dev=<index> [--url=<url>]
//
// --from-dev=<index> charge une entrée du jeu de développement
// (ai/dataset/dev/phishing.json puis legitimate.json, concaténés, index
// 0-based) : contenu déjà présent (pageTextExcerpt/structuralDigest),
// aucun fetch réseau pour l'entrée elle-même — seul l'appel LLM est réel.
// --url, optionnel, remplace uniquement l'URL envoyée au modèle.

const fs = require("node:fs");
const path = require("node:path");
const { loadSystemPrompt, buildUserPrompt } = require("./lib/prompts");
const { validateOutput } = require("./lib/validateOutput");
const { callModelWithFallback, callGemini, callNvidia } = require("./lib/providers");
const { assessContentQuality } = require("../lib/contentQuality");

const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const MAX_RETRIES = 2; // RF-A4 : 2 retries max après le premier essai

function logAttempt(event) {
  // Diagnostic uniquement : jamais de clé API, jamais de contenu analysé
  // (RF-A6). stderr pour ne pas polluer la sortie JSON sur stdout.
  console.error(`[llmClient] ${JSON.stringify(event)}`);
}

function forcedSuspicious({ reason, indicator, explanation }) {
  return {
    verdict: "suspicious",
    confidence: 0.5,
    category: null,
    indicators: [indicator],
    explanation,
    manualReview: true,
    modelUsed: null,
    modelName: null,
    latencyMs: 0,
    retries: 0,
    reason,
  };
}

/**
 * @param {{ url: string, textExcerpt: string, structuralDigest: object }} input
 * @param {{ forceProvider?: "gemini" | "nvidia" }} [options] - force un
 *   fournisseur unique, sans bascule (utilisé par evaluate.js --provider
 *   pour produire un tableau comparatif Gemini vs NVIDIA propre, RF-A9).
 */
async function analyze({ url, textExcerpt, structuralDigest }, options = {}) {
  const { forceProvider } = options;
  if (forceProvider && forceProvider !== "gemini" && forceProvider !== "nvidia") {
    throw new Error(`forceProvider invalide : ${forceProvider} (attendu : "gemini" ou "nvidia")`);
  }
  const quality = assessContentQuality(textExcerpt);
  if (quality.unusable) {
    logAttempt({ url, skippedLlm: true, reason: quality.reason });
    return forcedSuspicious({
      reason: quality.reason,
      indicator:
        quality.reason === "challenge_page"
          ? "Page de défi anti-bot détectée (contenu inexploitable)"
          : "Contenu insuffisant pour une analyse fiable (< 200 caractères)",
      explanation:
        "Contenu inexploitable : aucun appel LLM effectué, verdict suspicious et revue manuelle appliqués par règle déterministe (RF-N9).",
    });
  }

  const systemPrompt = loadSystemPrompt();
  const userPrompt = buildUserPrompt({ url, textExcerpt, structuralDigest });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let result;
    try {
      if (forceProvider === "gemini") result = await callGemini({ systemPrompt, userPrompt });
      else if (forceProvider === "nvidia") result = await callNvidia({ systemPrompt, userPrompt });
      else result = await callModelWithFallback({ systemPrompt, userPrompt });
    } catch (error) {
      logAttempt({ attempt, ok: false, error: error.message });
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(result.rawText);
    } catch {
      logAttempt({ attempt, modelUsed: result.provider, ok: false, error: "invalid_json" });
      continue;
    }

    const { valid, errors } = validateOutput(parsed);
    if (!valid) {
      logAttempt({ attempt, modelUsed: result.provider, ok: false, error: "schema_invalid", details: errors });
      continue;
    }

    logAttempt({ attempt, modelUsed: result.provider, modelName: result.model, ok: true, latencyMs: result.latencyMs });
    return {
      ...parsed,
      manualReview: false,
      modelUsed: result.provider,
      modelName: result.model,
      latencyMs: result.latencyMs,
      retries: attempt,
      reason: null,
    };
  }

  // RF-A4 : 2 retries épuisés (3 tentatives au total) -> suspicious forcé.
  logAttempt({ ok: false, error: "retries_exhausted" });
  return forcedSuspicious({
    reason: "invalid_output_after_retries",
    indicator: "Sortie LLM invalide après 2 tentatives de correction",
    explanation: "Verdict suspicious forcé après échec de validation du schéma JSON malgré 2 retries (RF-A4).",
  });
}

// --- CLI ---

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const [key, ...rest] = token.replace(/^--/, "").split("=");
    args[key] = rest.join("=");
  }
  return args;
}

function loadDevEntry(index) {
  const devDir = path.resolve(__dirname, "../dataset/dev");
  const phishing = JSON.parse(fs.readFileSync(path.join(devDir, "phishing.json"), "utf8"));
  const legitimate = JSON.parse(fs.readFileSync(path.join(devDir, "legitimate.json"), "utf8"));
  const combined = [...phishing, ...legitimate];

  if (index < 0 || index >= combined.length) {
    throw new Error(`--from-dev=${index} hors limites (0 à ${combined.length - 1})`);
  }
  return combined[index];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args["from-dev"] === undefined) {
    console.error("Usage : node ai/client/llmClient.js --from-dev=<index> [--url=<url>]");
    process.exitCode = 1;
    return;
  }

  const index = Number(args["from-dev"]);
  if (!Number.isInteger(index)) {
    console.error("--from-dev doit être un entier");
    process.exitCode = 1;
    return;
  }

  const entry = loadDevEntry(index);
  const url = args.url || entry.url;

  console.error(`[llmClient] entrée dev #${index} : ${entry.url} (label attendu : ${entry.label})`);

  const result = await analyze({
    url,
    textExcerpt: entry.pageTextExcerpt,
    structuralDigest: entry.structuralDigest,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[llmClient] Échec :", error.message);
    process.exitCode = 1;
  });
}

module.exports = { analyze };
