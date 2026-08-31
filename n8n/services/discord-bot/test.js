#!/usr/bin/env node
"use strict";

// Tests hors ligne du bot Discord de resolution : logique pure + orchestration
// resolveReport avec fetch mocke. Aucun appel Discord, bridge ou blockchain.

const assert = require("node:assert/strict");
const {
  buildReviewMessage,
  isAuthorizedInteraction,
  parseCustomId,
  refangValue,
  resolvedMessagePatch,
  resolveReport,
  selectNewManualReviews,
} = require("./lib");

const REPORT_ID = "r_20260831T120000Z_42";
const TX = `0x${"b".repeat(64)}`;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(routes, calls) {
  return async (url, options = {}) => {
    const method = options.method ?? "GET";
    const key = `${method} ${url}`;
    calls.push({
      key,
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
    });
    const handler = routes[key];
    if (!handler) throw new Error(`Route non mockee : ${key}`);
    return typeof handler === "function" ? handler(calls.at(-1)) : handler;
  };
}

async function main() {
  // refang : inverse exact du defang WF1 ; wallet inchange.
  assert.equal(
    refangValue("url", "hxxps://pancakeswapo[.]finance/"),
    "https://pancakeswapo.finance/",
  );
  assert.equal(
    refangValue("url", "hxxp://a[.]b[.]top/x?q=1"),
    "http://a.b.top/x?q=1",
  );
  assert.equal(
    refangValue("wallet", "0x000000000000000000000000000000000000dEaD"),
    "0x000000000000000000000000000000000000dEaD",
  );

  // parseCustomId : format ferme.
  assert.deepEqual(parseCustomId(`resolve:confirm:${REPORT_ID}`), {
    action: "confirm",
    reportId: REPORT_ID,
  });
  assert.deepEqual(parseCustomId(`resolve:dismiss:${REPORT_ID}`), {
    action: "dismiss",
    reportId: REPORT_ID,
  });
  assert.equal(parseCustomId("resolve:destroy:" + REPORT_ID), null);
  assert.equal(parseCustomId("resolve:confirm:../etc"), null);
  assert.equal(parseCustomId(null), null);

  // Autorisation : Administrator bitfield (0x8) sans role configure.
  assert.equal(
    isAuthorizedInteraction({ member: { permissions: "8" } }, null),
    true,
  );
  assert.equal(
    isAuthorizedInteraction(
      { member: { permissions: String(0x8 | 0x400) } },
      null,
    ),
    true,
  );
  assert.equal(
    isAuthorizedInteraction({ member: { permissions: "1024" } }, null),
    false,
  );
  assert.equal(
    isAuthorizedInteraction({ member: { permissions: "abc" } }, null),
    false,
  );
  assert.equal(isAuthorizedInteraction({}, null), false);
  // Role explicite : seul ce role passe, Administrator ne suffit plus.
  assert.equal(
    isAuthorizedInteraction(
      { member: { roles: ["r1", "r2"], permissions: "8" } },
      "r2",
    ),
    true,
  );
  assert.equal(
    isAuthorizedInteraction(
      { member: { roles: ["r1"], permissions: "8" } },
      "r9",
    ),
    false,
  );

  // Selection : seuls les manual_review non postes.
  const records = [
    { reportId: "r_20260831T120000Z_1", status: "manual_review" },
    { reportId: "r_20260831T120000Z_2", status: "reported" },
    { reportId: "r_20260831T120000Z_3", status: "manual_review" },
  ];
  const picked = selectNewManualReviews(
    records,
    new Set(["r_20260831T120000Z_1"]),
  );
  assert.deepEqual(
    picked.map((r) => r.reportId),
    ["r_20260831T120000Z_3"],
  );
  assert.deepEqual(selectNewManualReviews(null, new Set()), []);

  // Message : boutons + mentions neutralisees + defang conserve.
  const message = buildReviewMessage({
    reportId: REPORT_ID,
    valueDefanged: "hxxps://evil[.]top/@everyone",
    type: "url",
    scoreFinal: 0.7025,
    category: "fake_exchange",
    verdict: "malicious",
    llmConfidence: 0.95,
    featureScore: 0.12,
    indicators: ["Fake login form", "Brand impersonation @here"],
  });
  assert.equal(
    message.components[0].components[0].custom_id,
    `resolve:confirm:${REPORT_ID}`,
  );
  assert.equal(
    message.components[0].components[1].custom_id,
    `resolve:dismiss:${REPORT_ID}`,
  );
  assert.deepEqual(message.allowed_mentions.parse, []);
  const targetField = message.embeds[0].fields.find((f) =>
    f.name.startsWith("Cible"),
  );
  assert.ok(targetField.value.includes("hxxps://evil[.]top"));
  assert.ok(
    !targetField.value.includes("@everyone"),
    "les mentions doivent etre neutralisees",
  );
  assert.ok(message.embeds[0].fields.some((f) => f.value === "70/100"));
  const whyField = message.embeds[0].fields.find(
    (f) => f.name === "Why manual review?",
  );
  assert.ok(whyField, "l'explication detaillee doit etre presente");
  assert.ok(whyField.value.includes("Suggested action"));
  const indicatorsField = message.embeds[0].fields.find(
    (f) => f.name === "Indicateurs",
  );
  assert.ok(indicatorsField.value.includes("1. Fake login form"));
  assert.ok(
    !indicatorsField.value.includes("@here"),
    "mentions neutralisees dans les indicateurs",
  );
  // Sans donnees detaillees : message minimal, pas d'explication.
  const minimal = buildReviewMessage({
    reportId: REPORT_ID,
    valueDefanged: "0xdead",
    type: "wallet",
    scoreFinal: 0.5,
    category: null,
  });
  assert.ok(
    !minimal.embeds[0].fields.some((f) => f.name === "Why manual review?"),
  );

  // Patch de message resolu : boutons retires.
  const patch = resolvedMessagePatch(message.embeds[0], {
    action: "confirm",
    summary: "ok",
  });
  assert.deepEqual(patch.components, []);
  assert.ok(patch.embeds[0].fields.some((f) => f.name === "Resolution"));

  const bridge = { url: "http://bridge:8787", secret: "s".repeat(32) };
  const chainBridge = {
    url: "http://chain-bridge:3001",
    token: "t".repeat(32),
  };
  const record = {
    reportId: REPORT_ID,
    type: "url",
    valueDefanged: "hxxps://pancakeswapo[.]finance/",
    status: "manual_review",
    scoreFinal: 0.7025,
    category: "fake_exchange",
  };

  // Confirm : refang -> /internal/report -> PATCH journal avec tx confirme.
  {
    const calls = [];
    const outcome = await resolveReport({
      action: "confirm",
      reportId: REPORT_ID,
      bridge,
      chainBridge,
      fetchImpl: mockFetch(
        {
          [`GET ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record,
          }),
          [`POST ${chainBridge.url}/internal/report`]: jsonResponse(200, {
            status: "reported",
            txHash: TX,
          }),
          [`PATCH ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record: { ...record, status: "reported" },
          }),
        },
        calls,
      ),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.txHash, TX);
    const chainCall = calls.find((c) => c.key.includes("/internal/report"));
    assert.deepEqual(chainCall.body, {
      type: "url",
      value: "https://pancakeswapo.finance/",
      category: "fake_exchange",
      score: 70,
    });
    const patchCall = calls.find((c) => c.key.startsWith("PATCH"));
    assert.deepEqual(patchCall.body, {
      status: "reported",
      txHash: TX,
      decision: "reporting",
    });
  }

  // Confirm accepte "already_blacklisted" (deja au registre, pas de txHash) :
  // journal mis a jour, resolution reussie.
  {
    const calls = [];
    const outcome = await resolveReport({
      action: "confirm",
      reportId: REPORT_ID,
      bridge,
      chainBridge,
      fetchImpl: mockFetch(
        {
          [`GET ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record,
          }),
          [`POST ${chainBridge.url}/internal/report`]: jsonResponse(200, {
            status: "already_blacklisted",
            since: "2026-08-30T06:55:39.000Z",
          }),
          [`PATCH ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record: { ...record, status: "already_blacklisted" },
          }),
        },
        calls,
      ),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.txHash, null);
    assert.ok(outcome.summary.includes("Deja present au registre"));
    const patchCall = calls.find((c) => c.key.startsWith("PATCH"));
    assert.deepEqual(patchCall.body, {
      status: "already_blacklisted",
      txHash: null,
      decision: "reporting",
    });
  }

  // Confirm refuse si le resultat blockchain n'est pas confirme : journal intact.
  {
    const calls = [];
    const outcome = await resolveReport({
      action: "confirm",
      reportId: REPORT_ID,
      bridge,
      chainBridge,
      fetchImpl: mockFetch(
        {
          [`GET ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record,
          }),
          [`POST ${chainBridge.url}/internal/report`]: jsonResponse(502, {
            error: "rpc_down",
          }),
        },
        calls,
      ),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "CHAIN_REPORT_FAILED");
    assert.ok(
      !calls.some((c) => c.key.startsWith("PATCH")),
      "le journal ne doit pas etre modifie sans tx confirmee",
    );
  }

  // Deja traite : aucun effet (protege contre le double-clic / la course).
  {
    const calls = [];
    const outcome = await resolveReport({
      action: "confirm",
      reportId: REPORT_ID,
      bridge,
      chainBridge,
      fetchImpl: mockFetch(
        {
          [`GET ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record: { ...record, status: "reported" },
          }),
        },
        calls,
      ),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "ALREADY_RESOLVED");
    assert.equal(calls.length, 1);
  }

  // Dismiss : PATCH journal uniquement, jamais le chain-bridge.
  {
    const calls = [];
    const outcome = await resolveReport({
      action: "dismiss",
      reportId: REPORT_ID,
      bridge,
      chainBridge,
      fetchImpl: mockFetch(
        {
          [`GET ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record,
          }),
          [`PATCH ${bridge.url}/reports/${REPORT_ID}`]: jsonResponse(200, {
            record: { ...record, status: "dismissed" },
          }),
        },
        calls,
      ),
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(calls.find((c) => c.key.startsWith("PATCH")).body, {
      status: "dismissed",
    });
    assert.ok(
      !calls.some((c) => c.key.includes("chain-bridge")),
      "dismiss ne doit jamais toucher la blockchain",
    );
  }

  console.log("Discord bot: 7/7 groupes de tests passes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
