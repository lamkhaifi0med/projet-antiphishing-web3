"use strict";

// Suite de tests du client LLM (assert natif Node, aucune dépendance,
// aucun réseau réel — fetch mocké). Échoue avec un code de sortie non nul
// si une assertion échoue.

const assert = require("node:assert/strict");
const { analyze } = require("./llmClient");
const { validateOutput, hasUnnegatedStrongSignal } = require("./lib/validateOutput");

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok - ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL - ${name}`);
    console.log(`         ${error.message}`);
  }
}

/**
 * Critère d'acceptation n°3 (cahier Profil B, §5) : le fallback NVIDIA se
 * déclenche automatiquement quand Gemini renvoie 429 (quota dépassé).
 * Preuve attendue : (a) la bascule a lieu, (b) la sortie reste conforme au
 * schéma, (c) le modèle réellement utilisé est journalisé comme "nvidia".
 *
 * Mock du fetch global — jamais de vraie clé ni de vrai appel réseau.
 */
async function testGeminiFallbackOn429() {
  process.env.GEMINI_API_KEY = "test-dummy-gemini-key";
  process.env.NVIDIA_API_KEY = "test-dummy-nvidia-key";
  process.env.GEMINI_MODEL_PRIMARY = process.env.GEMINI_MODEL_PRIMARY || "gemini-flash-latest";
  process.env.NVIDIA_MODEL_FALLBACK = process.env.NVIDIA_MODEL_FALLBACK || "meta/llama-3.1-8b-instruct";
  process.env.NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";

  const validOutput = {
    verdict: "malicious",
    confidence: 0.9,
    category: "wallet_drainer",
    indicators: ["Indicateur simulé pour le test de bascule NVIDIA"],
    explanation: "Réponse NVIDIA simulée pour tester la bascule automatique sur une erreur 429 de Gemini (RF-A6, critère d'acceptation n°3).",
  };

  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let nvidiaCalls = 0;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      // Simule un quota Gemini dépassé — jamais une vraie clé épuisée.
      return { ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded (mock)" } }) };
    }
    if (target.includes("integrate.api.nvidia.com") || target.includes(process.env.NVIDIA_BASE_URL)) {
      nvidiaCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(validOutput) } }] }),
      };
    }
    throw new Error(`URL inattendue dans le mock de fetch : ${target}`);
  };

  try {
    const result = await analyze({
      url: "https://mock-429-fallback-test.invalid/",
      textExcerpt: "x".repeat(250), // > 200 caractères : contenu jugé exploitable, pas de court-circuit Approche B.
      structuralDigest: { formFields: [], externalScriptDomains: [], web3PatternSnippets: [] },
    });

    assert.equal(geminiCalls, 1, "Gemini doit être appelé une fois (et échouer en 429)");
    assert.equal(nvidiaCalls, 1, "NVIDIA doit être appelé une fois, suite à la bascule");
    assert.equal(result.modelUsed, "nvidia", "(c) le modèle réellement utilisé doit être journalisé comme 'nvidia'");

    // (b) ne valider que les 5 champs cœur du schéma (output-schema.json,
    // additionalProperties:false) — pas l'objet enrichi que renvoie
    // analyze() avec ses métadonnées de bookkeeping (modelUsed, retries...),
    // qui ne relèvent pas de output-schema.json.
    const { verdict, confidence, category, indicators, explanation } = result;
    const { valid, errors } = validateOutput({ verdict, confidence, category, indicators, explanation });
    assert.ok(valid, `(b) la sortie doit rester conforme au schéma : ${errors.join(", ")}`);
    assert.equal(result.verdict, "malicious");
    assert.equal(result.manualReview, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * AI recall v2 : un contenu de page court/vide selectionne desormais le
 * mode url_only, il ne court-circuite plus l'appel LLM (c'est precisement
 * ce qui faisait perdre 25/36 URLs phishing au rappel end-to-end avant ce
 * correctif). Le modele doit etre appele meme sans texte de page.
 */
async function testShortContentStillCallsLlm() {
  process.env.GEMINI_API_KEY = "test-dummy-gemini-key";
  process.env.NVIDIA_API_KEY = "test-dummy-nvidia-key";

  const urlOnlyOutput = {
    verdict: "suspicious",
    confidence: 0.4,
    category: null,
    indicators: ["Aucune preuve de page disponible, analyse URL seule"],
    explanation: "Contenu de page indisponible ; verdict fonde uniquement sur les features URL.",
  };

  let geminiCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      geminiCalled = true;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(urlOnlyOutput) }] } }] }) };
    }
    // Le lookup RDAP des features URL passe aussi par fetch() : simuler une
    // indisponibilite propre plutot que de faire un vrai appel reseau.
    if (target.includes("rdap.org")) return { ok: false, status: 503, json: async () => ({}) };
    throw new Error(`URL inattendue dans le mock de fetch : ${target}`);
  };

  try {
    const result = await analyze({
      url: "https://mock-url-only-test.invalid/claim-airdrop",
      textExcerpt: "", // contenu vide : capture echouee ou page de defi
      structuralDigest: null,
    });
    assert.equal(geminiCalled, true, "le LLM doit etre appele meme sans contenu de page exploitable (mode url_only)");
    assert.equal(result.analysisMode, "url_only");
    assert.equal(result.verdict, "suspicious");
    assert.notEqual(result.modelUsed, null, "un contenu court ne doit plus produire modelUsed=null (ancien court-circuit force)");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * RF-N9 : un verdict suspicious valide doit porter manualReview=true, pas
 * seulement les sorties forcées après échec de validation/quality-gate.
 */
async function testSuspiciousTriggersManualReview() {
  process.env.GEMINI_API_KEY = "test-dummy-gemini-key";
  process.env.NVIDIA_API_KEY = "test-dummy-nvidia-key";

  const suspiciousOutput = {
    verdict: "suspicious",
    confidence: 0.55,
    category: null,
    indicators: ["Urgence artificielle sans autre preuve forte"],
    explanation: "Ton pressant sans preuve technique suffisante pour conclure a malicious.",
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(suspiciousOutput) }] } }] }) };
    }
    if (target.includes("rdap.org")) return { ok: false, status: 503, json: async () => ({}) };
    throw new Error(`URL inattendue dans le mock de fetch : ${target}`);
  };

  try {
    const result = await analyze({
      url: "https://mock-suspicious-manual-review-test.invalid/",
      textExcerpt: "x".repeat(250),
      structuralDigest: { formFields: [], externalScriptDomains: [], web3PatternSnippets: [] },
    });
    assert.equal(result.verdict, "suspicious");
    assert.equal(result.manualReview, true, "un verdict suspicious valide doit porter manualReview=true");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * AI recall v2 : un digest structurel exploitable (motif Web3) doit
 * selectionner url_structural, pas url_only, meme si le texte visible est
 * trop court.
 */
async function testStructuralEvidencePromotesMode() {
  process.env.GEMINI_API_KEY = "test-dummy-gemini-key";
  process.env.NVIDIA_API_KEY = "test-dummy-nvidia-key";

  const output = { verdict: "malicious", confidence: 0.85, category: "wallet_drainer", indicators: ["Motif eth_sign detecte dans un script"], explanation: "Digest structurel revele une demande de signature suspecte malgre un texte visible court." };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }) };
    }
    if (target.includes("rdap.org")) return { ok: false, status: 503, json: async () => ({}) };
    throw new Error(`URL inattendue dans le mock de fetch : ${target}`);
  };

  try {
    const result = await analyze({
      url: "https://mock-structural-evidence-test.invalid/",
      textExcerpt: "Connect wallet", // < 200 caracteres
      structuralDigest: { formFields: [], externalScriptDomains: [], web3PatternSnippets: [{ pattern: "eth_sign", context: "..." }] },
    });
    assert.equal(result.analysisMode, "url_structural");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * RF-A4/RF-A5 : le schema exige les 5 proprietes toujours presentes, meme
 * quand category vaut null pour un verdict non-malicious.
 */
function testValidateOutputRequiresCategoryKey() {
  const withoutCategoryKey = {
    verdict: "legitimate",
    confidence: 0.9,
    indicators: [],
    explanation: "Site officiel connu, aucun indicateur de phishing.",
  };
  const { valid, errors } = validateOutput(withoutCategoryKey);
  assert.equal(valid, false, "category doit etre une propriete requise meme absente pour un verdict non-malicious");
  assert.ok(errors.some((e) => e.includes("category")), `attendu une erreur mentionnant category, recu : ${errors.join(", ")}`);
}

/**
 * RF-A4 §8.3 REVIEW_COMMIT_57747F0 : une negation explicite ne doit pas
 * etre lue comme la preuve forte elle-meme.
 */
function testStrongSignalNegationHandling() {
  assert.equal(hasUnnegatedStrongSignal("No typosquatting detected, only urgency language."), false, "une negation explicite ne doit pas declencher le signal fort");
  assert.equal(hasUnnegatedStrongSignal("Aucun typosquatting observe sur ce domaine."), false, "negation en francais non plus");
  assert.equal(hasUnnegatedStrongSignal("Typosquatting confirme : blnance.com imite binance.com."), true, "une preuve forte reellement affirmee doit toujours declencher le signal");

  const { valid, errors } = validateOutput({
    verdict: "suspicious",
    confidence: 0.5,
    category: null,
    indicators: ["No typosquatting detected"],
    explanation: "Contenu ambigu, aucune preuve forte observee.",
  });
  assert.ok(valid, `une explication qui NIE une preuve forte ne doit pas etre rejetee : ${errors.join(", ")}`);
}

async function run() {
  console.log("Critère d'acceptation n°3 — fallback NVIDIA sur 429 Gemini (mock, sans réseau réel)");
  await test(
    "(a) bascule NVIDIA déclenchée, (b) sortie conforme au schéma, (c) modelUsed='nvidia' journalisé",
    testGeminiFallbackOn429,
  );
  await test("AI recall v2 : contenu court -> mode url_only, LLM quand meme appele", testShortContentStillCallsLlm);
  await test("AI recall v2 : preuve structurelle -> mode url_structural", testStructuralEvidencePromotesMode);
  await test("RF-N9 : verdict suspicious valide -> manualReview=true", testSuspiciousTriggersManualReview);
  await test("RF-A4/A5 : category est une propriete requise (meme absente, pas seulement invalide)", async () => testValidateOutputRequiresCategoryKey());
  await test("RF-A4 §8.3 : negation d'une preuve forte n'est pas la preuve elle-meme", async () => testStrongSignalNegationHandling());

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passés.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Échec inattendu de la suite de tests :", error.message);
  process.exitCode = 1;
});
