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
 *
 * Utilisée par ai/tools/capture-pages/capture.js pour la classification
 * post-capture (statut ok/empty/challenged) — un concept distinct du choix
 * du mode d'analyse ci-dessous, ne pas fusionner les deux.
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

// AI recall v2 : le seuil de 200 caracteres choisit un *mode d'analyse*,
// il ne decide plus seul du verdict. Le LLM est toujours appele ; seule la
// forme de la preuve fournie change.
//
//  - combined       : texte de page exploitable (>= 200 caracteres, pas de
//                      page de defi) - preuve complete (URL + texte + digest).
//  - url_structural : texte insuffisant ou absent, mais le digest structurel
//                      contient une preuve utile independante du texte visible
//                      (motif Web3 dans un <script>, domaine de script externe,
//                      champ de formulaire nomme type seed/wallet).
//  - url_only       : aucune preuve de page utilisable (page de defi, contenu
//                      vide, ou digest sans signal exploitable). Le LLM ne
//                      reçoit alors que l'URL et les features URL deterministes.
function hasUsefulStructuralEvidence(structuralDigest) {
  if (!structuralDigest || typeof structuralDigest !== "object") return false;
  const { web3PatternSnippets, externalScriptDomains, formFields } = structuralDigest;
  if (Array.isArray(web3PatternSnippets) && web3PatternSnippets.length > 0) return true;
  if (Array.isArray(externalScriptDomains) && externalScriptDomains.length > 0) return true;
  if (Array.isArray(formFields) && formFields.some((field) => /seed|mnemonic|private.?key|wallet|passphrase/i.test(String(field?.name || field || "")))) return true;
  return false;
}

/**
 * @returns {{ mode: "combined"|"url_structural"|"url_only", qualityReason: string }}
 */
function classifyAnalysisMode(textExcerpt, structuralDigest) {
  if (looksLikeChallengePage(textExcerpt)) {
    return { mode: "url_only", qualityReason: "challenge_page" };
  }
  if (!isTextTooShort(textExcerpt)) {
    return { mode: "combined", qualityReason: "usable_text" };
  }
  if (hasUsefulStructuralEvidence(structuralDigest)) {
    return { mode: "url_structural", qualityReason: "short_text_with_structural_evidence" };
  }
  return { mode: "url_only", qualityReason: typeof textExcerpt === "string" && textExcerpt.length > 0 ? "short_text_no_structural_evidence" : "empty_content" };
}

module.exports = {
  CHALLENGE_MARKERS,
  MIN_MEANINGFUL_TEXT_LENGTH,
  looksLikeChallengePage,
  isTextTooShort,
  assessContentQuality,
  hasUsefulStructuralEvidence,
  classifyAnalysisMode,
};
