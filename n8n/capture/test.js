#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createCaptureServer } = require("./server");

const SECRET = "test-secret-32-characters-minimum-value";

async function main() {
  const server = createCaptureServer({
    secret: SECRET,
    capture: async (url) => {
      const host = new URL(url).hostname;
      if (host === "www.broken-cert.vercel.app") {
        throw Object.assign(
          new Error("Hostname/IP does not match certificate's altnames"),
          { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
        );
      }
      if (host === "www.timeout.example")
        throw Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        });
      return {
        html: "<html><body><form><input name='seed' placeholder='Seed phrase'></form><script>ethereum.request({method:'eth_requestAccounts'})</script><p>Contenu de test suffisamment long pour verifier la conversion du document HTML en texte lisible sans exposer le HTML brut.</p></body></html>",
        finalUrl: url,
        httpStatus: 200,
        truncated: false,
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(response.status, 401);
    response = await fetch(`${base}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    assert.equal(response.status, 400);
    response = await fetch(`${base}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(
      result.html,
      undefined,
      "le HTML brut ne doit jamais sortir du service",
    );
    assert.equal(result.structuralDigest.formFields[0].name, "seed");
    assert.equal(
      result.structuralDigest.web3PatternSnippets[0].pattern,
      "eth_requestAccounts",
    );

    // Certificat wildcard : www.<projet>.vercel.app echoue en TLS -> reessai a l'apex.
    response = await fetch(`${base}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ url: "https://www.broken-cert.vercel.app/claim" }),
    });
    assert.equal(response.status, 200);
    const fallback = await response.json();
    assert.equal(fallback.wwwFallback, true);
    assert.equal(fallback.finalUrl, "https://broken-cert.vercel.app/claim");
    assert.equal(fallback.structuralDigest.formFields[0].name, "seed");

    // Une autre erreur reseau sur un hote www. ne declenche PAS le repli.
    response = await fetch(`${base}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ url: "https://www.timeout.example/" }),
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "capture_failed");
    console.log("WF2 capture: 7/7 tests passes.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
