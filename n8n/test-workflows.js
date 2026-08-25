#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowDir = path.resolve(__dirname, "workflows");
const files = ["WF1_Ingestion.json", "WF1_Form.json", "WF2_Analyse.json"];
const workflows = files.map((file) => JSON.parse(fs.readFileSync(path.join(workflowDir, file), "utf8")));

for (const workflow of workflows) {
  assert.equal(workflow.active, false, `${workflow.name} doit etre importe inactif`);
  const names = new Set(workflow.nodes.map((node) => node.name));
  assert.equal(names.size, workflow.nodes.length, `${workflow.name} contient des noms de nodes dupliques`);
  assert.ok(workflow.nodes.every((node) => node.type !== "n8n-nodes-base.executeCommand"), "Execute Command est interdit par RF-N13");

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `connexion source inconnue : ${source}`);
    for (const output of outputs.main) {
      for (const connection of output) assert.ok(names.has(connection.node), `connexion cible inconnue : ${connection.node}`);
    }
  }
}

const ingestion = workflows[0];
const webhook = ingestion.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
assert.equal(webhook.parameters.httpMethod, "POST");
assert.equal(webhook.parameters.path, "report");
assert.ok(ingestion.nodes.some((node) => node.name === "Bridge check" && node.parameters.url === "http://bridge:8787/check"));
assert.ok(ingestion.nodes.some((node) => node.name === "Journaliser queued" && node.parameters.url === "http://bridge:8787/reports"));
assert.ok(ingestion.nodes.some((node) => node.name === "Repondre 202" && node.parameters.options.responseCode === 202));
assert.ok(ingestion.nodes.some((node) => node.name === "Repondre 409" && node.parameters.options.responseCode === 409));
assert.ok(ingestion.nodes.some((node) => node.name === "Lancer WF2" && node.parameters.url.includes("internal-wf2-analyze")));

const wf2 = workflows[2];
assert.ok(wf2.nodes.some((node) => node.name === "Capture securisee" && node.parameters.url === "http://capture:8788/capture"));
assert.ok(wf2.nodes.some((node) => node.name === "Analyse Gemini NVIDIA" && node.parameters.url === "http://analysis:8789/analyze"));
assert.ok(wf2.nodes.some((node) => node.name === "Statut analyzing"));
assert.ok(wf2.nodes.some((node) => node.name === "Preparer echec"));

const serialized = JSON.stringify(workflows);
assert.ok(!serialized.includes("OWNER_PRIVATE_KEY"));
assert.ok(!serialized.includes("REPORTER_PRIVATE_KEY"));
assert.ok(!/[a-f0-9]{64}/i.test(serialized), "aucun secret hexadecimal ne doit etre exporte dans les workflows");

// RF-S7/RF-N13 : le secret bridge passe par une credential n8n chiffree,
// jamais par un acces $env depuis un node (Code ou expression).
assert.ok(!serialized.includes("$env.BRIDGE_SHARED_SECRET"), "aucun node WF1/WF2 ne doit lire BRIDGE_SHARED_SECRET via $env");
const httpNodesNeedingAuth = ["Lancer WF2", "Bridge check", "Journaliser queued", "Statut analyzing", "Capture securisee", "Analyse Gemini NVIDIA", "Journaliser resultat", "Journaliser fin alternative"];
for (const workflow of workflows) {
  for (const node of workflow.nodes) {
    if (!httpNodesNeedingAuth.includes(node.name)) continue;
    assert.equal(node.parameters.authentication, "genericCredentialType", `${node.name} doit utiliser une credential generique`);
    assert.equal(node.parameters.genericAuthType, "httpHeaderAuth", `${node.name} doit utiliser Header Auth`);
    assert.equal(node.credentials?.httpHeaderAuth?.name, "Bridge Shared Secret", `${node.name} doit referencer la credential Bridge Shared Secret`);
  }
}
const wf2Webhook = wf2.nodes.find((node) => node.name === "Declencheur WF2");
assert.equal(wf2Webhook.parameters.authentication, "headerAuth", "le declencheur interne WF2 doit exiger un Header Auth n8n natif");
assert.equal(wf2Webhook.credentials?.httpHeaderAuth?.name, "Bridge Shared Secret");

console.log("WF1/WF2 workflows: 19/19 controles statiques passes.");
