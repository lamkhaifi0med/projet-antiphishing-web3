"use strict";

// Capture one-shot du contenu des URLs du dataset final (RF-A10 : jamais
// refetché ensuite par evaluate.js). Prototype de RF-S8/RF-N5 bis, conçu
// pour tourner dans un conteneur dédié, non-root, sans réseau hôte.
//
// Usage :
//   node capture.js [--only=phishing|legitimate|historical] [--limit=N]
//
// Variables d'environnement :
//   DATASET_DIR  chemin du dossier contenant phishing.json/legitimate.json/
//                historical.json (défaut : ai/dataset/final relatif à ce
//                fichier — utile en exécution directe Node hors Docker).
//   CACHE_DIR    chemin du dossier de cache en écriture, séparé du dataset
//                (défaut : <DATASET_DIR>/.cache/pages). En conteneur,
//                DATASET_DIR est monté en lecture seule (:ro) et CACHE_DIR
//                pointe vers un volume Docker nommé distinct, monté en
//                écriture — voir README.md.
//
// Le cache lui-même (ce dossier) reste hors Git (décision « option C » —
// voir README). ai/dataset/final/cache-index.json, lui, est versionné :
// une entrée par URL avec le SHA-256 du contenu, pour que l'évaluation
// reste vérifiable sans publier de contenu hostile dans le dépôt.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { captureUrl } = require("./lib/fetcher");
const { extractTextExcerpt, buildStructuralDigest } = require("./lib/htmlToDigest");
const { SsrfBlockedError } = require("./lib/ssrfGuard");
const { upsertIndexEntry } = require("../../dataset/lib/cacheIndex");
const { assessContentQuality } = require("../../lib/contentQuality");

const DATASET_DIR = process.env.DATASET_DIR || path.resolve(__dirname, "../../dataset/final");
const CACHE_DIR = process.env.CACHE_DIR || path.join(DATASET_DIR, ".cache", "pages");
const INDEX_PATH = path.join(DATASET_DIR, "cache-index.json");

const DATASET_FILES = {
  phishing: "phishing.json",
  legitimate: "legitimate.json",
  historical: "historical.json",
};

function normalizeUrl(value) {
  // Même règle que scripts/lib/registry.js (§8.4), réutilisée ici comme clé de cache.
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

async function captureOne(entry) {
  const normalized = normalizeUrl(entry.url);
  const cacheKey = cacheKeyFor(normalized);
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (fs.existsSync(cachePath)) {
    // Servi depuis le cache (RF-A10 : jamais de refetch) — mais on
    // renvoie le VRAI statut historique (ok/dead/blocked/challenged/
    // empty/skipped), pas un statut générique "cached" qui masquerait la
    // distribution réelle dans les runs suivants.
    const record = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    upsertIndexEntry(INDEX_PATH, normalized, record, cacheKey);
    return { ...record, fromCache: true };
  }

  const record = {
    url: entry.url,
    normalizedUrl: normalized,
    fetchedAt: new Date().toISOString(),
  };

  try {
    const result = await captureUrl(entry.url);
    if (result.refused) {
      // Réponse HTTP reçue mais explicitement refusée (403/451) — jamais
      // confondu avec "dead" (échec réseau/DNS) : un géoblocage n'est pas
      // une mortalité (voir ai/dataset/README.md).
      record.status = "refused";
      record.httpStatus = result.httpStatus;
    } else if (result.skipped) {
      record.status = "skipped";
      record.httpStatus = result.httpStatus ?? null;
      record.reason = result.skipped;
    } else {
      const hostname = new URL(result.finalUrl).hostname;
      record.httpStatus = result.httpStatus;
      record.truncated = Boolean(result.truncated);
      record.finalUrl = result.finalUrl;
      record.textExcerpt = extractTextExcerpt(result.html);
      record.structuralDigest = buildStructuralDigest(result.html, hostname);

      // Classification post-capture (RF-A8 : un contenu vide ou une page
      // de défi ne doit jamais être compté comme "legitime = propre" par
      // simple absence de signal phishing) — même règle que
      // ai/client/llmClient.js (ai/lib/contentQuality.js, Approche B).
      const quality = assessContentQuality(record.textExcerpt);
      if (quality.reason === "challenge_page") {
        record.status = "challenged";
      } else if (quality.reason === "too_short") {
        record.status = "empty";
      } else {
        record.status = "ok";
      }
    }
  } catch (error) {
    // Un blocage SSRF (domaine parqué qui résout vers une IP privée, par
    // exemple) N'EST PAS une mortalité : la protection a fonctionné.
    // Comptée séparément pour ne pas fausser le taux de mortalité ni
    // masquer la preuve que RF-N5 bis fonctionne.
    record.status = error instanceof SsrfBlockedError ? "blocked" : "dead";
    record.error = error.message;
    // Code d'erreur réseau natif (ENOTFOUND, ECONNREFUSED, ECONNRESET,
    // ETIMEDOUT, TIMEOUT...) conservé pour le rapport : un domaine qui
    // n'existe plus (ENOTFOUND) et une connexion activement refusée/
    // réinitialisée (ECONNREFUSED/ECONNRESET, souvent un signe de
    // géoblocage réseau plutôt qu'un domaine mort) ne racontent pas la
    // même histoire, même s'ils sont tous les deux classés "dead" ici.
    record.errorCode = error.code || null;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(record, null, 2));
  upsertIndexEntry(INDEX_PATH, normalized, record, cacheKey);
  return record;
}

function parseArgs(argv) {
  const args = { only: null, limit: Infinity };
  for (const token of argv) {
    if (token.startsWith("--only=")) args.only = token.slice("--only=".length);
    else if (token.startsWith("--limit=")) args.limit = Number(token.slice("--limit=".length));
  }
  return args;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function printSetSummary(setName, statusCounts, textLengths) {
  console.log(`\n--- Résumé "${setName}" ---`);
  console.log("  Statuts :", statusCounts);
  console.log(`  Longueur médiane de textExcerpt (n=${textLengths.length}) : ${median(textLengths) ?? "n/a"} caractères`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const setsToRun = args.only ? [args.only] : Object.keys(DATASET_FILES);

  for (const setName of setsToRun) {
    const fileName = DATASET_FILES[setName];
    if (!fileName) {
      console.error(`Jeu inconnu : ${setName} (attendu : ${Object.keys(DATASET_FILES).join(", ")})`);
      process.exitCode = 1;
      return;
    }
    const filePath = path.join(DATASET_DIR, fileName);
    const entries = JSON.parse(fs.readFileSync(filePath, "utf8")).slice(0, args.limit);

    const statusCounts = {};
    const textLengths = [];

    console.log(`\n=== ${setName} (${entries.length} entrées) ===`);
    for (const entry of entries) {
      process.stdout.write(`  ${entry.url} ... `);
      const record = await captureOne(entry);
      const label = record.fromCache ? `${record.status} (cache)` : record.status;
      console.log(label);

      statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
      if (typeof record.textExcerpt === "string") {
        textLengths.push(record.textExcerpt.length);
      }
    }

    printSetSummary(setName, statusCounts, textLengths);
  }

  console.log(
    "\nRappel : les statuts 'dead', 'blocked', 'challenged' et 'empty' sont tous exclus du jeu de mesure officiel d'evaluate.js (Phase 2/3) — 'blocked' prouve que la protection SSRF a fonctionné, ce n'est pas une mortalité.",
  );
}

main().catch((error) => {
  console.error("Échec capture-pages :", error.message);
  process.exitCode = 1;
});
