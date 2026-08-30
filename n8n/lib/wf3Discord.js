"use strict";

const {
  ALERT_KINDS,
  ALERT_STATES,
  STATUSES,
  authorizeFinalAlertDispatch,
  validateLifecycle,
} = require("./wf3Lifecycle");
const { decideWf3Action } = require("./wf3Decision");
const {
  BridgeValidationError,
  validateCheckPayload,
} = require("../services/chain-bridge/validation");

const AMOY_TRANSACTION_URL = "https://amoy.polygonscan.com/tx/";
const MAX_DISCORD_CONTENT_LENGTH = 2_000;
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_TEXT_LENGTH = 6_000;
const MAX_FIELD_NAME_LENGTH = 256;
const MAX_FIELD_VALUE_LENGTH = 1_024;
const MAX_EMBED_FIELDS = 10;
const DISPLAYED_INDICATORS = 3;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const DISCORD_MARKDOWN = /([\\`*_{}\[\]()#+\-.!|>~])/g;
const DISCORD_MENTION = /@/g;
const CONTEXT_FIELDS = Object.freeze([
  "reportId",
  "type",
  "value",
  "verdict",
  "category",
  "scoreFinal",
  "indicators",
]);
const OPTIONAL_CONTEXT_FIELDS = Object.freeze([
  "llmConfidence",
  "featureScore",
]);
const REQUEST_FIELDS = Object.freeze(["lifecycle", "claim", "context"]);
const CLAIM_FIELDS = Object.freeze(["claimId", "claimRevision"]);

const ALERT_PRESENTATION = Object.freeze({
  [STATUSES.MANUAL_REVIEW]: Object.freeze({
    channel: "manual_review",
    title: "Manual review required",
    color: 0xf59e0b,
    publication: "Not published on-chain",
  }),
  [STATUSES.REPORTED]: Object.freeze({
    channel: "alerts",
    title: "Threat confirmed on-chain",
    color: 0xdc2626,
    publication: "Published and confirmed on Polygon Amoy",
  }),
  [STATUSES.ALREADY_BLACKLISTED]: Object.freeze({
    channel: "alerts",
    title: "Threat already registered on-chain",
    color: 0x7c3aed,
    publication: "Existing Polygon Amoy registration confirmed",
  }),
  [STATUSES.FAILED]: Object.freeze({
    channel: "manual_review",
    title: "Anti-phishing pipeline failed",
    color: 0x6b7280,
    publication: "Not confirmed as published",
  }),
});

class Wf3DiscordValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "Wf3DiscordValidationError";
    this.code = "WF3_DISCORD_VALIDATION_ERROR";
  }
}

function fail(message) {
  throw new Wf3DiscordValidationError(message);
}

function assertExactObject(value, fields, label, optionalFields = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const allowed = new Set([...fields, ...optionalFields]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown.length > 0 || missing.length > 0) {
    fail(`${label} must contain exactly its allowed fields.`);
  }
}

function validateClaim(value) {
  assertExactObject(value, CLAIM_FIELDS, "claim");
  if (
    typeof value.claimId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value.claimId)
  ) {
    fail("claim.claimId is invalid.");
  }
  if (!Number.isSafeInteger(value.claimRevision) || value.claimRevision < 1) {
    fail("claim.claimRevision is invalid.");
  }
  return Object.freeze({
    claimId: value.claimId,
    claimRevision: value.claimRevision,
  });
}

function validateContext(value) {
  assertExactObject(value, CONTEXT_FIELDS, "context", OPTIONAL_CONTEXT_FIELDS);

  let target;
  try {
    target = validateCheckPayload({ type: value.type, value: value.value });
  } catch (error) {
    if (error instanceof BridgeValidationError) fail(error.message);
    throw error;
  }

  if (typeof value.reportId !== "string") {
    fail("context.reportId is invalid.");
  }

  const hasAnalysis = value.verdict !== null;
  if (!hasAnalysis) {
    if (
      value.category !== null ||
      value.scoreFinal !== null ||
      !Array.isArray(value.indicators) ||
      value.indicators.length !== 0
    ) {
      fail(
        "An unavailable analysis requires null result fields and no indicators.",
      );
    }
    return Object.freeze({
      reportId: value.reportId,
      ...target,
      verdict: null,
      category: null,
      scoreFinal: null,
      indicators: Object.freeze([]),
      decision: null,
      llmConfidence: null,
      featureScore: null,
    });
  }

  let decision;
  try {
    decision = decideWf3Action(value);
  } catch {
    fail("context contains an invalid WF3 analysis result.");
  }
  return Object.freeze({
    reportId: decision.reportId,
    type: decision.type,
    value: decision.value,
    verdict: decision.verdict,
    category: decision.category,
    scoreFinal: decision.scoreFinal,
    indicators: Object.freeze([...decision.discordIndicators]),
    decision: decision.action,
    llmConfidence: decision.llmConfidence,
    featureScore: decision.featureScore,
  });
}

function validateAlertConsistency(lifecycle, context) {
  if (context.reportId !== lifecycle.reportId) {
    fail("context.reportId must match lifecycle.reportId.");
  }
  if (
    lifecycle.alert.state !== ALERT_STATES.CLAIMED ||
    !lifecycle.finalized ||
    lifecycle.alert.required !== true
  ) {
    fail("A final Discord payload requires a claimed finalized lifecycle.");
  }

  if (lifecycle.status === STATUSES.MANUAL_REVIEW) {
    if (
      lifecycle.alert.kind !== ALERT_KINDS.MANUAL_REVIEW ||
      context.decision !== "manual_review"
    ) {
      fail("Manual-review lifecycle and decision are inconsistent.");
    }
    return;
  }

  if (
    lifecycle.status === STATUSES.REPORTED ||
    lifecycle.status === STATUSES.ALREADY_BLACKLISTED
  ) {
    if (
      lifecycle.alert.kind !== ALERT_KINDS.CHAIN_RESULT ||
      context.decision !== "report" ||
      !lifecycle.txHash
    ) {
      fail("Chain-result lifecycle and decision are inconsistent.");
    }
    return;
  }

  if (lifecycle.status === STATUSES.FAILED) {
    if (
      lifecycle.alert.kind !== ALERT_KINDS.PIPELINE_FAILURE ||
      (context.decision !== null && context.decision !== lifecycle.decision)
    ) {
      fail("Failed lifecycle and decision are inconsistent.");
    }
    return;
  }

  fail("Lifecycle status cannot produce a final Discord payload.");
}

function neutralizeText(value) {
  return String(value)
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(DISCORD_MENTION, "＠")
    .replace(DISCORD_MARKDOWN, "\\$1")
    .trim();
}

function defangEmbeddedLinks(value) {
  return String(value)
    .replace(/https:\/\//gi, "hxxps://")
    .replace(/http:\/\//gi, "hxxp://")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (address) =>
      address.replace(/\./g, "[.]"),
    )
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/gi, (hostname) =>
      hostname.replace(/\./g, "[.]"),
    );
}

function defangUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("URL could not be defanged.");
  }

  const scheme = parsed.protocol === "https:" ? "hxxps" : "hxxp";
  let hostname = parsed.hostname.replace(/\./g, "[.]");
  if (hostname.includes(":")) hostname = `[${hostname}]`;
  const port = parsed.port ? `:${parsed.port}` : "";
  const pathAndQuery = defangEmbeddedLinks(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
  );
  return `${scheme}://${hostname}${port}${pathAndQuery}`;
}

function defangTarget(type, value) {
  if (type === "url") return neutralizeText(defangUrl(value));
  return neutralizeText(value);
}

function bounded(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(`${label} exceeds the Discord field limit.`);
  }
  return value;
}

function boundedFieldValue(value) {
  if (typeof value !== "string" || value.length < 1) {
    fail("Discord field value must not be empty.");
  }
  if (value.length <= MAX_FIELD_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_FIELD_VALUE_LENGTH - 1)}…`;
}

function field(name, value, inline = false) {
  return Object.freeze({
    name: bounded(name, MAX_FIELD_NAME_LENGTH, "Field name"),
    value: boundedFieldValue(value),
    inline,
  });
}

function formatScore(scoreFinal) {
  return scoreFinal === null
    ? "Unavailable"
    : `${Math.round(scoreFinal * 100)}%`;
}

function formatCategory(category) {
  return category === null ? "Not assigned" : neutralizeText(category);
}

// Explication en langage simple, construite exclusivement a partir de valeurs
// numeriques typees et de phrases fixes : aucun texte libre du modele n'entre
// ici, le durcissement anti-injection Discord reste donc intact.
function explainScore(context) {
  if (
    context.decision !== "manual_review" ||
    typeof context.llmConfidence !== "number" ||
    typeof context.featureScore !== "number" ||
    typeof context.scoreFinal !== "number"
  ) {
    return null;
  }

  const confidencePercent = Math.round(context.llmConfidence * 100);
  const scorePercent = Math.round(context.scoreFinal * 100);
  const gapPoints = Math.max(0, 80 - scorePercent);

  const sentences = [];

  if (context.verdict === "malicious") {
    if (context.llmConfidence >= 0.9) {
      sentences.push(
        `The AI is very confident this target is malicious (${confidencePercent}%).`,
      );
    } else if (context.llmConfidence >= 0.7) {
      sentences.push(
        `The AI thinks this target is malicious but is not certain (${confidencePercent}%).`,
      );
    } else {
      sentences.push(
        `The AI leans toward malicious with low certainty (${confidencePercent}%).`,
      );
    }
  } else {
    sentences.push(
      `The AI could not decide between malicious and legitimate (confidence ${confidencePercent}%).`,
    );
  }

  if (context.featureScore < 0.2) {
    sentences.push("The automatic URL checks found few known red flags.");
  } else if (context.featureScore < 0.5) {
    sentences.push(
      "The automatic URL checks found some suspicious traits, but not enough to be conclusive.",
    );
  } else {
    sentences.push(
      "The URL itself also looks suspicious to the automatic checks.",
    );
  }

  if (context.verdict === "malicious" && context.category === "other") {
    sentences.push(
      "This looks like a classic scam rather than a crypto attack, and the automatic checks are tuned for crypto threats \u2014 which lowers the combined score.",
    );
  }

  sentences.push(
    `Combined score: ${scorePercent}% \u2014 ${gapPoints} point${gapPoints === 1 ? "" : "s"} short of the 80% needed for automatic on-chain publication.`,
  );

  const strongAiWeakFeatures =
    context.verdict === "malicious" &&
    context.llmConfidence >= 0.9 &&
    context.featureScore < 0.2;
  const suggestion = strongAiWeakFeatures
    ? "The AI verdict is strong; this is likely safe to confirm as fraud after a quick look."
    : "Signals are mixed \u2014 this one needs a careful human check.";

  return `${sentences.join("\n")}\n\n**Suggested action:** ${suggestion}`;
}

function formatIndicators(indicators) {
  if (indicators.length === 0) return "None available";
  return indicators
    .slice(0, DISPLAYED_INDICATORS)
    .map(
      (indicator, index) =>
        `${index + 1}. ${neutralizeText(defangEmbeddedLinks(indicator))}`,
    )
    .join("\n");
}

function formatTransaction(lifecycle) {
  if (!lifecycle.txHash) return "Not available — no confirmed transaction";
  const url = `${AMOY_TRANSACTION_URL}${lifecycle.txHash}`;
  return `[${lifecycle.txHash}](${url})`;
}

function embedTextLength(embed) {
  return (
    embed.title.length +
    embed.footer.text.length +
    embed.fields.reduce(
      (total, entry) => total + entry.name.length + entry.value.length,
      0,
    )
  );
}

function freezePayload(payload) {
  const embed = payload.discord.embeds[0];
  const frozenEmbed = Object.freeze({
    ...embed,
    fields: Object.freeze(embed.fields.map((entry) => Object.freeze(entry))),
    footer: Object.freeze({ ...embed.footer }),
  });
  return Object.freeze({
    channel: payload.channel,
    discord: Object.freeze({
      ...payload.discord,
      allowed_mentions: Object.freeze({
        parse: Object.freeze([]),
        users: Object.freeze([]),
        roles: Object.freeze([]),
        replied_user: false,
      }),
      embeds: Object.freeze([frozenEmbed]),
    }),
  });
}

function buildFinalDiscordPayload(input) {
  assertExactObject(input, REQUEST_FIELDS, "Discord request");

  let lifecycle;
  try {
    lifecycle = validateLifecycle(input.lifecycle);
  } catch {
    fail("lifecycle is invalid.");
  }
  const claim = validateClaim(input.claim);
  if (!authorizeFinalAlertDispatch(lifecycle, claim)) {
    fail("The persisted lifecycle does not authorize this alert claim.");
  }

  const context = validateContext(input.context);
  validateAlertConsistency(lifecycle, context);
  const presentation = ALERT_PRESENTATION[lifecycle.status];
  if (!presentation) fail("Lifecycle status has no Discord presentation.");

  const fields = [
    field("Target", defangTarget(context.type, context.value)),
    field(
      "Verdict",
      context.verdict === null
        ? "Unavailable"
        : neutralizeText(context.verdict),
      true,
    ),
    field("Category", formatCategory(context.category), true),
    field("Score", formatScore(context.scoreFinal), true),
  ];
  if (lifecycle.status === STATUSES.MANUAL_REVIEW) {
    const explanation = explainScore(context);
    if (explanation !== null) {
      fields.push(field("Why manual review?", explanation));
    }
  }
  fields.push(
    field("Indicators", formatIndicators(context.indicators)),
    field("Publication", presentation.publication),
    field("Transaction", formatTransaction(lifecycle)),
    field("Report ID", neutralizeText(lifecycle.reportId), true),
    field("Timestamp", lifecycle.updatedAt, true),
  );
  if (lifecycle.errorCode) {
    fields.push(field("Technical code", lifecycle.errorCode, true));
  }
  if (fields.length > MAX_EMBED_FIELDS) {
    fail("Discord embed has too many fields.");
  }

  const payload = {
    channel: presentation.channel,
    discord: {
      content: "",
      username: "Anti-Phishing Web3",
      allowed_mentions: {
        parse: [],
        users: [],
        roles: [],
        replied_user: false,
      },
      embeds: [
        {
          title: bounded(
            presentation.title,
            MAX_EMBED_TITLE_LENGTH,
            "Embed title",
          ),
          color: presentation.color,
          fields,
          footer: { text: "Polygon Amoy · automated security signal" },
          timestamp: lifecycle.updatedAt,
        },
      ],
    },
  };

  if (payload.discord.content.length > MAX_DISCORD_CONTENT_LENGTH) {
    fail("Discord content exceeds its limit.");
  }
  if (embedTextLength(payload.discord.embeds[0]) > MAX_EMBED_TEXT_LENGTH) {
    fail("Discord embed exceeds its total text limit.");
  }
  return freezePayload(payload);
}

module.exports = {
  AMOY_TRANSACTION_URL,
  DISPLAYED_INDICATORS,
  MAX_EMBED_FIELDS,
  Wf3DiscordValidationError,
  buildFinalDiscordPayload,
  defangTarget,
  explainScore,
  neutralizeText,
};
