"use strict";

// Conversion du HTML capturé en deux représentations bornées (RF-A11) :
//  - textExcerpt      : texte lisible, pour le prompt sémantique (RF-A3)
//  - structuralDigest : champs de formulaire, domaines de scripts externes
//                       et extraits correspondant à des motifs Web3, pour
//                       le prompt d'analyse de code source (RF-A2), que
//                       la conversion en texte pur effacerait entièrement.
//
// Approche par expressions régulières (pas de parseur HTML complet) :
// suffisant pour un outil prototype borné, mais moins robuste qu'un vrai
// parseur face à du HTML volontairement malformé. À durcir (vrai parseur)
// lors de la reprise en Phase 5 (RF-S8, service de fetch de WF2).

const MAX_TEXT_EXCERPT_CHARS = 20_000; // RF-A11 : taille max documentée (texte pour RF-A3)
const MAX_STRUCTURAL_DIGEST_CHARS = 5_000; // taille max documentée (digest pour RF-A2)
const MAX_FORM_FIELDS = 20;
const MAX_SCRIPT_DOMAINS = 20;
const MAX_PATTERN_SNIPPETS = 15;
const SNIPPET_CONTEXT_CHARS = 80;
const ATTR_MAX_CHARS = 100;

// Liste courte de motifs Web3 sensibles (RF-A2), volontairement fermée.
const WEB3_PATTERNS = [
  "eth_sign",
  "personal_sign",
  "eth_requestAccounts",
  "approve",
  "setApprovalForAll",
  "permit",
  "transferFrom",
  "window.ethereum",
];

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function stripTagsToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextExcerpt(html) {
  return truncate(stripTagsToText(html), MAX_TEXT_EXCERPT_CHARS);
}

function extractAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? truncate(match[1], ATTR_MAX_CHARS) : "";
}

// Plafond de sécurité pendant le scan (page pathologique avec des
// milliers de champs) — distinct de MAX_FORM_FIELDS, qui est appliqué
// ensuite par pertinence, pas par ordre d'apparition dans le HTML.
const FORM_FIELD_SCAN_SAFETY_LIMIT = 200;

function extractFormFields(html) {
  const all = [];
  const tagRegex = /<(input|textarea|select)\b[^>]*>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null && all.length < FORM_FIELD_SCAN_SAFETY_LIMIT) {
    const tag = match[0];
    all.push({
      tag: match[1].toLowerCase(),
      name: extractAttr(tag, "name"),
      type: extractAttr(tag, "type"),
      placeholder: extractAttr(tag, "placeholder"),
    });
  }
  if (all.length <= MAX_FORM_FIELDS) return all;

  // Au-delà de MAX_FORM_FIELDS : garder en priorité les champs porteurs
  // d'information (name ou placeholder), jamais tronquer aveuglément par
  // ordre d'apparition — un champ vide placé avant un champ nommé dans
  // le HTML ne doit pas lui voler sa place.
  const informative = all.filter((f) => f.name || f.placeholder);
  const empty = all.filter((f) => !f.name && !f.placeholder);
  return [...informative, ...empty].slice(0, MAX_FORM_FIELDS);
}

function extractExternalScriptDomains(html, pageHostname) {
  const domains = new Set();
  const scriptSrcRegex = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptSrcRegex.exec(html)) !== null && domains.size < MAX_SCRIPT_DOMAINS) {
    try {
      const absolute = new URL(match[1], `https://${pageHostname}/`);
      if (absolute.hostname && absolute.hostname !== pageHostname) {
        domains.add(absolute.hostname);
      }
    } catch {
      // src non résolvable (ex. data: URI) : ignoré, pas une erreur fatale.
    }
  }
  return [...domains];
}

function findAllIndices(html, pattern) {
  const indices = [];
  let fromIndex = 0;
  for (;;) {
    const idx = html.indexOf(pattern, fromIndex);
    if (idx === -1) break;
    indices.push(idx);
    fromIndex = idx + pattern.length;
  }
  return indices;
}

function snippetAt(html, idx, pattern) {
  const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(html.length, idx + pattern.length + SNIPPET_CONTEXT_CHARS);
  const context = html.slice(start, end).replace(/\s+/g, " ").trim();
  return { pattern, context: truncate(context, SNIPPET_CONTEXT_CHARS * 2 + pattern.length) };
}

function extractPatternSnippets(html) {
  const occurrences = WEB3_PATTERNS.map((pattern) => ({ pattern, indices: findAllIndices(html, pattern) })).filter(
    (entry) => entry.indices.length > 0,
  );

  // Round-robin entre les motifs distincts trouvés : un motif très répété
  // (ex. "approve" appelé 50 fois) ne doit pas épuiser le budget avant
  // qu'un autre motif présent sur la page (ex. "setApprovalForAll") n'ait
  // eu la chance d'être capturé au moins une fois.
  const snippets = [];
  let round = 0;
  let addedThisRound = true;
  while (snippets.length < MAX_PATTERN_SNIPPETS && addedThisRound) {
    addedThisRound = false;
    for (const entry of occurrences) {
      if (snippets.length >= MAX_PATTERN_SNIPPETS) break;
      if (round >= entry.indices.length) continue;
      snippets.push(snippetAt(html, entry.indices[round], entry.pattern));
      addedThisRound = true;
    }
    round += 1;
  }
  return snippets;
}

function withinBudget(digest) {
  return JSON.stringify(digest).length <= MAX_STRUCTURAL_DIGEST_CHARS;
}

/**
 * Borne la taille sérialisée du digest en réduisant les champs par ordre
 * de valeur discriminante croissante pour RF-A2 — les `web3PatternSnippets`
 * sont le signal le plus utile (formulaires de seed phrase, `approve`
 * illimité, `setApprovalForAll`...) et ne sont donc réduits qu'en tout
 * dernier recours, un raccourcissement du contexte avant une suppression
 * complète :
 *
 *   1. `externalScriptDomains` (le moins discriminant seul) — réduit en premier.
 *   2. `formFields` sans `name` ni `placeholder` (peu informatifs).
 *   3. Contexte de chaque `web3PatternSnippets` raccourci (le motif lui-même
 *      reste intact).
 *   4. `web3PatternSnippets` supprimés entièrement, un par un — dernier recours.
 *   5. `formFields` restants (avec `name`/`placeholder`) — filet de sécurité
 *      final, ne devrait pas être atteint en pratique.
 */
function buildStructuralDigest(html, pageHostname) {
  const digest = {
    formFields: extractFormFields(html),
    externalScriptDomains: extractExternalScriptDomains(html, pageHostname),
    web3PatternSnippets: extractPatternSnippets(html),
  };

  // 1. Domaines de scripts externes.
  while (!withinBudget(digest) && digest.externalScriptDomains.length > 0) {
    digest.externalScriptDomains.pop();
  }

  // 2. Champs de formulaire sans name ni placeholder.
  while (!withinBudget(digest)) {
    const idx = digest.formFields.findIndex((f) => !f.name && !f.placeholder);
    if (idx === -1) break;
    digest.formFields.splice(idx, 1);
  }

  // 3. Raccourcir le contexte des snippets (motif conservé intact).
  let contextBudget = SNIPPET_CONTEXT_CHARS;
  while (!withinBudget(digest) && contextBudget > 10) {
    contextBudget = Math.floor(contextBudget / 2);
    digest.web3PatternSnippets = digest.web3PatternSnippets.map((s) => ({
      pattern: s.pattern,
      context: truncate(s.context, contextBudget * 2 + s.pattern.length),
    }));
  }

  // 4. Suppression complète de snippets, en dernier recours seulement.
  while (!withinBudget(digest) && digest.web3PatternSnippets.length > 0) {
    digest.web3PatternSnippets.pop();
  }

  // 5. Filet de sécurité final (ne devrait pas être atteint en pratique).
  while (!withinBudget(digest) && digest.formFields.length > 0) {
    digest.formFields.pop();
  }

  return digest;
}

module.exports = {
  extractTextExcerpt,
  buildStructuralDigest,
  WEB3_PATTERNS,
  MAX_TEXT_EXCERPT_CHARS,
  MAX_STRUCTURAL_DIGEST_CHARS,
  MAX_FORM_FIELDS,
  MAX_SCRIPT_DOMAINS,
  MAX_PATTERN_SNIPPETS,
};
