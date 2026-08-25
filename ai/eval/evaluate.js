#!/usr/bin/env node
"use strict";

// Évaluation RF-A9 — périmètre minimal (précision/rappel/F1 sur la
// décision binaire malicious vs reste, par modèle et par version de
// prompt). Aucun intervalle de confiance, aucun quartile, aucune analyse
// de corrélation ici : jeu trop petit pour l'instant, réservé au rapport
// final.
//
// Lit exclusivement le cache de capture (ai/dataset/final/.cache/pages/),
// ne refetch JAMAIS (RF-A10). Vérifie l'intégrité du cache contre
// ai/dataset/final/cache-index.json avant toute mesure et refuse de
// tourner en cas de divergence.
//
// Applique la règle Approche B (ai/lib/contentQuality.js) : contenu
// inexploitable -> suspicious, sans appel LLM — même règle que
// ai/client/llmClient.js et ai/tools/capture-pages, à ne jamais dupliquer.
//
// Usage :
//   node ai/eval/evaluate.js [--limit=N] [--provider=gemini|nvidia] [--prompt-version=TAG] [--delay-ms=N]
//
// --limit=N : prend les N premières entrées de phishing.json ET les N
//             premières de legitimate.json (donc ~2N entrées traitées),
//             pour un run rapide sans consommer tout le quota.
// --provider=gemini|nvidia : force un seul fournisseur pour TOUTES les
//             analyses (pas de bascule automatique), pour produire un
//             tableau comparatif Gemini vs NVIDIA propre.
// --prompt-version=TAG : étiquette manuelle (défaut "v1"), reportée dans
//             le tableau exporté — permet de comparer plusieurs runs après
//             modification des templates dans ai/prompts/.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const { verifyIndexIntegrity } = require("../dataset/lib/cacheIndex");
const { assessContentQuality } = require("../lib/contentQuality");
const { analyze } = require("../client/llmClient");

const DATASET_DIR = path.resolve(__dirname, "../dataset/final");
const CACHE_DIR = process.env.CACHE_DIR || path.join(DATASET_DIR, ".cache", "pages");
const INDEX_PATH = path.join(DATASET_DIR, "cache-index.json");

// Statuts de capture pour lesquels un textExcerpt existe réellement.
// Les autres (dead/blocked/refused/skipped) n'ont aucun contenu : exclus
// de la mesure, jamais comptés comme un verdict "suspicious" implicite.
// Le protocole fige dans ai/dataset/README.md ne considere que status=ok
// comme mesurable. Les autres statuts sont documentes, pas predits.
const MEASURABLE_STATUSES = new Set(["ok"]);

function normalizeUrl(value) {
  // Même règle que scripts/lib/registry.js (§8.4).
  const parsed = new URL(value.trim());
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  const port = parsed.port ? `:${parsed.port}` : "";
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "/") pathname = "";
  return `${hostname}${port}${pathname}`;
}

function cacheKeyFor(normalizedUrl) {
  return crypto.createHash("sha256").update(normalizedUrl).digest("hex");
}

function loadCacheRecord(url) {
  const cachePath = path.join(CACHE_DIR, `${cacheKeyFor(normalizeUrl(url))}.json`);
  if (!fs.existsSync(cachePath)) return null;
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const [key, ...rest] = token.replace(/^--/, "").split("=");
    args[key] = rest.join("=");
  }
  return args;
}

function loadDataset(limit) {
  const phishing = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "phishing.json"), "utf8"));
  const legitimate = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "legitimate.json"), "utf8"));
  const cap = (arr) => (limit ? arr.slice(0, limit) : arr);
  return [...cap(phishing), ...cap(legitimate)];
  // historical.json volontairement exclu : hors jeu de mesure officiel
  // (ai/dataset/README.md §4).
}

function emptyMatrix() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function updateMatrix(matrix, predictedMalicious, label) {
  const positive = label === "phishing";
  if (predictedMalicious && positive) matrix.tp += 1;
  else if (predictedMalicious && !positive) matrix.fp += 1;
  else if (!predictedMalicious && positive) matrix.fn += 1;
  else matrix.tn += 1;
}

function metricsFromMatrix({ tp, fp, fn, tn }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, precision, recall, f1, n: tp + fp + fn + tn };
}

async function evaluateEntry(entry, { forceProvider }) {
  const record = loadCacheRecord(entry.url);
  if (!record) return { skip: "not_captured" };
  if (!MEASURABLE_STATUSES.has(record.status)) return { skip: record.status };

  // Règle Approche B, réappliquée ici sur le contenu réellement en cache
  // (pas seulement le statut déjà posé par capture.js) — source unique de
  // vérité partagée via ai/lib/contentQuality.js.
  const quality = assessContentQuality(record.textExcerpt);

  let verdict;
  let modelUsed;
  let result = null;
  if (quality.unusable) {
    verdict = "suspicious";
    modelUsed = "none";
  } else {
    result = await analyze(
      { url: entry.url, textExcerpt: record.textExcerpt, structuralDigest: record.structuralDigest },
      { forceProvider },
    );
    verdict = result.verdict;
    modelUsed = result.modelUsed || "none";
    if (!result.modelUsed) {
      return { skip: "provider_error", attempted: true };
    }
  }

  return {
    url: entry.url,
    label: entry.label,
    verdict,
    modelUsed,
    modelName: result?.modelName || null,
    confidence: result?.confidence ?? 0.5,
    category: result?.category ?? null,
    indicators: result?.indicators || [],
    explanation: result?.explanation || "Contenu non mesurable.",
    latencyMs: result?.latencyMs || 0,
    retries: result?.retries || 0,
    attempted: true,
    predictedMalicious: verdict === "malicious",
  };
}

function formatPercent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function buildMarkdownReport({ promptVersion, forceProvider, totalEntries, processed, skipped, overall, byModel }) {
  const lines = [];
  lines.push(`# Évaluation RF-A9 — version de prompt \`${promptVersion}\`${forceProvider ? ` — fournisseur forcé : ${forceProvider}` : ""}`);
  lines.push("");
  lines.push("Protocole : jeu final fige, au plus le meme nombre d'entrees de chaque label, captures `status=ok` uniquement, aucun refetch. Les autres statuts sont exclus avant tout appel LLM.");
  lines.push("");
  lines.push(`Entrées traitées : ${processed} / ${totalEntries}. Exclues (non mesurables) : ${JSON.stringify(skipped)}.`);
  lines.push("");
  lines.push("Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`.");
  lines.push("");
  lines.push("| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const row = (name, m) => `| ${name} | ${m.n} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${formatPercent(m.precision)} | ${formatPercent(m.recall)} | ${formatPercent(m.f1)} |`;
  lines.push(row("**Global**", metricsFromMatrix(overall)));
  for (const [model, matrix] of Object.entries(byModel)) {
    lines.push(row(model, metricsFromMatrix(matrix)));
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : null;
  const forceProvider = args.provider || null;
  const promptVersion = args["prompt-version"] || "v1";
  const delayMs = args["delay-ms"] ? Number(args["delay-ms"]) : 0;

  if (forceProvider && forceProvider !== "gemini" && forceProvider !== "nvidia") {
    console.error("--provider doit être 'gemini' ou 'nvidia'");
    process.exitCode = 1;
    return;
  }
  if (args.limit && (!Number.isInteger(limit) || limit <= 0)) {
    console.error("--limit doit être un entier positif");
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    console.error("--delay-ms doit etre un entier positif ou nul");
    process.exitCode = 1;
    return;
  }

  console.error("[evaluate] Vérification d'intégrité du cache (ai/dataset/final/cache-index.json)...");
  const mismatches = verifyIndexIntegrity(INDEX_PATH, CACHE_DIR);
  if (mismatches.length > 0) {
    console.error(`[evaluate] ${mismatches.length} divergence(s) détectée(s) — refus de tourner :`);
    for (const m of mismatches) console.error(`  - ${m.normalizedUrl} : ${m.reason}`);
    console.error("[evaluate] Voir ai/dataset/README.md §6 (procédure de sauvegarde / restauration).");
    process.exitCode = 1;
    return;
  }
  console.error("[evaluate] Intégrité du cache OK.");

  const entries = loadDataset(limit);
  console.error(`[evaluate] ${entries.length} entrées à traiter (limit=${limit ?? "aucune"}, provider=${forceProvider ?? "auto (Gemini→NVIDIA)"}, prompt-version=${promptVersion}).`);

  const overall = emptyMatrix();
  const byModel = {};
  const outcomes = [];
  const skipped = {};
  let processed = 0;

  for (const entry of entries) {
    const outcome = await evaluateEntry(entry, { forceProvider });
    if (outcome.attempted && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (outcome.skip) {
      skipped[outcome.skip] = (skipped[outcome.skip] || 0) + 1;
      console.error(`[evaluate]   ${entry.url} -> exclu (${outcome.skip})`);
      continue;
    }
    outcomes.push(outcome);
    processed += 1;
    updateMatrix(overall, outcome.predictedMalicious, outcome.label);
    byModel[outcome.modelUsed] = byModel[outcome.modelUsed] || emptyMatrix();
    updateMatrix(byModel[outcome.modelUsed], outcome.predictedMalicious, outcome.label);
    console.error(`[evaluate]   ${entry.url} -> verdict=${outcome.verdict} modèle=${outcome.modelUsed} label=${outcome.label}`);
  }

  const report = buildMarkdownReport({
    promptVersion,
    forceProvider,
    totalEntries: entries.length,
    processed,
    skipped,
    overall,
    byModel,
  });

  console.log(`\n${report}`);

  const suffix = forceProvider ? `-${forceProvider}` : "";
  const outPath = path.join(__dirname, `report-${promptVersion}${suffix}.md`);
  fs.writeFileSync(outPath, `${report}\n`);
  const resultsPath = path.join(__dirname, `results-${promptVersion}${suffix}.json`);
  fs.writeFileSync(
    resultsPath,
    `${JSON.stringify({ promptVersion, provider: forceProvider || "auto", outcomes }, null, 2)}\n`,
  );
  console.error(`\n[evaluate] Rapport écrit dans ${outPath}`);
  console.error(`[evaluate] Prédictions détaillées écrites dans ${resultsPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[evaluate] Échec :", error.message);
    process.exitCode = 1;
  });
}

module.exports = { evaluateEntry, metricsFromMatrix, updateMatrix, emptyMatrix };
