"use strict";

const { normalizeUrl, normalizeWallet } = require("../../../scripts/lib/registry");

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function assertObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", "Le corps JSON doit etre un objet.");
  }
}

function rejectUnexpectedFields(value, allowedFields) {
  const unexpected = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unexpected.length > 0) {
    throw new HttpError(400, "unexpected_fields", `Champs inattendus : ${unexpected.join(", ")}.`);
  }
}

function validateCheckRequest(value) {
  assertObject(value);
  rejectUnexpectedFields(value, new Set(["type", "value"]));

  if (value.type !== "url" && value.type !== "wallet") {
    throw new HttpError(400, "invalid_type", "type doit etre exactement 'url' ou 'wallet'.");
  }
  if (typeof value.value !== "string" || value.value.length === 0 || value.value.length > 2048) {
    throw new HttpError(400, "invalid_value", "value doit etre une chaine non vide de 2048 caracteres maximum.");
  }

  try {
    if (value.type === "url") normalizeUrl(value.value);
    else normalizeWallet(value.value);
  } catch (error) {
    throw new HttpError(400, "invalid_value", error.message);
  }

  return { type: value.type, value: value.value };
}

function validateReportRecord(value) {
  assertObject(value);
  rejectUnexpectedFields(value, new Set(["reportId", "createdAt", "type", "valueDefanged", "status"]));

  if (typeof value.reportId !== "string" || !/^r_\d{8}T\d{6}Z_[A-Za-z0-9_-]{1,64}$/.test(value.reportId)) {
    throw new HttpError(400, "invalid_report_id", "reportId est invalide.");
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new HttpError(400, "invalid_created_at", "createdAt doit etre une date ISO valide.");
  }
  if (value.type !== "url" && value.type !== "wallet") {
    throw new HttpError(400, "invalid_type", "type doit etre exactement 'url' ou 'wallet'.");
  }
  if (typeof value.valueDefanged !== "string" || value.valueDefanged.length === 0 || value.valueDefanged.length > 2100) {
    throw new HttpError(400, "invalid_value", "valueDefanged doit etre une chaine non vide.");
  }
  if (value.status !== "queued") {
    throw new HttpError(400, "invalid_status", "WF1 accepte uniquement le statut queued.");
  }

  return {
    reportId: value.reportId,
    createdAt: new Date(value.createdAt).toISOString(),
    type: value.type,
    valueDefanged: value.valueDefanged,
    status: "queued",
    verdict: null,
    scoreFinal: null,
    modelUsed: null,
    category: null,
    indicators: [],
    txHash: null,
    error: null,
    decision: null,
  };
}

const REPORT_STATUSES = new Set(["queued", "analyzing", "manual_review", "reporting", "reported", "already_blacklisted", "failed"]);
const VERDICTS = new Set(["malicious", "suspicious", "legitimate", null]);
const DECISIONS = new Set(["reporting", "manual_review", "logged_only", null]);

function validateReportUpdate(value) {
  assertObject(value);
  const allowed = new Set(["status", "verdict", "scoreFinal", "modelUsed", "category", "indicators", "txHash", "error", "decision"]);
  rejectUnexpectedFields(value, allowed);
  if (Object.keys(value).length === 0) throw new HttpError(400, "empty_update", "La mise a jour est vide.");
  if (value.status !== undefined && !REPORT_STATUSES.has(value.status)) throw new HttpError(400, "invalid_status", "Statut RF-N10 invalide.");
  if (value.verdict !== undefined && !VERDICTS.has(value.verdict)) throw new HttpError(400, "invalid_verdict", "Verdict invalide.");
  if (value.decision !== undefined && !DECISIONS.has(value.decision)) throw new HttpError(400, "invalid_decision", "Decision invalide.");
  if (value.scoreFinal !== undefined && value.scoreFinal !== null && (typeof value.scoreFinal !== "number" || value.scoreFinal < 0 || value.scoreFinal > 1)) throw new HttpError(400, "invalid_score", "scoreFinal doit etre compris entre 0 et 1.");
  for (const field of ["modelUsed", "category", "txHash", "error"]) {
    if (value[field] !== undefined && value[field] !== null && (typeof value[field] !== "string" || value[field].length > 1000)) throw new HttpError(400, `invalid_${field}`, `${field} est invalide.`);
  }
  if (value.indicators !== undefined && (!Array.isArray(value.indicators) || value.indicators.length > 10 || value.indicators.some((item) => typeof item !== "string" || item.length > 200))) throw new HttpError(400, "invalid_indicators", "indicators est invalide.");
  return { ...value };
}

module.exports = { HttpError, REPORT_STATUSES, validateCheckRequest, validateReportRecord, validateReportUpdate };
