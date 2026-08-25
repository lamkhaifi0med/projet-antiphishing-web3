"use strict";

// Provider RDAP gelé (REVIEW_COMMIT_57747F0.md §5/§7) : injecté dans
// ai/features/urlFeatures.js à la place du lookup RDAP en direct pendant
// une évaluation, pour un résultat reproductible qui ne dépend ni de
// l'instant d'exécution ni de la disponibilité momentanée de rdap.org.
//
// Le cache est construit une seule fois par ai/dataset/lib/buildRdapCache.js
// et gelé avec un horodatage de référence unique (frozenAt) : whoisAge est
// toujours recalculé par rapport à CET instant, jamais Date.now().

const fs = require("node:fs");

function loadFrozenRdapCache(cachePath) {
  const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  if (typeof raw.frozenAt !== "string" || !Number.isFinite(Date.parse(raw.frozenAt))) {
    throw new Error(`Cache RDAP gelé invalide : "frozenAt" absent ou non parseable (${cachePath})`);
  }
  return raw;
}

/**
 * @param {string} cachePath - chemin vers rdap-cache.json (voir buildRdapCache.js)
 * @returns {(domain: string) => Promise<{ageDays: number|null, source: string}>}
 *   Même contrat que lookupDomainAge() dans ai/features/urlFeatures.js,
 *   injectable directement via calculateUrlFeatures(url, finalUrl, { lookupDomainAge }).
 */
function createFrozenLookupDomainAge(cachePath) {
  const cache = loadFrozenRdapCache(cachePath);
  const frozenAtMs = Date.parse(cache.frozenAt);

  return async function frozenLookupDomainAge(domain) {
    const entry = cache.entries[domain];
    if (!entry) {
      // Un domaine absent du gel ne doit JAMAIS déclencher un fallback
      // réseau silencieux : ça romprait la reproductibilité sans prévenir.
      // Reconstruire le cache (buildRdapCache.js) si le jeu de données a
      // changé depuis le dernier gel.
      return { ageDays: null, source: "not_in_frozen_cache" };
    }
    if (!entry.createdAt || entry.source !== "rdap") {
      return { ageDays: null, source: "unavailable" };
    }
    const ageDays = Math.max(0, (frozenAtMs - Date.parse(entry.createdAt)) / 86_400_000);
    return { ageDays, source: "rdap_frozen" };
  };
}

module.exports = { loadFrozenRdapCache, createFrozenLookupDomainAge };
