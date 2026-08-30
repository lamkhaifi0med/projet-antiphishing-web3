"use strict";
// Rejeu hors ligne (aucun appel reseau, aucun appel LLM) : recalcule les
// featureScores avec la nouvelle ponderation brand-proximity sur le run
// Gemini v2.2 gele, et mesure l'impact sur la porte de publication (>=0.80).
const path = require("node:path");
const { calculateUrlFeatures } = require("../features/urlFeatures");
const { createFrozenLookupDomainAge } = require("../dataset/lib/frozenRdap");

const results = require("./results-v2.2-gemini-endtoend.json");
const lookupDomainAge = createFrozenLookupDomainAge(
  path.join(__dirname, "../dataset/final/rdap-cache.json"),
);

function refang(displayUrl) {
  return displayUrl.replace(/^hxxp/, "http").replace(/\[\.\]/g, ".");
}
function llmRisk(verdict, confidence) {
  if (verdict === "malicious") return confidence;
  if (verdict === "legitimate") return 1 - confidence;
  return 0.5;
}

(async () => {
  let published = { old: 0, new: 0 };
  const changes = [];
  let legitAbove = 0;
  let maxLegitFinal = 0;
  for (const o of results.outcomes) {
    if (!o.attempted || !o.urlFeatures) continue;
    const url = refang(o.displayUrl);
    const features = await calculateUrlFeatures(url, url, { lookupDomainAge });
    const risk = llmRisk(o.verdict, o.confidence);
    const oldFinal = 0.7 * risk + 0.3 * o.urlFeatures.score;
    const newFinal = 0.7 * risk + 0.3 * features.score;
    const oldPub = o.verdict === "malicious" && oldFinal >= 0.8;
    const newPub = o.verdict === "malicious" && newFinal >= 0.8;
    if (oldPub) published.old += 1;
    if (newPub) published.new += 1;
    if (o.label === "legitimate") {
      maxLegitFinal = Math.max(maxLegitFinal, newFinal);
      if (newPub) {
        legitAbove += 1;
        changes.push(`FP-PUBLIE  ${o.displayUrl} final=${newFinal.toFixed(3)}`);
      }
    }
    if (oldPub !== newPub) {
      changes.push(
        `${newPub ? "GAGNE" : "PERDU"} ${o.label} ${o.displayUrl} ` +
          `${oldFinal.toFixed(3)} -> ${newFinal.toFixed(3)} brand=${features.brandDetected ?? "-"}`,
      );
    }
  }
  console.log(
    `Publications on-chain (malicious && >=0.80): ${published.old} -> ${published.new}`,
  );
  console.log(`Legit publies (doit rester 0): ${legitAbove}`);
  console.log(`Max scoreFinal legit: ${maxLegitFinal.toFixed(3)}`);
  for (const c of changes) console.log(" ", c);
})();
