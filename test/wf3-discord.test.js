"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AMOY_TRANSACTION_URL,
  DISPLAYED_INDICATORS,
  MAX_EMBED_FIELDS,
  Wf3DiscordValidationError,
  buildFinalDiscordPayload,
} = require("../n8n/lib/wf3Discord");
const {
  DECISIONS,
  DELIVERY_OUTCOMES,
  STATUSES,
  applyDecision,
  claimFinalAlert,
  completeReport,
  createLifecycle,
  failLifecycle,
  settleFinalAlert,
  startAnalysis,
} = require("../n8n/lib/wf3Lifecycle");

const REPORT_ID = "r_20260801_discord_4g";
const TX_HASH = `0x${"a".repeat(64)}`;
const WALLET = "0x000000000000000000000000000000000000dEaD";
const TIMES = Object.freeze({
  queued: "2026-08-01T16:00:00.000Z",
  analyzing: "2026-08-01T16:00:01.000Z",
  decided: "2026-08-01T16:00:02.000Z",
  completed: "2026-08-01T16:00:03.000Z",
  claimed: "2026-08-01T16:00:04.000Z",
  settled: "2026-08-01T16:00:05.000Z",
});

function at(value) {
  return () => value;
}

function context(overrides = {}) {
  return {
    reportId: REPORT_ID,
    type: "url",
    value:
      "https://danger.invalid/claim?next=https://nested.example/path#review",
    verdict: "malicious",
    category: "fake_airdrop",
    scoreFinal: 0.914,
    indicators: [
      "@everyone visit https://indicator.example/path",
      "<@123456> **bold** wallet prompt",
      "Hosts evil.example and 192.0.2.1",
      "fourth indicator must not be displayed",
    ],
    ...overrides,
  };
}

function start(reportId = REPORT_ID) {
  const queued = createLifecycle(reportId, { now: at(TIMES.queued) });
  return startAnalysis(queued, {
    expectedRevision: queued.revision,
    now: at(TIMES.analyzing),
  });
}

function claimTerminal(terminal, claimId = "discord-execution-1") {
  const result = claimFinalAlert(terminal, {
    expectedRevision: terminal.revision,
    claimId,
    now: at(TIMES.claimed),
  });
  assert.equal(result.claimCreated, true);
  return result;
}

function reportedLifecycle(status = STATUSES.REPORTED) {
  const analyzing = start();
  const reporting = applyDecision(analyzing, DECISIONS.REPORT, {
    expectedRevision: analyzing.revision,
    now: at(TIMES.decided),
  });
  return completeReport(
    reporting,
    { status, txHash: TX_HASH },
    { expectedRevision: reporting.revision, now: at(TIMES.completed) },
  );
}

function manualLifecycle() {
  const analyzing = start();
  return applyDecision(analyzing, DECISIONS.MANUAL_REVIEW, {
    expectedRevision: analyzing.revision,
    now: at(TIMES.decided),
  });
}

function failedLifecycle({ afterDecision = false } = {}) {
  const analyzing = start();
  const current = afterDecision
    ? applyDecision(analyzing, DECISIONS.REPORT, {
        expectedRevision: analyzing.revision,
        now: at(TIMES.decided),
      })
    : analyzing;
  return failLifecycle(current, "CHAIN_TIMEOUT", {
    expectedRevision: current.revision,
    now: at(TIMES.completed),
  });
}

function build(claimed, alertContext) {
  return buildFinalDiscordPayload({
    lifecycle: claimed.lifecycle,
    claim: claimed.claim,
    context: alertContext,
  });
}

function embed(payload) {
  return payload.discord.embeds[0];
}

function fieldValue(payload, name) {
  const found = embed(payload).fields.find((entry) => entry.name === name);
  assert.ok(found, `Discord field not found: ${name}`);
  return found.value;
}

function embedTextLength(payload) {
  const value = embed(payload);
  return (
    value.title.length +
    value.footer.text.length +
    value.fields.reduce(
      (total, entry) => total + entry.name.length + entry.value.length,
      0,
    )
  );
}

test("builds an immutable confirmed-chain alert with only a trusted link", () => {
  const claimed = claimTerminal(reportedLifecycle());
  const payload = build(claimed, context());
  const serialized = JSON.stringify(payload.discord);

  assert.equal(payload.channel, "alerts");
  assert.equal(embed(payload).title, "Threat confirmed on-chain");
  assert.equal(fieldValue(payload, "Verdict"), "malicious");
  assert.equal(fieldValue(payload, "Category"), String.raw`fake\_airdrop`);
  assert.equal(fieldValue(payload, "Score"), "91%");
  assert.match(fieldValue(payload, "Target"), /^hxxps:\/\/danger/);
  assert.doesNotMatch(fieldValue(payload, "Target"), /danger\.invalid/);
  assert.match(fieldValue(payload, "Transaction"), new RegExp(TX_HASH));
  assert.match(fieldValue(payload, "Transaction"), /amoy\.polygonscan\.com/);
  assert.deepEqual(payload.discord.allowed_mentions, {
    parse: [],
    users: [],
    roles: [],
    replied_user: false,
  });
  assert.doesNotMatch(serialized, /@everyone|<@123456>|indicator\.example/);
  assert.doesNotMatch(serialized, /https:\/\/danger|nested\.example/);
  assert.equal((serialized.match(/https:\/\//g) || []).length, 1);
  assert.match(
    serialized,
    new RegExp(AMOY_TRANSACTION_URL.replaceAll(".", "\\.")),
  );
  assert.doesNotMatch(serialized, /discord-execution-1|claimRevision|revision/);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.discord), true);
  assert.equal(Object.isFrozen(payload.discord.allowed_mentions.parse), true);
  assert.equal(Object.isFrozen(embed(payload).fields), true);
});

test("manual-review alert is routed separately and never claims publication", () => {
  const claimed = claimTerminal(manualLifecycle());
  const payload = build(
    claimed,
    context({
      verdict: "suspicious",
      category: null,
      scoreFinal: 0.72,
    }),
  );

  assert.equal(payload.channel, "manual_review");
  assert.equal(embed(payload).title, "Manual review required");
  assert.equal(fieldValue(payload, "Category"), "Not assigned");
  assert.equal(fieldValue(payload, "Publication"), "Not published on-chain");
  assert.equal(
    fieldValue(payload, "Transaction"),
    "Not available — no confirmed transaction",
  );
  assert.doesNotMatch(JSON.stringify(payload), /amoy\.polygonscan\.com/);
  const indicators = fieldValue(payload, "Indicators");
  assert.equal(
    (indicators.match(/\n/g) || []).length + 1,
    DISPLAYED_INDICATORS,
  );
  assert.doesNotMatch(indicators, /fourth indicator/);
});

test("pipeline failure exposes only its safe code and unavailable analysis", () => {
  const claimed = claimTerminal(failedLifecycle());
  const payload = build(
    claimed,
    context({
      verdict: null,
      category: null,
      scoreFinal: null,
      indicators: [],
    }),
  );

  assert.equal(payload.channel, "manual_review");
  assert.equal(embed(payload).title, "Anti-phishing pipeline failed");
  assert.equal(fieldValue(payload, "Verdict"), "Unavailable");
  assert.equal(fieldValue(payload, "Score"), "Unavailable");
  assert.equal(fieldValue(payload, "Indicators"), "None available");
  assert.equal(fieldValue(payload, "Technical code"), "CHAIN_TIMEOUT");
  assert.equal(
    fieldValue(payload, "Publication"),
    "Not confirmed as published",
  );
  assert.doesNotMatch(JSON.stringify(payload), /provider|RPC URL|secret/i);
});

test("a report-stage failure may retain its validated malicious analysis", () => {
  const claimed = claimTerminal(failedLifecycle({ afterDecision: true }));
  const payload = build(claimed, context());

  assert.equal(payload.channel, "manual_review");
  assert.equal(fieldValue(payload, "Verdict"), "malicious");
  assert.equal(fieldValue(payload, "Technical code"), "CHAIN_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(payload), /Published and confirmed/);
});

test("already-blacklisted and wallet alerts use confirmed chain evidence", () => {
  const existing = claimTerminal(
    reportedLifecycle(STATUSES.ALREADY_BLACKLISTED),
  );
  const existingPayload = build(existing, context());
  assert.equal(
    embed(existingPayload).title,
    "Threat already registered on-chain",
  );
  assert.match(fieldValue(existingPayload, "Transaction"), /polygonscan/);

  const manual = claimTerminal(manualLifecycle(), "discord-wallet-claim");
  const walletPayload = build(
    manual,
    context({
      type: "wallet",
      value: WALLET.toLowerCase(),
      verdict: "malicious",
      category: "fake_support",
      scoreFinal: 0.6,
      indicators: ["Unexpected signing request"],
    }),
  );
  assert.equal(fieldValue(walletPayload, "Target"), WALLET);
  assert.doesNotMatch(fieldValue(walletPayload, "Target"), /hxxp/i);
});

test("attacker-controlled text is defanged, mention-safe, and bounded", () => {
  const claimed = claimTerminal(manualLifecycle());
  const longPath = `${"*".repeat(1_900)}.invalid`;
  const payload = build(
    claimed,
    context({
      value: `https://bounds.invalid/${longPath}`,
      verdict: "suspicious",
      category: null,
      scoreFinal: 0.5,
      indicators: [
        `${"@everyone https://very-bad.example <@1> **x** ".repeat(4)}`.slice(
          0,
          200,
        ),
        "second.example",
        "203.0.113.7",
      ],
    }),
  );

  assert.ok(embed(payload).fields.length <= MAX_EMBED_FIELDS);
  for (const entry of embed(payload).fields) {
    assert.ok(entry.name.length <= 256);
    assert.ok(entry.value.length <= 1_024);
  }
  assert.ok(embedTextLength(payload) <= 6_000);
  const indicators = fieldValue(payload, "Indicators");
  assert.match(indicators, /hxxps:\/\//);
  assert.match(indicators, /＠everyone/);
  assert.ok(indicators.includes(String.raw`very\-bad\[\.\]example`));
  assert.ok(indicators.includes(String.raw`203\[\.\]0\[\.\]113\[\.\]7`));
  const serialized = JSON.stringify(payload.discord);
  assert.doesNotMatch(serialized, /@everyone|<@1>|very-bad\.example/);
  assert.doesNotMatch(serialized, /https:\/\/very-bad|203\.0\.113\.7/);
});

test("rejects unclaimed, settled, mismatched, and malformed alert requests", () => {
  const manual = manualLifecycle();
  const claimed = claimTerminal(manual);
  const validContext = context({
    verdict: "suspicious",
    category: null,
    scoreFinal: 0.72,
  });

  assert.throws(
    () =>
      buildFinalDiscordPayload({
        lifecycle: manual,
        claim: claimed.claim,
        context: validContext,
      }),
    Wf3DiscordValidationError,
  );
  assert.throws(
    () =>
      buildFinalDiscordPayload({
        lifecycle: claimed.lifecycle,
        claim: { ...claimed.claim, claimId: "different-execution" },
        context: validContext,
      }),
    /does not authorize/,
  );
  assert.throws(
    () => build(claimed, { ...validContext, reportId: "different-report" }),
    /must match/,
  );
  assert.throws(
    () =>
      buildFinalDiscordPayload({
        lifecycle: claimed.lifecycle,
        claim: claimed.claim,
        context: validContext,
        webhookUrl: "https://must-not-be-accepted.invalid",
      }),
    /exactly/,
  );
  assert.throws(
    () => build(claimed, { ...validContext, unexpected: true }),
    /exactly/,
  );

  const settled = settleFinalAlert(claimed.lifecycle, {
    ...claimed.claim,
    expectedRevision: claimed.lifecycle.revision,
    outcome: DELIVERY_OUTCOMES.SENT,
    now: at(TIMES.settled),
  });
  assert.throws(
    () =>
      buildFinalDiscordPayload({
        lifecycle: settled,
        claim: claimed.claim,
        context: validContext,
      }),
    /does not authorize/,
  );
});

test("rejects lifecycle decisions inconsistent with displayed analysis", () => {
  const manual = claimTerminal(manualLifecycle());
  assert.throws(() => build(manual, context()), /inconsistent/);

  const failedBeforeDecision = claimTerminal(
    failedLifecycle(),
    "discord-failed-inconsistent",
  );
  assert.throws(() => build(failedBeforeDecision, context()), /inconsistent/);

  const reported = claimTerminal(reportedLifecycle(), "discord-reported-null");
  assert.throws(
    () =>
      build(
        reported,
        context({
          verdict: null,
          category: null,
          scoreFinal: null,
          indicators: [],
        }),
      ),
    /inconsistent/,
  );
});

test("manual review explains its score in plain language from typed values", () => {
  const claimed = claimTerminal(manualLifecycle());
  const payload = build(
    claimed,
    context({
      verdict: "malicious",
      category: "other",
      scoreFinal: 0.7,
      llmConfidence: 0.95,
      featureScore: 0.12,
    }),
  );

  const explanation = fieldValue(payload, "Why manual review?");
  assert.match(explanation, /very confident this target is malicious \(95%\)/);
  assert.match(explanation, /few known red flags/);
  assert.match(explanation, /classic scam rather than a crypto attack/);
  assert.match(explanation, /Combined score: 70% — 10 points short of the 80%/);
  assert.match(explanation, /likely safe to confirm as fraud/);
  assert.ok(explanation.length <= 1024);
  assert.doesNotMatch(JSON.stringify(payload), /@everyone|https:\/\/danger/);
});

test("uncertain manual review suggests a careful human check", () => {
  const claimed = claimTerminal(manualLifecycle());
  const payload = build(
    claimed,
    context({
      verdict: "suspicious",
      category: null,
      scoreFinal: 0.62,
      llmConfidence: 0.75,
      featureScore: 0.3,
    }),
  );

  const explanation = fieldValue(payload, "Why manual review?");
  assert.match(
    explanation,
    /could not decide between malicious and legitimate \(confidence 75%\)/,
  );
  assert.match(explanation, /some suspicious traits/);
  assert.match(explanation, /needs a careful human check/);
});

test("explanation is omitted when score components are unavailable", () => {
  const claimed = claimTerminal(manualLifecycle());
  const payload = build(
    claimed,
    context({ verdict: "suspicious", category: null, scoreFinal: 0.72 }),
  );

  const found = embed(payload).fields.find(
    (entry) => entry.name === "Why manual review?",
  );
  assert.equal(found, undefined);
});

test("confirmed on-chain alerts never carry the manual-review explanation", () => {
  const claimed = claimTerminal(reportedLifecycle());
  const payload = build(
    claimed,
    context({ llmConfidence: 0.99, featureScore: 0.9 }),
  );

  const found = embed(payload).fields.find(
    (entry) => entry.name === "Why manual review?",
  );
  assert.equal(found, undefined);
});

test("score components outside 0..1 are rejected", () => {
  const claimed = claimTerminal(manualLifecycle());
  const base = context({
    verdict: "suspicious",
    category: null,
    scoreFinal: 0.72,
  });
  assert.throws(
    () => build(claimed, { ...base, llmConfidence: 1.5 }),
    Wf3DiscordValidationError,
  );
  assert.throws(
    () => build(claimed, { ...base, featureScore: -0.1 }),
    Wf3DiscordValidationError,
  );
  assert.throws(
    () => build(claimed, { ...base, llmConfidence: "0.9" }),
    Wf3DiscordValidationError,
  );
});
