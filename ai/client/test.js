"use strict";

// Suite de tests du client LLM (assert natif Node, aucune dépendance,
// aucun réseau réel — fetch mocké). Échoue avec un code de sortie non nul
// si une assertion échoue.

const assert = require("node:assert/strict");
const { analyze } = require("./llmClient");
const { validateOutput } = require("./lib/validateOutput");

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

async function run() {
  console.log("Critère d'acceptation n°3 — fallback NVIDIA sur 429 Gemini (mock, sans réseau réel)");
  await test(
    "(a) bascule NVIDIA déclenchée, (b) sortie conforme au schéma, (c) modelUsed='nvidia' journalisé",
    testGeminiFallbackOn429,
  );

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
