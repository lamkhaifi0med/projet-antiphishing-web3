"use strict";

// Règle déterministe de contenu inexploitable (Approche B, tranchée avec
// l'utilisateur) : contenu insuffisant (< 200 caractères) ou page de défi
// anti-bot détectée → toujours `suspicious` + revue manuelle (RF-N9),
// jamais de publication on-chain, sans appel au LLM.
//
// Partagée par :
//  - ai/tools/capture-pages/capture.js (classification post-capture)
//  - ai/client/llmClient.js (court-circuite l'appel LLM)
//  - à reprendre TELLE QUELLE dans ai/eval/evaluate.js et la spécification
//    WF2 — ne jamais dupliquer cette logique ailleurs.

const CHALLENGE_MARKERS = [
  "just a moment",
  "attention required",
  "enable javascript and cookies",
  "checking your browser",
];

const MIN_MEANINGFUL_TEXT_LENGTH = 200;

function looksLikeChallengePage(text) {
  const lower = (text || "").toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

function isTextTooShort(text) {
  return typeof text !== "string" || text.length < MIN_MEANINGFUL_TEXT_LENGTH;
}

/**
 * Verdict unique : le contenu est-il exploitable pour une analyse LLM ?
 * Renvoie { unusable: boolean, reason: "challenge_page" | "too_short" | null }.
 */
function assessContentQuality(textExcerpt) {
  if (looksLikeChallengePage(textExcerpt)) {
    return { unusable: true, reason: "challenge_page" };
  }
  if (isTextTooShort(textExcerpt)) {
    return { unusable: true, reason: "too_short" };
  }
  return { unusable: false, reason: null };
}

module.exports = {
  CHALLENGE_MARKERS,
  MIN_MEANINGFUL_TEXT_LENGTH,
  looksLikeChallengePage,
  isTextTooShort,
  assessContentQuality,
};
