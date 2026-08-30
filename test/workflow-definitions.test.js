"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const workflowPath = path.resolve(__dirname, "../n8n/workflows/WF4-check.json");
const workflowText = fs.readFileSync(workflowPath, "utf8");
const workflow = JSON.parse(workflowText);
const proxyPath = path.resolve(__dirname, "../n8n/proxy/nginx.conf");
const proxyText = fs.readFileSync(proxyPath, "utf8");
const wf3Path = path.resolve(__dirname, "../n8n/workflows/WF3-action.json");
const wf3Text = fs.readFileSync(wf3Path, "utf8");
const wf3 = JSON.parse(wf3Text);
const wf2Path = path.resolve(__dirname, "../n8n/workflows/WF2_Analyse.json");
const wf2Text = fs.readFileSync(wf2Path, "utf8");
const wf2 = JSON.parse(wf2Text);

function node(name) {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `workflow node not found: ${name}`);
  return found;
}

function runCodeNode(name, json) {
  const code = node(name).parameters.jsCode;
  return Function("$json", "URL", code)(json, undefined);
}

function wf3Node(name) {
  const found = wf3.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `WF3 node not found: ${name}`);
  return found;
}

function wf3Targets(name, output = 0) {
  return wf3Connections(name, output).map((connection) => connection.node);
}

function wf3Connections(name, output = 0) {
  return wf3.connections[name]?.main?.[output] || [];
}

function wf2Node(name) {
  const found = wf2.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `WF2 node not found: ${name}`);
  return found;
}

function wf2Targets(name, output = 0) {
  return (wf2.connections[name]?.main?.[output] || []).map(
    (connection) => connection.node,
  );
}

function runWf2CodeNode(name, json, upstream = {}) {
  const code = wf2Node(name).parameters.jsCode;
  const select = (nodeName) => ({
    first: () => ({ json: upstream[nodeName] }),
  });
  return Function("$json", "$", code)(json, select);
}

test("WF4 is inactive on import and exposes the specified GET /check webhook", () => {
  assert.equal(workflow.active, false);
  assert.equal(node("Public Check Webhook").parameters.httpMethod, "GET");
  assert.equal(node("Public Check Webhook").parameters.path, "check");
  assert.equal(
    node("Public Check Webhook").parameters.responseMode,
    "responseNode",
  );
});

test("WF4 proxy preserves the complete public check query string", () => {
  const checkLocation = proxyText.match(
    /location = \/webhook\/check \{[\s\S]*?\n    \}/,
  );
  assert.ok(checkLocation, "WF4 proxy location not found");
  assert.match(
    checkLocation[0],
    /proxy_pass \$upstream\/webhook\/check\$is_args\$args;/,
  );
});

test("WF4 contains no private keys, bearer token values, or hostile URLs", () => {
  assert.doesNotMatch(workflowText, /OWNER_PRIVATE_KEY/);
  assert.doesNotMatch(workflowText, /REPORTER_PRIVATE_KEY/);
  assert.doesNotMatch(workflowText, /CHAIN_BRIDGE_TOKEN/);
  assert.doesNotMatch(workflowText, /https?:\/\/(?!example\.invalid)/i);
});

test("WF4 bridge call uses encrypted Header Auth credentials and the internal URL", () => {
  const bridge = node("Call Internal Chain Bridge");
  assert.equal(bridge.parameters.authentication, "genericCredentialType");
  assert.equal(bridge.parameters.genericAuthType, "httpHeaderAuth");
  assert.match(bridge.parameters.url, /CHAIN_BRIDGE_URL/);
  assert.match(bridge.parameters.url, /internal\/check/);
  assert.equal(bridge.parameters.options.response.response.neverError, true);
  assert.equal(bridge.parameters.options.response.response.fullResponse, true);
  assert.equal(
    bridge.parameters.options.response.response.responseFormat,
    "autodetect",
  );
});

test("WF4 query validation accepts safe URL and wallet inputs", () => {
  const urlResult = runCodeNode("Validate Public Query", {
    query: { type: "url", value: " https://safe-example.invalid/path " },
  });
  assert.deepEqual(urlResult, [
    {
      json: {
        valid: true,
        type: "url",
        value: "https://safe-example.invalid/path",
      },
    },
  ]);

  const walletResult = runCodeNode("Validate Public Query", {
    query: {
      type: "wallet",
      value: "0x000000000000000000000000000000000000dEaD",
    },
  });
  assert.equal(walletResult[0].json.valid, true);
});

test("WF4 query validation rejects unsafe and unexpected inputs", () => {
  const cases = [
    { query: { type: "email", value: "test@example.invalid" } },
    { query: { type: "url", value: "not-a-url" } },
    { query: { type: "url", value: "https://user:pass@example.invalid" } },
    { query: { type: "url", value: "https://example.invalid:70000/path" } },
    { query: { type: "url", value: "https://example.invalid/a path" } },
    { query: { type: "wallet", value: "0x1234" } },
    {
      query: {
        type: "url",
        value: "https://safe-example.invalid",
        internal: "leak",
      },
    },
  ];

  for (const input of cases) {
    const result = runCodeNode("Validate Public Query", input);
    assert.equal(result[0].json.valid, false);
    assert.equal(result[0].json.statusCode, 400);
  }
});

test("WF4 public response code strips all internal bridge fields", () => {
  const result = runCodeNode("Build Public Response", {
    statusCode: 200,
    body: {
      blacklisted: true,
      type: "url",
      normalizedValue: "reported.invalid/claim",
      urlHash: "0xhash",
      category: "fake_airdrop",
      score: 92,
      since: "2026-07-24T16:17:39.000Z",
      reporter: "0x000000000000000000000000000000000000dEaD",
      active: true,
      txHash: "0xtx",
    },
  });

  assert.deepEqual(result, [
    {
      json: {
        statusCode: 200,
        response: {
          blacklisted: true,
          category: "fake_airdrop",
          score: 92,
          since: "2026-07-24T16:17:39.000Z",
          txHash: "0xtx",
        },
      },
    },
  ]);
});

test("WF4 public response code masks internal failures", () => {
  const result = runCodeNode("Build Public Response", {
    statusCode: 502,
    body: {
      error: {
        code: "RPC_INTERNAL_DETAIL",
        message: "sensitive provider detail",
      },
    },
  });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /BLOCKCHAIN_UNAVAILABLE/);
  assert.doesNotMatch(
    serialized,
    /RPC_INTERNAL_DETAIL|sensitive provider detail/,
  );
});

test("WF2 invokes WF3 with exactly its nine-field internal contract", () => {
  const execute = wf2Node("Executer WF3");
  assert.equal(execute.type, "n8n-nodes-base.executeWorkflow");
  assert.equal(execute.parameters.source, "database");
  assert.equal(execute.parameters.workflowId.value, "anti-phishing-wf3-action");
  assert.equal(execute.parameters.mode, "once");
  assert.equal(execute.parameters.options.waitForSubWorkflow, true);
  assert.equal(execute.onError, "continueErrorOutput");

  const result = runWf2CodeNode(
    "Preparer entree WF3",
    {},
    {
      "Valider WF2": {
        reportId: "report-contract",
        type: "url",
        value: "https://safe-example.invalid/path",
        ignored: "must-not-leak",
      },
      "Preparer resultat": {
        verdict: "malicious",
        category: "phishing",
        scoreFinal: 91,
        indicators: ["credential\nform", "", 42, "redirect"],
        internal: "must-not-leak",
      },
    },
  );

  assert.deepEqual(result, [
    {
      json: {
        reportId: "report-contract",
        type: "url",
        value: "https://safe-example.invalid/path",
        verdict: "malicious",
        category: "phishing",
        scoreFinal: 91,
        indicators: ["credential form", "redirect"],
        llmConfidence: null,
        featureScore: null,
      },
    },
  ]);
  assert.deepEqual(Object.keys(result[0].json), [
    "reportId",
    "type",
    "value",
    "verdict",
    "category",
    "scoreFinal",
    "indicators",
    "llmConfidence",
    "featureScore",
  ]);
});

test("WF2 routes only successful URL analyses and wallet reviews to WF3", () => {
  assert.deepEqual(wf2Targets("Journaliser resultat"), ["Preparer entree WF3"]);
  assert.deepEqual(wf2Targets("Journaliser fin alternative"), [
    "Wallet eligible WF3?",
    "Echec a notifier?",
  ]);
  assert.deepEqual(wf2Targets("Wallet eligible WF3?", 0), [
    "Preparer entree WF3",
  ]);
  assert.deepEqual(wf2Targets("Wallet eligible WF3?", 1), []);
  assert.deepEqual(wf2Targets("Preparer entree WF3"), ["Executer WF3"]);
  assert.deepEqual(wf2Targets("Executer WF3", 0), ["Preparer resultat WF3"]);
  assert.deepEqual(wf2Targets("Executer WF3", 1), ["Preparer echec WF3"]);

  const walletGate = JSON.stringify(wf2Node("Wallet eligible WF3?").parameters);
  assert.match(walletGate, /Valider WF2/);
  assert.match(walletGate, /wallet/);
});

test("WF2 journals only safe WF3 terminal fields and fails closed", () => {
  const txHash = `0x${"a".repeat(64)}`;
  const valid = runWf2CodeNode("Preparer resultat WF3", {
    reportId: "report-safe",
    status: "reported",
    txHash,
    error: null,
    claim: { secret: "must-not-leak" },
  });
  assert.deepEqual(valid, [
    {
      json: { status: "reported", txHash, error: null },
    },
  ]);

  const safeFailure = runWf2CodeNode("Preparer resultat WF3", {
    status: "failed",
    txHash: null,
    error: "CHAIN_TIMEOUT",
  });
  assert.deepEqual(safeFailure, [
    {
      json: { status: "failed", txHash: null, error: "CHAIN_TIMEOUT" },
    },
  ]);

  const invalid = runWf2CodeNode("Preparer resultat WF3", {
    status: "unexpected",
    txHash: "0xabc",
    error: "internal detail",
  });
  assert.deepEqual(invalid, [
    {
      json: {
        status: "failed",
        txHash: null,
        error: "WF3_INVALID_RESULT",
      },
    },
  ]);

  const unconfirmed = runWf2CodeNode("Preparer resultat WF3", {
    status: "reported",
    txHash: "0xabc",
    error: "sensitive provider detail",
  });
  assert.deepEqual(unconfirmed, [
    {
      json: {
        status: "failed",
        txHash: null,
        error: "WF3_INVALID_RESULT",
      },
    },
  ]);

  const executionFailure = runWf2CodeNode("Preparer echec WF3", {
    error: "sensitive runtime exception",
  });
  assert.deepEqual(executionFailure, [
    {
      json: {
        status: "failed",
        txHash: null,
        error: "WF3_EXECUTION_FAILED",
      },
    },
  ]);

  for (const source of ["Preparer resultat WF3", "Preparer echec WF3"]) {
    assert.deepEqual(wf2Targets(source), ["Journaliser resultat WF3"]);
  }
  const journal = wf2Node("Journaliser resultat WF3");
  assert.equal(journal.parameters.authentication, "genericCredentialType");
  assert.equal(journal.parameters.genericAuthType, "httpHeaderAuth");
  assert.match(journal.parameters.url, /Valider WF2/);
  assert.deepEqual(journal.credentials.httpHeaderAuth, {
    id: "REPLACE_WITH_BRIDGE_SHARED_SECRET_CREDENTIAL_ID",
    name: "Bridge Shared Secret",
  });
});

test("WF3 imports inactive and can only be called as an internal sub-workflow", () => {
  assert.equal(wf3.active, false);
  assert.equal(
    wf3Node("When Called by WF2").type,
    "n8n-nodes-base.executeWorkflowTrigger",
  );
  assert.equal(
    wf3Node("When Called by WF2").parameters.inputSource,
    "passthrough",
  );
  assert.equal(
    wf3.nodes.some((candidate) => candidate.type === "n8n-nodes-base.webhook"),
    false,
  );
  assert.equal(
    wf3.nodes.some(
      (candidate) => candidate.type === "n8n-nodes-base.executeCommand",
    ),
    false,
  );
});

test("WF3 export contains no secrets, private keys, or Discord webhook URL", () => {
  assert.doesNotMatch(wf3Text, /OWNER_PRIVATE_KEY|REPORTER_PRIVATE_KEY/);
  assert.doesNotMatch(wf3Text, /CHAIN_BRIDGE_TOKEN/);
  assert.doesNotMatch(wf3Text, /discord(?:app)?\.com\/api\/webhooks/i);
  assert.doesNotMatch(wf3Text, /https?:\/\//i);
  assert.doesNotMatch(wf3Text, /Bearer\s+[A-Za-z0-9._~+\/-]{16,}/i);
});

test("every WF3 bridge call uses the encrypted Header Auth credential", () => {
  const expectedRoutes = new Map([
    ["Execute Secured WF3", "/internal/wf3/execute"],
    ["Claim Final Alert", "/internal/wf3/claim"],
    ["Settle Final Alert", "/internal/wf3/settle"],
  ]);

  for (const [name, route] of expectedRoutes) {
    const bridge = wf3Node(name);
    assert.equal(bridge.parameters.authentication, "genericCredentialType");
    assert.equal(bridge.parameters.genericAuthType, "httpHeaderAuth");
    assert.match(bridge.parameters.url, /CHAIN_BRIDGE_URL/);
    assert.match(
      bridge.parameters.url,
      new RegExp(route.replaceAll("/", "\\/")),
    );
    assert.equal(
      bridge.parameters.options.response.response.responseFormat,
      "autodetect",
      `${name} doit resoudre la reponse JSON d'un body raw`,
    );
    assert.deepEqual(bridge.credentials.httpHeaderAuth, {
      id: "REPLACE_WITH_CHAIN_BRIDGE_CREDENTIAL_ID",
      name: "Chain Bridge Header Auth",
    });
  }

  const executeBody = wf3Node("Execute Secured WF3").parameters.body;
  assert.match(executeBody, /executionId/);
  assert.match(executeBody, /\$execution\.id/);
  assert.match(wf3Node("Claim Final Alert").parameters.body, /\$execution\.id/);
});

test("WF3 wiring cannot reach Discord without a persisted winning claim", () => {
  assert.deepEqual(wf3Targets("When Called by WF2"), ["Execute Secured WF3"]);
  assert.deepEqual(wf3Targets("Execute Secured WF3"), [
    "Final Alert Required?",
  ]);
  assert.deepEqual(wf3Targets("Final Alert Required?", 0), [
    "Claim Final Alert",
  ]);
  assert.deepEqual(wf3Targets("Final Alert Required?", 1), [
    "Build WF3 Result",
  ]);
  assert.deepEqual(wf3Targets("Claim Final Alert"), ["Dispatch Authorized?"]);
  assert.deepEqual(wf3Targets("Dispatch Authorized?", 0), ["Alerts Channel?"]);
  assert.deepEqual(wf3Targets("Dispatch Authorized?", 1), ["Build WF3 Result"]);
  assert.deepEqual(wf3Targets("Alerts Channel?", 0), ["Send Alerts Discord"]);
  assert.deepEqual(wf3Targets("Alerts Channel?", 1), [
    "Send Manual Review Discord",
  ]);

  assert.equal(
    wf3.nodes.some((candidate) => candidate.type === "n8n-nodes-base.merge"),
    false,
  );

  const claimBody = wf3Node("Claim Final Alert").parameters.body;
  for (const field of [
    "reportId",
    "type",
    "value",
    "verdict",
    "category",
    "scoreFinal",
    "indicators",
  ]) {
    assert.match(
      claimBody,
      new RegExp(
        `\\$\\('When Called by WF2'\\)\\.first\\(\\)\\.json\\.${field}`,
      ),
    );
  }
});

test("WF3 Discord nodes use separate encrypted credentials and safe bridge output", () => {
  const alerts = wf3Node("Send Alerts Discord");
  const manual = wf3Node("Send Manual Review Discord");

  for (const discord of [alerts, manual]) {
    assert.equal(discord.parameters.authentication, "webhook");
    assert.equal(discord.parameters.operation, "sendLegacy");
    assert.equal(discord.parameters.options.wait, true);
    assert.equal(discord.onError, "continueRegularOutput");
    const parameters = JSON.stringify(discord.parameters);
    assert.match(parameters, /\$json\.discord/);
    assert.doesNotMatch(
      parameters,
      /When Called by WF2|\$json\.reportId|\$json\.value|\$json\.indicators/,
    );
  }

  assert.notEqual(
    alerts.credentials.discordWebhookApi.id,
    manual.credentials.discordWebhookApi.id,
  );
  assert.match(alerts.credentials.discordWebhookApi.id, /REPLACE_WITH_/);
  assert.match(manual.credentials.discordWebhookApi.id, /REPLACE_WITH_/);
});

test("WF3 always classifies Discord delivery and settles the exact claim", () => {
  assert.deepEqual(wf3Targets("Send Alerts Discord"), [
    "Classify Discord Outcome",
  ]);
  assert.deepEqual(wf3Targets("Send Manual Review Discord"), [
    "Classify Discord Outcome",
  ]);
  assert.deepEqual(wf3Targets("Classify Discord Outcome"), [
    "Settle Final Alert",
  ]);
  assert.deepEqual(wf3Targets("Settle Final Alert"), ["Build WF3 Result"]);

  const classify = wf3Node("Classify Discord Outcome").parameters.jsCode;
  assert.deepEqual(Function("$json", classify)({ id: "123456789012345678" }), [
    { json: { outcome: "sent" } },
  ]);
  assert.deepEqual(Function("$json", classify)({ id: "discord-message" }), [
    { json: { outcome: "uncertain" } },
  ]);
  assert.deepEqual(Function("$json", classify)({}), [
    { json: { outcome: "uncertain" } },
  ]);
  assert.deepEqual(Function("$json", classify)({ error: "timeout" }), [
    { json: { outcome: "uncertain" } },
  ]);

  const settleBody = wf3Node("Settle Final Alert").parameters.body;
  assert.match(
    settleBody,
    /\$\('Claim Final Alert'\)\.first\(\)\.json\.reportId/,
  );
  assert.match(settleBody, /\$\('Claim Final Alert'\)\.first\(\)\.json\.claim/);
  assert.match(settleBody, /\$json\.outcome/);
  assert.match(settleBody, /claim/);
  assert.match(settleBody, /outcome/);

  const resultCode = wf3Node("Build WF3 Result").parameters.jsCode;
  assert.match(resultCode, /Execute Secured WF3/);
  assert.match(resultCode, /reportId/);
  assert.match(resultCode, /status/);
  assert.match(resultCode, /txHash/);
  assert.match(resultCode, /errorCode/);
});
