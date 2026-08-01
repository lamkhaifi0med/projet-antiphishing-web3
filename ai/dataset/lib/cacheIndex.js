"use strict";

// Index versionné du cache de pages (ai/dataset/final/cache-index.json).
//
// Décision (option C, hybride) : le cache lui-même (contenu extrait de
// vraies pages, y compris de phishing) reste HORS Git. Cet index — une
// entrée par URL avec url, normalizedUrl, status, httpStatus, fetchedAt,
// textLength et le SHA-256 du contenu — est en revanche VERSIONNÉ : il
// rend l'évaluation vérifiable (on peut prouver ce qui a été mesuré, et
// détecter toute divergence) sans publier de contenu hostile dans le
// dépôt.
//
// `verifyIndexIntegrity` doit être appelée par `ai/eval/evaluate.js`
// (Phase 2/3) **au démarrage**, avant toute évaluation : refuser de
// tourner si une divergence est détectée (fichier de cache modifié,
// supprimé, ou restauré depuis une sauvegarde différente de celle
// indexée).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Hash déterministe du contenu capturé pour une entrée. Même méthode
 * utilisée à l'écriture (capture.js) et à la vérification (evaluate.js) —
 * ne jamais dupliquer cette logique ailleurs.
 */
function computeContentHash({ textExcerpt, structuralDigest }) {
  const payload = `${textExcerpt || ""}\n${JSON.stringify(structuralDigest ?? null)}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function loadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return {};
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

/**
 * Statuts pour lesquels un contenu (textExcerpt/structuralDigest) existe
 * réellement et doit donc être vérifié par hash. Les autres statuts
 * (dead, blocked, skipped) n'ont pas de contenu à vérifier.
 */
const STATUSES_WITH_CONTENT = new Set(["ok", "challenged", "empty"]);

function upsertIndexEntry(indexPath, normalizedUrl, record, cacheKey) {
  const index = loadIndex(indexPath);
  const hasContent = STATUSES_WITH_CONTENT.has(record.status);
  index[normalizedUrl] = {
    url: record.url,
    normalizedUrl,
    cacheKey,
    status: record.status,
    httpStatus: record.httpStatus ?? null,
    fetchedAt: record.fetchedAt,
    textLength: hasContent ? record.textExcerpt.length : null,
    contentSha256: hasContent ? computeContentHash(record) : null,
  };
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  return index[normalizedUrl];
}

/**
 * Vérifie que chaque entrée indexée correspond bien au fichier de cache
 * réellement présent sur disque. Renvoie la liste des divergences (vide
 * si tout est cohérent). Ne lève pas d'exception elle-même : à
 * l'appelant (evaluate.js) de décider de refuser de tourner.
 */
function verifyIndexIntegrity(indexPath, cacheDir) {
  const index = loadIndex(indexPath);
  const mismatches = [];

  for (const [normalizedUrl, entry] of Object.entries(index)) {
    const cachePath = path.join(cacheDir, `${entry.cacheKey}.json`);

    if (!STATUSES_WITH_CONTENT.has(entry.status)) {
      continue; // rien à vérifier par hash pour dead/blocked/skipped.
    }

    if (!fs.existsSync(cachePath)) {
      mismatches.push({ normalizedUrl, reason: "fichier de cache manquant", cachePath });
      continue;
    }

    let record;
    try {
      record = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch (error) {
      mismatches.push({ normalizedUrl, reason: `cache illisible : ${error.message}`, cachePath });
      continue;
    }

    const actualHash = computeContentHash(record);
    if (actualHash !== entry.contentSha256) {
      mismatches.push({
        normalizedUrl,
        reason: "SHA-256 divergent (contenu modifié depuis l'indexation)",
        expected: entry.contentSha256,
        actual: actualHash,
      });
    }
  }

  return mismatches;
}

module.exports = { computeContentHash, loadIndex, upsertIndexEntry, verifyIndexIntegrity, STATUSES_WITH_CONTENT };
