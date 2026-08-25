#!/usr/bin/env node
"use strict";

// Client LLM (RF-A6, AI recall v2). Qualifie une URL/contenu de page via
// Gemini (fallback NVIDIA NIM sur timeout/429/5xx), prompts combinés
// RF-A1+A2+A3, sortie validée contre ai/prompts/output-schema.json (RF-A4).
//
// AI recall v2 : le seuil de 200 caracteres (ai/lib/contentQuality.js)
// selectionne un *mode d'analyse* (combined / url_structural / url_only),
// il ne force plus jamais suspicious sans appel LLM. Les features URL
// deterministes (ai/features/urlFeatures.js) sont calculees avant la
// construction du prompt et transmises dans les trois modes.
//
// Usage CLI :
//   node ai/client/llmClient.js --from-dev=<index> [--url=<url>]
//
// --from-dev=<index> charge une entrée du jeu de développement
// (ai/dataset/dev/phishing.json puis legitimate.json, concaténés, index
// 0-based) : contenu déjà présent (pageTextExcerpt/structuralDigest),
// aucun fetch réseau pour l'entrée elle-même — seul l'appel LLM (et le
// lookup RDAP des features URL) est réel.
// --url, optionnel, remplace uniquement l'URL envoyée au modèle.

const fs = require("node:fs");
const path = require("node:path");
const { loadSystemPrompt, buildUserPrompt } = require("./lib/prompts");
const { validateOutput } = require("./lib/validateOutput");
const { callModelWithFallback, callGemini, callNvidia } = require("./lib/providers");
const { classifyAnalysisMode } = require("../lib/contentQuality");
const { calculateUrlFeatures } = require("../features/urlFeatures");

const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const MAX_RETRIES = 2; // RF-A4 : 2 retries max après le premier essai

function logAttempt(event) {
  // Diagnostic uniquement : jamais de clé API, jamais de contenu analysé
  // (RF-A6). stderr pour ne pas polluer la sortie JSON sur stdout.
  console.error(`[llmClient] ${JSON.stringify(event)}`);
}

function forcedSuspicious({ reason, analysisMode, qualityReason, indicator, explanation }) {
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
    analysisMode,
    qualityReason,
  };
}

/**
 * @param {{ url: string, finalUrl?: string, textExcerpt: string, structuralDigest: object }} input
 *   finalUrl, optionnel, est l'URL apres redirections (pour le calcul des
 *   features URL) ; par defaut identique a url.
 * @param {{ forceProvider?: "gemini" | "nvidia", lookupDomainAge?: Function }} [options] -
 *   forceProvider force un fournisseur unique, sans bascule (utilisé par
 *   evaluate.js --provider). lookupDomainAge, optionnel, remplace le lookup
 *   RDAP en direct par un provider injecté (evaluate.js --scope=end-to-end
 *   l'utilise pour lire un cache RDAP gelé plutôt que d'interroger le
 *   réseau à chaque évaluation, RF-A10).
 */
async function analyze({ url, finalUrl, textExcerpt, structuralDigest }, options = {}) {
  const { forceProvider, lookupDomainAge } = options;
  if (forceProvider && forceProvider !== "gemini" && forceProvider !== "nvidia") {
    throw new Error(`forceProvider invalide : ${forceProvider} (attendu : "gemini" ou "nvidia")`);
  }

  const { mode, qualityReason } = classifyAnalysisMode(textExcerpt, structuralDigest);

  let urlFeatures = null;
  try {
    urlFeatures = await calculateUrlFeatures(url, finalUrl || url, lookupDomainAge ? { lookupDomainAge } : {});
  } catch (error) {
    // Une URL malformee ne doit jamais faire echouer toute l'analyse : le
    // modele continue avec des features URL absentes plutot que de planter.
    logAttempt({ url, ok: false, error: `url_features_failed: ${error.message}` });
  }

  logAttempt({ url, analysisMode: mode, qualityReason });

  const systemPrompt = loadSystemPrompt();
  const userPrompt = buildUserPrompt({
    url,
    textExcerpt: mode === "combined" ? textExcerpt : undefined,
    structuralDigest: mode !== "url_only" ? structuralDigest : undefined,
    urlFeatures,
    mode,
  });
  let correctivePrompt = userPrompt;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let result;
    try {
      if (forceProvider === "gemini") result = await callGemini({ systemPrompt, userPrompt: correctivePrompt });
      else if (forceProvider === "nvidia") result = await callNvidia({ systemPrompt, userPrompt: correctivePrompt });
      else result = await callModelWithFallback({ systemPrompt, userPrompt: correctivePrompt });
    } catch (error) {
      logAttempt({ attempt, ok: false, error: error.message });
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(result.rawText);
    } catch {
      logAttempt({ attempt, modelUsed: result.provider, ok: false, error: "invalid_json" });
      correctivePrompt = `${userPrompt}\n\nCORRECTION OBLIGATOIRE : la sortie precedente n'etait pas un objet JSON valide. Reponds a nouveau avec uniquement l'objet conforme.`;
      continue;
    }

    const { valid, errors } = validateOutput(parsed);
    if (!valid) {
      logAttempt({ attempt, modelUsed: result.provider, ok: false, error: "schema_invalid", details: errors });
      correctivePrompt = `${userPrompt}\n\nCORRECTION OBLIGATOIRE : la sortie precedente a ete rejetee pour ces raisons : ${errors.join(" ; ")}. Corrige ces erreurs et reponds uniquement avec l'objet JSON conforme.`;
      continue;
    }

    logAttempt({ attempt, modelUsed: result.provider, modelName: result.model, ok: true, latencyMs: result.latencyMs });
    return {
      ...parsed,
      // RF-N9 : un verdict suspicious exige toujours une revue manuelle,
      // meme quand la sortie LLM elle-meme est valide.
      manualReview: parsed.verdict === "suspicious",
      modelUsed: result.provider,
      modelName: result.model,
      latencyMs: result.latencyMs,
      retries: attempt,
      reason: null,
      analysisMode: mode,
      qualityReason,
      urlFeatures,
    };
  }

  // RF-A4 : 2 retries épuisés (3 tentatives au total) -> suspicious forcé.
  // C'est un echec fournisseur/schema, pas un manque de contenu de page :
  // analysisMode/qualityReason restent ceux calcules plus haut pour audit.
  logAttempt({ ok: false, error: "retries_exhausted" });
  return forcedSuspicious({
    reason: "invalid_output_after_retries",
    analysisMode: mode,
    qualityReason,
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
