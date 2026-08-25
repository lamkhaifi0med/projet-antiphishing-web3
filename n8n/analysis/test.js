#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { domainToASCII } = require("node:url");
const { calculateUrlFeatures, registeredDomain, scoreAge, hasHomoglyphEvidence } = require("../../ai/features/urlFeatures");
const { createAnalysisServer, decide, llmRisk } = require("./server");

const SECRET = "test-secret-32-characters-minimum-value";

async function main() {
  assert.equal(registeredDomain("a.b.example.co.uk"), "example.co.uk");
  // REVIEW_COMMIT_57747F0.md §7 : co.in n'etait pas dans la petite liste
  // codee en dur, "login.example.co.in" se reduisait a "co.in".
  assert.equal(registeredDomain("login.example.co.in"), "example.co.in", "co.in doit etre traite comme un suffixe a deux niveaux via la vraie Public Suffix List");
  // Hebergement generique (suffixe prive de la PSL) : la partie que
  // l'attaquant controle librement est le domaine pertinent, pas
  // "vercel.app" partage par tout le monde.
  assert.equal(registeredDomain("phishing-site.vercel.app"), "phishing-site.vercel.app", "un hebergement generique (suffixe prive PSL) doit etre traite comme son propre domaine enregistrable");
  // IP litterale : ne doit plus etre depecee comme des labels de domaine.
  assert.equal(registeredDomain("192.0.2.10"), "192.0.2.10");

  assert.equal(scoreAge(7), 1);
  assert.equal(scoreAge(365), 0);

  // REVIEW_COMMIT_57747F0.md §7 : un label xn-- n'est une preuve
  // d'homoglyphe que s'il decode vers un caractere confusable documente ;
  // un IDN legitime (japonais ici) ne doit pas etre penalise.
  assert.equal(hasHomoglyphEvidence([domainToASCII("ѕсam-binance"), "com"]), true, "un homoglyphe cyrillique reellement present doit etre detecte");
  assert.equal(hasHomoglyphEvidence([domainToASCII("日本語"), "jp"]), false, "un IDN legitime sans caractere confusable ne doit pas etre marque comme homoglyphe");

  // RF-N7 : la confiance mesure la certitude du verdict, pas un risque brut.
  assert.equal(llmRisk("malicious", 0.95), 0.95);
  assert.ok(Math.abs(llmRisk("legitimate", 0.98) - 0.02) < 1e-9);
  assert.equal(llmRisk("suspicious", 0.7), 0.5);

  const features = await calculateUrlFeatures("https://bit.ly/a", "https://a.b.c.bad.xyz", { lookupDomainAge: async () => ({ ageDays: 3, source: "test" }) });
  assert.equal(features.score, 0.8);

  // Une URL avec un hote IP litteral ne doit plus jeter ni produire un
  // score incoherent : whoisAge reste neutre, aucun signal TLD/sous-domaine/
  // homoglyphe/shortener bidon derive d'un decoupage de l'adresse en labels.
  const ipFeatures = await calculateUrlFeatures("https://192.0.2.10/wallet-connect");
  assert.equal(ipFeatures.domain, "192.0.2.10");
  assert.equal(ipFeatures.tld, null);
  assert.equal(ipFeatures.subdomainCount, 0);
  assert.equal(ipFeatures.whoisSource, "not_applicable_ip");
  assert.ok(Number.isFinite(ipFeatures.score));

  const server = createAnalysisServer({
    secret: SECRET,
    analyzeContent: async () => ({ verdict: "malicious", confidence: 0.95, category: "wallet_drainer", indicators: ["approve illimite"], modelUsed: "gemini", modelName: "test" }),
    scoreUrl: async () => ({ score: 0.8, components: {} }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ url: "https://bad.xyz", finalUrl: "https://bad.xyz", textExcerpt: "x".repeat(250), structuralDigest: {} }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.scoreFinal, 0.905);
    assert.equal(result.status, "reporting");
    assert.equal(decide({ verdict: "suspicious" }, 0.4).status, "manual_review");
    assert.equal(decide({ verdict: "legitimate" }, 0.9).decision, "logged_only");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // RF-N7 : un verdict legitimate a haute confiance doit produire un
  // scoreFinal bas (risque), pas haut (confiance brute).
  const legitimateServer = createAnalysisServer({
    secret: SECRET,
    analyzeContent: async () => ({ verdict: "legitimate", confidence: 0.98, category: null, indicators: [], modelUsed: "gemini", modelName: "test" }),
    scoreUrl: async () => ({ score: 0, components: {} }),
  });
  await new Promise((resolve) => legitimateServer.listen(0, "127.0.0.1", resolve));
  const legitimateBase = `http://127.0.0.1:${legitimateServer.address().port}`;
  try {
    const response = await fetch(`${legitimateBase}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ url: "https://good.example", finalUrl: "https://good.example", textExcerpt: "x".repeat(250), structuralDigest: {} }),
    });
    const result = await response.json();
    assert.ok(result.scoreFinal < 0.05, `expected a low risk score for a confident legitimate verdict, got ${result.scoreFinal}`);
    assert.equal(result.decision, "logged_only");
  } finally {
    await new Promise((resolve) => legitimateServer.close(resolve));
  }

  console.log("WF2 analysis: 24/24 tests passes.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
