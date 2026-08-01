"use strict";

// Suite de tests minimale (assert natif Node, aucune dépendance), commise
// dans le dépôt et rejouable. Échoue avec un code de sortie non nul si
// une assertion échoue — jamais de test documenté comme réussi alors
// qu'il a échoué.

const assert = require("node:assert/strict");
const { resolveAndValidate } = require("./lib/ssrfGuard");
const {
  extractTextExcerpt,
  buildStructuralDigest,
  MAX_STRUCTURAL_DIGEST_CHARS,
  WEB3_PATTERNS,
} = require("./lib/htmlToDigest");

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

async function run() {
  console.log("ssrfGuard");
  await test("bloque une IP privée fournie directement (127.0.0.1)", async () => {
    await assert.rejects(() => resolveAndValidate("127.0.0.1"));
  });
  await test("bloque localhost (résout en ::1/127.0.0.1)", async () => {
    await assert.rejects(() => resolveAndValidate("localhost"));
  });
  await test("bloque une adresse metadata cloud (169.254.169.254)", async () => {
    await assert.rejects(() => resolveAndValidate("169.254.169.254"));
  });
  await test("bloque une plage RFC1918 (10.0.0.5)", async () => {
    await assert.rejects(() => resolveAndValidate("10.0.0.5"));
  });
  await test("bloque ::1 (loopback IPv6)", async () => {
    await assert.rejects(() => resolveAndValidate("::1"));
  });
  await test("autorise un domaine public réel (example.com)", async () => {
    const ip = await resolveAndValidate("example.com");
    assert.ok(ip && ip.length > 0, "devrait renvoyer une IP");
  });

  console.log("\nhtmlToDigest — isolation script vs texte visible");
  // Les motifs Web3 n'apparaissent QUE dans le bloc <script>, jamais dans
  // le texte visible : ceci permet de tester sans ambiguïté que
  // textExcerpt ne fait pas fuiter le contenu d'un <script>.
  const isolationHtml = `
    <html><body>
      <h1>Bienvenue</h1>
      <p>Ceci est un paragraphe visible normal, sans rapport avec le sujet du test.</p>
      <script src="https://evil-cdn.example.test/drainer.js"></script>
      <script>
        window.ethereum.request({method:'eth_requestAccounts'}).then(function (accounts) {
          contract.approve(spender, MAX_UINT256);
          contract.setApprovalForAll(operator, true);
        });
      </script>
      <form><input name="seedPhrase" type="text" placeholder="Enter your recovery phrase"></form>
    </body></html>`;

  const text = extractTextExcerpt(isolationHtml);
  const digest = buildStructuralDigest(isolationHtml, "phishing-test.invalid");

  await test("textExcerpt conserve le texte visible", async () => {
    assert.match(text, /paragraphe visible normal/);
  });
  await test("textExcerpt ne contient PAS le contenu du bloc <script> (eth_requestAccounts)", async () => {
    assert.doesNotMatch(text, /eth_requestAccounts/);
  });
  await test("textExcerpt ne contient PAS le contenu du bloc <script> (setApprovalForAll)", async () => {
    assert.doesNotMatch(text, /setApprovalForAll/);
  });
  await test("textExcerpt ne contient PAS le contenu du bloc <script> (window.ethereum)", async () => {
    assert.doesNotMatch(text, /window\.ethereum/);
  });
  await test("structuralDigest capture le domaine de script externe", async () => {
    assert.deepEqual(digest.externalScriptDomains, ["evil-cdn.example.test"]);
  });
  await test("structuralDigest capture le champ de formulaire seedPhrase", async () => {
    assert.ok(digest.formFields.some((f) => f.name === "seedPhrase"));
  });
  await test("structuralDigest capture les motifs Web3 du bloc <script>", async () => {
    const found = new Set(digest.web3PatternSnippets.map((s) => s.pattern));
    for (const p of ["eth_requestAccounts", "approve", "setApprovalForAll", "window.ethereum"]) {
      assert.ok(found.has(p), `motif manquant : ${p}`);
    }
  });

  console.log("\nhtmlToDigest — ordre de troncature (RF-A2 : ne pas sacrifier les motifs Web3 en premier)");

  // Test A : beaucoup de domaines de scripts externes (assez volumineux
  // pour dépasser MAX_STRUCTURAL_DIGEST_CHARS à eux seuls), un seul champ
  // nommé et un seul motif Web3 -> le dépassement doit être absorbé en
  // coupant les domaines (tier 1), sans toucher au motif ni au champ.
  const domainSuffix = "x".repeat(300);
  const manyDomainsHtml = [
    "<html><body>",
    ...Array.from(
      { length: 30 },
      (_, i) => `<script src="https://external-domain-${i}-${domainSuffix}.example.test/x.js"></script>`,
    ),
    '<input name="email" type="email" placeholder="Your email address">',
    "<script>contract.approve(spender, MAX_UINT256);</script>",
    "</body></html>",
  ].join("\n");

  const digestA = buildStructuralDigest(manyDomainsHtml, "phishing-test.invalid");

  await test("respecte la taille maximale du digest", async () => {
    assert.ok(JSON.stringify(digestA).length <= MAX_STRUCTURAL_DIGEST_CHARS);
  });
  await test("réduit les domaines de scripts externes en priorité (moins de 20 conservés)", async () => {
    assert.ok(digestA.externalScriptDomains.length < 20, `attendu < 20, obtenu ${digestA.externalScriptDomains.length}`);
  });
  await test("ne sacrifie PAS le motif Web3 pour absorber le dépassement dû aux domaines", async () => {
    assert.equal(digestA.web3PatternSnippets.length, 1);
  });
  await test("ne sacrifie PAS le champ de formulaire nommé pour absorber le dépassement dû aux domaines", async () => {
    assert.ok(digestA.formFields.some((f) => f.name === "email"));
  });

  // Test B : un champ nommé placé APRÈS 150 champs vides dans le HTML —
  // teste que le plafond MAX_FORM_FIELDS (appliqué dès l'extraction, pas
  // seulement dans buildStructuralDigest) garde les champs porteurs
  // d'information par pertinence, jamais par simple ordre d'apparition
  // dans le code source.
  const manyEmptyFieldsHtml = [
    "<html><body>",
    ...Array.from({ length: 150 }, () => "<input type=\"hidden\">"),
    '<input name="email" type="email" placeholder="Your email address">',
    "<script>contract.approve(spender, MAX_UINT256);</script>",
    "</body></html>",
  ].join("\n");

  const digestB = buildStructuralDigest(manyEmptyFieldsHtml, "phishing-test.invalid");

  await test("ne dépasse pas MAX_FORM_FIELDS malgré 150 champs vides en amont", async () => {
    assert.ok(digestB.formFields.length <= 20, `attendu <= 20, obtenu ${digestB.formFields.length}`);
  });
  await test("conserve le champ nommé malgré 150 champs vides placés avant lui dans le HTML", async () => {
    assert.ok(digestB.formFields.some((f) => f.name === "email"));
  });
  await test("conserve le motif Web3 (sans rapport avec le nombre de champs)", async () => {
    assert.equal(digestB.web3PatternSnippets.length, 1);
  });

  // Test C : un unique motif Web3 avec un contexte artificiellement très
  // long (pas de domaines, pas de champs) -> le dépassement doit d'abord
  // raccourcir le contexte du motif plutôt que de le supprimer entièrement.
  const longContextHtml = `<html><body>${"x".repeat(6000)}window.ethereum${"y".repeat(6000)}</body></html>`;
  const digestC = buildStructuralDigest(longContextHtml, "phishing-test.invalid");

  await test("raccourcit le contexte plutôt que de supprimer le seul motif restant", async () => {
    assert.equal(digestC.web3PatternSnippets.length, 1, "le motif unique doit survivre (raccourci, pas supprimé)");
    assert.ok(JSON.stringify(digestC).length <= MAX_STRUCTURAL_DIGEST_CHARS);
  });

  console.log("\nRésumé WEB3_PATTERNS testés :", WEB3_PATTERNS.length, "motifs définis");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passés.`);
  if (failed.length > 0) {
    console.log(`${failed.length} test(s) en échec :`);
    for (const f of failed) console.log(`  - ${f.name}: ${f.error.message}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Échec inattendu de la suite de tests :", error.message);
  process.exitCode = 1;
});
