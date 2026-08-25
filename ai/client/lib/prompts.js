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
    "## Decision finale obligatoire",
    "1. Ne recopie jamais les familles de la checklist : conserve uniquement les indices reellement visibles dans l'URL, le texte ou le digest.",
    "2. Si tu identifies une marque imitee sur un domaine non officiel, un typosquat/homoglyphe credible, une demande de secret wallet, une autorisation dangereuse, un faux support, un faux airdrop conditionne ou un rendement garanti, verdict=malicious. Cette regle reste vraie meme si un seul de ces indices forts est present.",
    "3. Il est interdit de repondre suspicious tout en affirmant dans indicators ou explanation qu'un de ces indices forts est observe. Suspicious est reserve aux signaux faibles et ambigus sans preuve forte.",
    "4. HTTPS, un certificat valide, Vercel/Firebase/Cloudflare ou une apparence professionnelle ne prouvent jamais la legitimite.",
    "5. Avant de repondre, verifie la coherence entre verdict, indicators et explanation.",
    "",
    "Réponds uniquement avec l'objet JSON conforme à output-schema.json.",
  ].join("\n");
}

module.exports = { loadSystemPrompt, buildUserPrompt };
