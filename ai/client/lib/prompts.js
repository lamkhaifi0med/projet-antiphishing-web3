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
    throw new Error(
      "Format de prompt inattendu : section '## Instruction' introuvable avant un délimiteur <<<.",
    );
  }
  return match[1].trim();
}

function loadSystemPrompt() {
  return readPrompt("system.md");
}

// AI recall v2 : selon le mode d'analyse (ai/lib/contentQuality.js), la
// page n'a pas toujours de texte ou de digest exploitable. On ne ment
// jamais au modele en lui presentant un champ vide comme "verifie propre" -
// chaque bloc absent est explicitement marque indisponible avec la raison,
// pour que le modele raisonne sur ce qu'il a reellement (URL + features
// deterministes) sans halluciner un contenu de page qu'il n'a pas vu.
const MODE_NOTES = {
  combined:
    "Preuve complete disponible : URL, texte de page et digest structurel.",
  url_structural:
    "Texte de page insuffisant ou indisponible ; le digest structurel reste exploitable (motif Web3, champ de formulaire sensible ou domaine de script externe detecte). Ne pas deduire de legitimite de l'absence de texte.",
  url_only:
    "Aucune preuve de page exploitable (page de defi, contenu vide, ou echec de capture). Analyse fondee uniquement sur l'URL et les features deterministes ci-dessous. Un manque de preuve n'est PAS une preuve de legitimite : reste prudent, un score de risque URL eleve doit peser dans le verdict.",
};

function formatUrlFeatures(urlFeatures) {
  if (!urlFeatures) return "indisponible";
  const {
    score,
    domain,
    tld,
    subdomainCount,
    whoisAgeDays,
    whoisSource,
    components,
  } = urlFeatures;
  return JSON.stringify({
    score,
    domain,
    tld,
    subdomainCount,
    whoisAgeDays,
    whoisSource,
    components,
  });
}

function buildUserPrompt({
  url,
  textExcerpt,
  structuralDigest,
  urlFeatures,
  mode = "combined",
}) {
  const urlChecklist = extractChecklist(readPrompt("url-analysis.md"));
  const sourceChecklist = extractChecklist(readPrompt("source-analysis.md"));
  const semanticChecklist = extractChecklist(
    readPrompt("semantic-analysis.md"),
  );

  const hasPageText = mode === "combined";
  const hasDigest = mode === "combined" || mode === "url_structural";

  return [
    "# Analyse combinée (RF-A1 + RF-A2 + RF-A3)",
    "",
    `## Mode d'analyse : ${mode}`,
    MODE_NOTES[mode] || MODE_NOTES.url_only,
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
    "<<<URL_FEATURES>>>",
    formatUrlFeatures(urlFeatures),
    "<<<END_URL_FEATURES>>>",
    "",
    "<<<PAGE_TEXT>>>",
    hasPageText
      ? String(textExcerpt ?? "")
      : "indisponible pour ce mode d'analyse",
    "<<<END_PAGE_TEXT>>>",
    "",
    "<<<STRUCTURAL_DIGEST>>>",
    hasDigest
      ? JSON.stringify(structuralDigest ?? null)
      : "indisponible pour ce mode d'analyse",
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
