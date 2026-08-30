#!/usr/bin/env node
"use strict";

// Évaluation RF-A9 — précision/rappel/F1 sur la décision binaire malicious
// vs reste, par modèle et par version de prompt.
//
// Lit exclusivement le cache de capture (ai/dataset/final/.cache/pages/) et
// le cache RDAP gelé (ai/dataset/final/rdap-cache.json), ne refetch JAMAIS
// une page ni n'interroge RDAP en direct (RF-A10, REVIEW_COMMIT_57747F0.md
// §5/§7). Vérifie l'intégrité du cache de capture avant toute mesure et
// refuse de tourner en cas de divergence.
//
// AI recall v2 : deux scopes d'évaluation, --scope=content-only (défaut,
// compatible avec les rapports v2 déjà publiés) ou --scope=end-to-end.
//   - content-only : seules les captures status=ok sont mesurées (texte de
//     page réellement disponible). C'est un résultat *partiel*, pas le
//     rappel demandé par le cahier des charges — voir §11 du rapport.
//   - end-to-end : toute entrée ayant un enregistrement de cache (quel que
//     soit son statut) est mesurée. Le mode d'analyse (combined /
//     url_structural / url_only, ai/lib/contentQuality.js) est choisi
//     automatiquement par ai/client/llmClient.js selon le contenu
//     réellement disponible ; le LLM est toujours appelé. Seules les
//     entrées totalement absentes du cache (jamais capturées) restent
//     exclues.
//
// Usage :
//   node ai/eval/evaluate.js [--limit=N] [--provider=gemini|nvidia] [--prompt-version=TAG] [--delay-ms=N] [--scope=content-only|end-to-end]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const { verifyIndexIntegrity } = require("../dataset/lib/cacheIndex");
const {
  createFrozenLookupDomainAge,
  loadFrozenRdapCache,
} = require("../dataset/lib/frozenRdap");
const { analyze } = require("../client/llmClient");

const DATASET_DIR = path.resolve(__dirname, "../dataset/final");
const CACHE_DIR =
  process.env.CACHE_DIR || path.join(DATASET_DIR, ".cache", "pages");
const INDEX_PATH = path.join(DATASET_DIR, "cache-index.json");
const RDAP_CACHE_PATH = path.join(DATASET_DIR, "rdap-cache.json");

// content-only : seuls les statuts de capture avec un texte de page
// réellement présent (ai/dataset/README.md, protocole figé). end-to-end
// mesure tout le reste (dead/empty/challenged/refused/skipped) via
// url_only/url_structural plutôt que de les exclure.
const CONTENT_ONLY_STATUSES = new Set(["ok"]);

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
  const cachePath = path.join(
    CACHE_DIR,
    `${cacheKeyFor(normalizeUrl(url))}.json`,
  );
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
  const phishing = JSON.parse(
    fs.readFileSync(path.join(DATASET_DIR, "phishing.json"), "utf8"),
  );
  const legitimate = JSON.parse(
    fs.readFileSync(path.join(DATASET_DIR, "legitimate.json"), "utf8"),
  );
  const cap = (arr) => (limit ? arr.slice(0, limit) : arr);
  return [...cap(phishing), ...cap(legitimate)];
  // historical.json volontairement exclu : hors jeu de mesure officiel
  // (ai/dataset/README.md §4).
}

function emptyMatrix() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function classificationOutcome(predictedMalicious, label) {
  const positive = label === "phishing";
  if (predictedMalicious && positive) return "TP";
  if (predictedMalicious && !positive) return "FP";
  if (!predictedMalicious && positive) return "FN";
  return "TN";
}

function updateMatrix(matrix, outcome) {
  matrix[outcome.toLowerCase()] += 1;
}

function metricsFromMatrix({ tp, fp, fn, tn }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  return { tp, fp, fn, tn, precision, recall, f1, n: tp + fp + fn + tn };
}

async function evaluateEntry(entry, { forceProvider, scope, lookupDomainAge }) {
  const record = loadCacheRecord(entry.url);
  if (!record) return { skip: "not_captured" };
  if (scope === "content-only" && !CONTENT_ONLY_STATUSES.has(record.status)) {
    return { skip: `excluded_by_scope:${record.status}` };
  }

  // RF-A11/RF-A6 : jamais label/category/source/notes du dataset transmis
  // au modèle — uniquement url/finalUrl/textExcerpt/structuralDigest,
  // exactement ce qu'analyze() accepte.
  const result = await analyze(
    {
      url: entry.url,
      finalUrl: record.finalUrl || entry.url,
      textExcerpt: record.textExcerpt,
      structuralDigest: record.structuralDigest,
    },
    { forceProvider, lookupDomainAge },
  );

  const verdict = result.verdict;
  const modelUsed = result.modelUsed || "none";
  if (!result.modelUsed) {
    return { skip: "provider_error", attempted: true };
  }

  const predictedMalicious = verdict === "malicious";
  return {
    url: entry.url,
    label: entry.label,
    captureStatus: record.status,
    analysisMode: result.analysisMode,
    qualityReason: result.qualityReason,
    verdict,
    modelUsed,
    modelName: result.modelName || null,
    urlFeatures: result.urlFeatures || null,
    confidence: result.confidence ?? null,
    category: result.category ?? null,
    indicators: result.indicators || [],
    explanation: result.explanation || "",
    latencyMs: result.latencyMs || 0,
    retries: result.retries || 0,
    attempted: true,
    predictedMalicious,
    classificationOutcome: classificationOutcome(
      predictedMalicious,
      entry.label,
    ),
  };
}

function formatPercent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function computeCoverage(entries, outcomes) {
  const byLabel = {
    phishing: { total: 0, measured: 0 },
    legitimate: { total: 0, measured: 0 },
  };
  for (const entry of entries) byLabel[entry.label].total += 1;
  for (const outcome of outcomes) byLabel[outcome.label].measured += 1;
  return {
    overall: { total: entries.length, measured: outcomes.length },
    phishing: byLabel.phishing,
    legitimate: byLabel.legitimate,
  };
}

function countBy(outcomes, key) {
  const counts = {};
  for (const outcome of outcomes) {
    const value = outcome[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function defangUrl(value) {
  try {
    const parsed = new URL(value);
    const protocol =
      parsed.protocol === "https:"
        ? "hxxps:"
        : parsed.protocol === "http:"
          ? "hxxp:"
          : parsed.protocol;
    const hostname = parsed.hostname.replaceAll(".", "[.]");
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${protocol}//${hostname}${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "[invalid URL omitted]";
  }
}

function defangTarget(value) {
  const text = String(value ?? "");
  return /^https?:\/\//i.test(text)
    ? defangUrl(text)
    : text.replaceAll(".", "[.]");
}

function toPersistedUrlFeatures(urlFeatures) {
  if (!urlFeatures) return null;
  const { score, tld, subdomainCount, whoisAgeDays, whoisSource, components } =
    urlFeatures;
  return {
    score,
    tld,
    subdomainCount,
    whoisAgeDays,
    whoisSource,
    components,
  };
}

function toPersistedOutcome(outcome) {
  const { url, urlFeatures, indicators, explanation, ...safeOutcome } = outcome;
  return {
    ...safeOutcome,
    displayUrl: defangUrl(url),
    urlFeatures: toPersistedUrlFeatures(urlFeatures),
    indicatorCount: Array.isArray(indicators) ? indicators.length : 0,
    explanationPresent:
      typeof explanation === "string" && explanation.length > 0,
  };
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function buildProvenance({
  limit,
  forceProvider,
  promptVersion,
  delayMs,
  scope,
  outcomes,
}) {
  const rdapCache = loadFrozenRdapCache(RDAP_CACHE_PATH);
  const observedModels = [
    ...new Set(
      outcomes
        .map((outcome) => outcome.modelName)
        .filter(
          (modelName) => typeof modelName === "string" && modelName.length > 0,
        ),
    ),
  ].sort();

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitCommit: currentGitCommit(),
    command: {
      script: "ai/eval/evaluate.js",
      limit,
      provider: forceProvider || "auto",
      promptVersion,
      delayMs,
      scope,
    },
    providerSelection: forceProvider ? "forced" : "automatic_fallback",
    observedModels,
    frozenInputs: {
      pageCache: "verified_locally_against_cache_index",
      cacheIndexSha256: sha256File(INDEX_PATH),
      cacheIndexEntries: Object.keys(
        JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")),
      ).length,
      rdapCacheSha256: sha256File(RDAP_CACHE_PATH),
      rdapCacheEntries: Object.keys(rdapCache.entries || {}).length,
      rdapFrozenAt: rdapCache.frozenAt,
      pageOrRdapRefetch: false,
    },
    outputSafety: {
      rawUrlsPersisted: false,
      rawPageContentPersisted: false,
      freeTextModelOutputPersisted: false,
      urlRepresentation: "defanged displayUrl",
      urlFeatureDomainPersisted: false,
    },
  };
}

function buildMarkdownReport({
  scope,
  promptVersion,
  forceProvider,
  totalEntries,
  processed,
  skipped,
  overall,
  byModel,
  coverage,
  byAnalysisMode,
}) {
  const lines = [];
  lines.push(
    `# Évaluation RF-A9 — version de prompt \`${promptVersion}\` — scope \`${scope}\`${forceProvider ? ` — fournisseur forcé : ${forceProvider}` : ""}`,
  );
  lines.push("");
  if (scope === "content-only") {
    lines.push(
      "**Résultat content-only** : seules les captures `status=ok` sont mesurées. Ce n'est PAS le rappel end-to-end demandé par le cahier des charges — une entrée avec une capture morte/vide/refusée n'est jamais comptée comme un échec de détection ici, elle est simplement exclue. Utiliser `--scope=end-to-end` pour la mesure demandée par le cahier des charges.",
    );
  } else {
    lines.push(
      "**Résultat end-to-end** : toute entrée ayant un enregistrement de cache est mesurée, quel que soit son statut de capture. Les entrées sans texte de page exploitable sont analysées en mode `url_structural` ou `url_only` (ai/lib/contentQuality.js) plutôt qu'exclues. Seules les entrées jamais capturées (`not_captured`) restent hors mesure.",
    );
  }
  lines.push("");
  lines.push(
    `Entrées traitées : ${processed} / ${totalEntries}. Exclues : ${JSON.stringify(skipped)}.`,
  );
  lines.push("");
  lines.push(
    `Couverture — global : ${coverage.overall.measured}/${coverage.overall.total} ; phishing : ${coverage.phishing.measured}/${coverage.phishing.total} (${formatPercent(coverage.phishing.total ? coverage.phishing.measured / coverage.phishing.total : null)}) ; légitime : ${coverage.legitimate.measured}/${coverage.legitimate.total} (${formatPercent(coverage.legitimate.total ? coverage.legitimate.measured / coverage.legitimate.total : null)}).`,
  );
  lines.push("");
  lines.push(`Modes d'analyse utilisés : ${JSON.stringify(byAnalysisMode)}.`);
  lines.push("");
  lines.push(
    "Décision binaire : `malicious` = positif prédit, `suspicious`/`legitimate` = négatif prédit. Positif réel = label `phishing`. `verdict=suspicious` n'est jamais compté comme `malicious`, même avec un score élevé.",
  );
  lines.push("");
  lines.push("| Groupe | n | TP | FP | FN | TN | Précision | Rappel | F1 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const row = (name, m) =>
    `| ${name} | ${m.n} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${formatPercent(m.precision)} | ${formatPercent(m.recall)} | ${formatPercent(m.f1)} |`;
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
  const scope = args.scope || "content-only";

  if (
    forceProvider &&
    forceProvider !== "gemini" &&
    forceProvider !== "nvidia"
  ) {
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
  if (scope !== "content-only" && scope !== "end-to-end") {
    console.error("--scope doit être 'content-only' ou 'end-to-end'");
    process.exitCode = 1;
    return;
  }

  console.error(
    "[evaluate] Vérification d'intégrité du cache (ai/dataset/final/cache-index.json)...",
  );
  const mismatches = verifyIndexIntegrity(INDEX_PATH, CACHE_DIR);
  if (mismatches.length > 0) {
    console.error(
      `[evaluate] ${mismatches.length} divergence(s) détectée(s) — refus de tourner :`,
    );
    for (const m of mismatches)
      console.error(`  - ${defangTarget(m.normalizedUrl)} : ${m.reason}`);
    console.error(
      "[evaluate] Voir ai/dataset/README.md §6 (procédure de sauvegarde / restauration).",
    );
    process.exitCode = 1;
    return;
  }
  console.error("[evaluate] Intégrité du cache OK.");

  if (!fs.existsSync(RDAP_CACHE_PATH)) {
    console.error(
      `[evaluate] Cache RDAP gelé introuvable (${RDAP_CACHE_PATH}). Générer avec : node ai/dataset/lib/buildRdapCache.js`,
    );
    process.exitCode = 1;
    return;
  }
  const lookupDomainAge = createFrozenLookupDomainAge(RDAP_CACHE_PATH);
  console.error(
    `[evaluate] Cache RDAP gelé chargé (${RDAP_CACHE_PATH}) — aucune requête RDAP en direct pendant cette évaluation.`,
  );

  const entries = loadDataset(limit);
  console.error(
    `[evaluate] ${entries.length} entrées à traiter (scope=${scope}, limit=${limit ?? "aucune"}, provider=${forceProvider ?? "auto (Gemini→NVIDIA)"}, prompt-version=${promptVersion}).`,
  );

  const overall = emptyMatrix();
  const byModel = {};
  const outcomes = [];
  const skipped = {};
  let processed = 0;

  for (const entry of entries) {
    const outcome = await evaluateEntry(entry, {
      forceProvider,
      scope,
      lookupDomainAge,
    });
    if (outcome.attempted && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (outcome.skip) {
      skipped[outcome.skip] = (skipped[outcome.skip] || 0) + 1;
      console.error(
        `[evaluate]   ${defangUrl(entry.url)} -> exclu (${outcome.skip})`,
      );
      continue;
    }
    outcomes.push(outcome);
    processed += 1;
    updateMatrix(overall, outcome.classificationOutcome);
    byModel[outcome.modelUsed] = byModel[outcome.modelUsed] || emptyMatrix();
    updateMatrix(byModel[outcome.modelUsed], outcome.classificationOutcome);
    console.error(
      `[evaluate]   ${defangUrl(entry.url)} -> verdict=${outcome.verdict} mode=${outcome.analysisMode} modèle=${outcome.modelUsed} label=${outcome.label} outcome=${outcome.classificationOutcome}`,
    );
  }

  const coverage = computeCoverage(entries, outcomes);
  const byAnalysisMode = countBy(outcomes, "analysisMode");
  const byCaptureStatus = countBy(outcomes, "captureStatus");
  const byVerdict = countBy(outcomes, "verdict");

  const report = buildMarkdownReport({
    scope,
    promptVersion,
    forceProvider,
    totalEntries: entries.length,
    processed,
    skipped,
    overall,
    byModel,
    coverage,
    byAnalysisMode,
  });

  console.log(`\n${report}`);

  const scopeSuffix = scope === "end-to-end" ? "-endtoend" : "";
  const suffix = `${forceProvider ? `-${forceProvider}` : ""}${scopeSuffix}`;
  const outPath = path.join(__dirname, `report-${promptVersion}${suffix}.md`);
  fs.writeFileSync(outPath, `${report}\n`);
  const resultsPath = path.join(
    __dirname,
    `results-${promptVersion}${suffix}.json`,
  );
  const provenance = buildProvenance({
    limit,
    forceProvider,
    promptVersion,
    delayMs,
    scope,
    outcomes,
  });
  fs.writeFileSync(
    resultsPath,
    `${JSON.stringify(
      {
        promptVersion,
        provider: forceProvider || "auto",
        scope,
        coverage,
        byAnalysisMode,
        byCaptureStatus,
        byVerdict,
        provenance,
        outcomes: outcomes.map(toPersistedOutcome),
      },
      null,
      2,
    )}\n`,
  );
  console.error(`\n[evaluate] Rapport écrit dans ${outPath}`);
  console.error(
    `[evaluate] Prédictions détaillées écrites dans ${resultsPath}`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[evaluate] Échec :", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  evaluateEntry,
  metricsFromMatrix,
  updateMatrix,
  emptyMatrix,
  classificationOutcome,
  computeCoverage,
  countBy,
  defangUrl,
  defangTarget,
  toPersistedUrlFeatures,
  toPersistedOutcome,
};
