"use strict";

// Charge et assemble les prompts (ai/prompts/) en un seul message système
// + un seul message utilisateur combiné (RF-A1 + RF-A2 + RF-A3), stratégie
// par défaut documentée dans ai/prompts/README.md — un seul appel LLM par
// analyse plutôt que trois.

const fs = require("node:fs");
const path = require("node:path");

const PROMPTS_DIR = path.resolve(__dirname, "../../prompts");

function readPrompt(filename) {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf8");
}

/**
 * Garde uniquement la checklist (section "## Instruction") d'un template,
 * sans le préambule ("à utiliser avec system.md...") ni les délimiteurs de
 * données/instruction finale déjà gérés une seule fois par le message
 * combiné.
 */
function extractChecklist(markdown) {
  const match = markdown.match(/## Instruction\s*\n([\s\S]*?)\n<<</);
  if (!match) {
    throw new Error("Format de prompt inattendu : section '## Instruction' introuvable avant un délimiteur <<<.");
  }
  return match[1].trim();
}

function loadSystemPrompt() {
  return readPrompt("system.md");
}

function buildUserPrompt({ url, textExcerpt, structuralDigest }) {
  const urlChecklist = extractChecklist(readPrompt("url-analysis.md"));
  const sourceChecklist = extractChecklist(readPrompt("source-analysis.md"));
  const semanticChecklist = extractChecklist(readPrompt("semantic-analysis.md"));

  return [
    "# Analyse combinée (RF-A1 + RF-A2 + RF-A3)",
    "",
    "## Analyse d'URL",
    urlChecklist,
    "",
    "## Analyse de code source",
    sourceChecklist,
    "",
    "## Analyse sémantique",
    semanticChecklist,
    "",
    "<<<URL>>>",
    String(url ?? ""),
    "<<<END_URL>>>",
    "",
    "<<<PAGE_TEXT>>>",
    String(textExcerpt ?? ""),
    "<<<END_PAGE_TEXT>>>",
    "",
    "<<<STRUCTURAL_DIGEST>>>",
    JSON.stringify(structuralDigest ?? null),
    "<<<END_STRUCTURAL_DIGEST>>>",
    "",
    "Réponds uniquement avec l'objet JSON conforme à output-schema.json.",
  ].join("\n");
}

module.exports = { loadSystemPrompt, buildUserPrompt };
