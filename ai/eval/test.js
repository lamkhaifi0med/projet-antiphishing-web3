"use strict";

// Tests unitaires purs pour ai/eval/evaluate.js (RF-A9) : matrice de
// confusion, métriques, et couverture. Aucun réseau, aucune LLM.

const assert = require("node:assert/strict");
const { classificationOutcome, computeCoverage, metricsFromMatrix, updateMatrix, emptyMatrix } = require("./evaluate");

function testClassificationOutcome() {
  assert.equal(classificationOutcome(true, "phishing"), "TP");
  assert.equal(classificationOutcome(true, "legitimate"), "FP");
  assert.equal(classificationOutcome(false, "phishing"), "FN");
  assert.equal(classificationOutcome(false, "legitimate"), "TN");
}

function testMetricsFromMatrix() {
  const matrix = emptyMatrix();
  updateMatrix(matrix, "TP");
  updateMatrix(matrix, "TP");
  updateMatrix(matrix, "FN");
  updateMatrix(matrix, "TN");
  const metrics = metricsFromMatrix(matrix);
  assert.equal(metrics.n, 4);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 2 / 3);
  assert.ok(Math.abs(metrics.f1 - 0.8) < 1e-9);
}

function testMetricsFromMatrixHandlesZeroDenominators() {
  const metrics = metricsFromMatrix(emptyMatrix());
  assert.equal(metrics.precision, null);
  assert.equal(metrics.recall, null);
  assert.equal(metrics.f1, null);
}

// REVIEW_COMMIT_57747F0.md §5 : le rapport doit exposer la couverture
// reelle par label, pas seulement un compte global qui peut cacher un
// desequilibre phishing/legitime.
function testComputeCoverageByLabel() {
  const entries = [
    { url: "a", label: "phishing" },
    { url: "b", label: "phishing" },
    { url: "c", label: "phishing" },
    { url: "d", label: "legitimate" },
  ];
  const outcomes = [
    { url: "a", label: "phishing" },
    { url: "d", label: "legitimate" },
  ];
  const coverage = computeCoverage(entries, outcomes);
  assert.deepEqual(coverage.overall, { total: 4, measured: 2 });
  assert.deepEqual(coverage.phishing, { total: 3, measured: 1 });
  assert.deepEqual(coverage.legitimate, { total: 1, measured: 1 });
}

const tests = [
  ["classificationOutcome couvre les 4 quadrants TP/FP/FN/TN", testClassificationOutcome],
  ["metricsFromMatrix calcule precision/rappel/F1 corrects", testMetricsFromMatrix],
  ["metricsFromMatrix renvoie null sur denominateur nul, jamais NaN/Infinity", testMetricsFromMatrixHandlesZeroDenominators],
  ["computeCoverage separe la couverture par label reel", testComputeCoverageByLabel],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL - ${name}`);
    console.log(`         ${error.message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} tests passés.`);
if (failed > 0) process.exitCode = 1;
