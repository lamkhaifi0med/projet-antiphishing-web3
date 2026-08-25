#!/usr/bin/env node
"use strict";

// Outil de maintenance, exécuté ponctuellement (pas au runtime de
// l'évaluation) : gèle les métadonnées RDAP (âge de domaine) du jeu final
// dans ai/dataset/final/rdap-cache.json pour une évaluation reproductible
// hors ligne (REVIEW_COMMIT_57747F0.md §5/§7 : "jamais de RDAP en direct
// pendant l'évaluation").
//
// Ceci N'EST PAS un refetch des pages phishing elles-mêmes (RF-A10, jamais
// refetché) : RDAP interroge uniquement des métadonnées d'enregistrement
// de domaine (registrar public), jamais la page hostile en elle-même.
//
// Usage :
//   node ai/dataset/lib/buildRdapCache.js

const fs = require("node:fs");
const path = require("node:path");
const { registeredDomain, lookupDomainAge } = require("../../features/urlFeatures");

const DATASET_DIR = path.resolve(__dirname, "../final");
const OUT_PATH = path.join(DATASET_DIR, "rdap-cache.json");
const DELAY_MS = 500; // ne pas marteler rdap.org

function loadEntries() {
  const phishing = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "phishing.json"), "utf8"));
  const legitimate = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "legitimate.json"), "utf8"));
  return [...phishing, ...legitimate];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const entries = loadEntries();
  const domains = new Set();
  for (const entry of entries) {
    try {
      domains.add(registeredDomain(new URL(entry.url).hostname));
    } catch {
      console.error(`[buildRdapCache] URL invalide, ignorée : ${entry.url}`);
    }
  }

  console.error(`[buildRdapCache] ${domains.size} domaines uniques à interroger (RDAP, métadonnées publiques uniquement).`);

  const frozenAt = new Date().toISOString();
  const rdapEntries = {};
  let done = 0;
  for (const domain of domains) {
    const age = await lookupDomainAge(domain);
    const createdAt = Number.isFinite(age.ageDays) ? new Date(Date.parse(frozenAt) - age.ageDays * 86_400_000).toISOString() : null;
    rdapEntries[domain] = { createdAt, source: age.source };
    done += 1;
    console.error(`[buildRdapCache] (${done}/${domains.size}) ${domain} -> ${age.source}${createdAt ? ` (créé ${createdAt})` : ""}`);
    await sleep(DELAY_MS);
  }

  const output = { frozenAt, description: "Métadonnées RDAP gelées pour le jeu final (ai/dataset/final). createdAt permet de recalculer un age reproductible avec whoisAge = (frozenAt - createdAt). Ne jamais interroger RDAP en direct pendant une évaluation (--scope=end-to-end).", entries: rdapEntries };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.error(`[buildRdapCache] Écrit dans ${OUT_PATH} (${Object.keys(rdapEntries).length} domaines, ${Object.values(rdapEntries).filter((e) => e.source === "rdap").length} résolus).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[buildRdapCache] Échec :", error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadEntries };
