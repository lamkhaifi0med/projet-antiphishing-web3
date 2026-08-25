"use strict";

// Validation manuelle de la sortie LLM contre ai/prompts/output-schema.json
// (RF-A4/RF-A5). Pas de dépendance ajoutée (ex. ajv) pour un client MVP —
// le schéma est assez petit pour une validation faite main, en gardant
// les deux fichiers synchronisés si l'un change.

const CATEGORIES = ["fake_exchange", "wallet_drainer", "fake_airdrop", "fake_support", "ponzi", "other"];
const VERDICTS = ["malicious", "suspicious", "legitimate"];
const MAX_INDICATORS = 5;
const MAX_INDICATOR_CHARS = 200;
const MAX_EXPLANATION_CHARS = 500;
const STRONG_SIGNAL_PATTERN = /typosquat|homogly|seed phrase|cl[ée] priv[ée]e|domaine (?:n['’]est pas|non) officiel|h[ée]bergement tiers.*incoh[ée]rent|faux support|airdrop conditionn[ée]|rendement garanti|autorisation (?:wallet )?dangereuse/i;

/**
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOutput(value) {
  const errors = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["la sortie n'est pas un objet JSON"] };
  }

  const allowedKeys = new Set(["verdict", "confidence", "category", "indicators", "explanation"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`propriété inattendue : ${key}`);
  }

  if (!VERDICTS.includes(value.verdict)) {
    errors.push(`verdict invalide : ${JSON.stringify(value.verdict)} (attendu : ${VERDICTS.join(", ")})`);
  }

  if (typeof value.confidence !== "number" || Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push(`confidence invalide : ${JSON.stringify(value.confidence)} (attendu : nombre entre 0 et 1)`);
  }

  // RF-A5 : category dépend du verdict.
  if (value.verdict === "malicious") {
    if (!CATEGORIES.includes(value.category)) {
      errors.push(`category invalide pour verdict=malicious : ${JSON.stringify(value.category)} (attendu : ${CATEGORIES.join(", ")})`);
    }
  } else if (value.category !== null && value.category !== undefined) {
    errors.push(`category doit être null si verdict != malicious, reçu : ${JSON.stringify(value.category)}`);
  }

  if (!Array.isArray(value.indicators)) {
    errors.push("indicators doit être un tableau");
  } else {
    if (value.indicators.length > MAX_INDICATORS) {
      errors.push(`indicators dépasse ${MAX_INDICATORS} éléments (reçu ${value.indicators.length})`);
    }
    value.indicators.forEach((item, i) => {
      if (typeof item !== "string" || item.length === 0) {
        errors.push(`indicators[${i}] doit être une chaîne non vide`);
      } else if (item.length > MAX_INDICATOR_CHARS) {
        errors.push(`indicators[${i}] dépasse ${MAX_INDICATOR_CHARS} caractères`);
      }
    });
  }

  if (typeof value.explanation !== "string") {
    errors.push("explanation doit être une chaîne");
  } else if (value.explanation.length > MAX_EXPLANATION_CHARS) {
    errors.push(`explanation dépasse ${MAX_EXPLANATION_CHARS} caractères (reçu ${value.explanation.length})`);
  }

  // Une reponse qui observe elle-meme une preuve forte mais conserve le
  // verdict suspicious contredit la regle de decision v2. RF-A4 impose une
  // nouvelle demande au modele au lieu d'accepter silencieusement ce faux
  // negatif structurel.
  if (value.verdict === "suspicious") {
    const evidenceText = [
      ...(Array.isArray(value.indicators) ? value.indicators.filter((item) => typeof item === "string") : []),
      typeof value.explanation === "string" ? value.explanation : "",
    ].join(" ");
    if (STRONG_SIGNAL_PATTERN.test(evidenceText)) {
      errors.push("verdict incoherent : une preuve forte est observee, verdict=malicious requis par la regle v2");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateOutput, CATEGORIES, VERDICTS, MAX_INDICATORS, MAX_INDICATOR_CHARS, MAX_EXPLANATION_CHARS };
