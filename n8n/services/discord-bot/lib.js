"use strict";

// Logique pure et testable du bot Discord de resolution manual-review.
// Aucune dependance externe : le bot utilise fetch et WebSocket natifs de
// Node 22. Ce module ne parle jamais directement a Discord ; il construit
// des payloads et orchestre les appels bridge/chain-bridge injectes.

const ADMINISTRATOR_PERMISSION = 0x8n;
const CUSTOM_ID_PATTERN =
  /^resolve:(confirm|dismiss):(r_\d{8}T\d{6}Z_[A-Za-z0-9_-]{1,64})$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const POLYGONSCAN_TX = "https://amoy.polygonscan.com/tx/";

// Inverse exact du defang WF1 (`value.replace(/^http/i,'hxxp').replace(/\./g,'[.]')`).
// Les wallets ne sont jamais defanges.
function refangValue(type, valueDefanged) {
  if (type !== "url") return valueDefanged;
  return valueDefanged.replace(/^hxxp/i, "http").replace(/\[\.\]/g, ".");
}

// Autorisation : role explicite si configure, sinon permission Administrator
// du bitfield Discord (chaine decimale dans interaction.member.permissions).
function isAuthorizedInteraction(interaction, adminRoleId) {
  const member = interaction?.member;
  if (!member) return false;
  if (adminRoleId) {
    return Array.isArray(member.roles) && member.roles.includes(adminRoleId);
  }
  if (
    typeof member.permissions !== "string" ||
    !/^\d+$/.test(member.permissions)
  ) {
    return false;
  }
  return (BigInt(member.permissions) & ADMINISTRATOR_PERMISSION) !== 0n;
}

function parseCustomId(customId) {
  const match =
    typeof customId === "string" ? customId.match(CUSTOM_ID_PATTERN) : null;
  if (!match) return null;
  return Object.freeze({ action: match[1], reportId: match[2] });
}

// Filtre les enregistrements du journal a poster : manual_review uniquement,
// jamais deja postes.
function selectNewManualReviews(records, postedIds) {
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record) =>
      record &&
      record.status === "manual_review" &&
      typeof record.reportId === "string" &&
      !postedIds.has(record.reportId),
  );
}

// Message Discord avec boutons. valueDefanged est deja defangee par WF1 ;
// on la borne et neutralise les mentions par principe.
function neutralize(text) {
  return String(text ?? "")
    .replace(/@/g, "@\u200b")
    .slice(0, 512);
}

function formatIndicators(indicators) {
  if (!Array.isArray(indicators) || indicators.length === 0) return null;
  return indicators
    .slice(0, 3)
    .map((indicator, index) => `${index + 1}. ${neutralize(indicator)}`)
    .join("\n")
    .slice(0, 1024);
}

// Copie fidele de explainScore (n8n/lib/wf3Discord.js) : memes phrases que
// l'alerte WF3 historique. Dupliquee ici pour garder l'image du bot
// autonome (wf3Discord tire wf3Decision et scripts/lib/registry).
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

function buildReviewMessage(record) {
  const score =
    typeof record.scoreFinal === "number"
      ? `${Math.round(record.scoreFinal * 100)}/100`
      : "n/a";
  const extraFields = [];
  if (record.verdict) {
    extraFields.push({
      name: "Verdict IA",
      value: neutralize(record.verdict),
      inline: true,
    });
  }
  const indicators = formatIndicators(record.indicators);
  if (indicators) {
    extraFields.push({ name: "Indicateurs", value: indicators, inline: false });
  }
  const explanation = explainScore({
    decision: "manual_review",
    verdict: record.verdict ?? null,
    category: record.category ?? null,
    llmConfidence: record.llmConfidence,
    featureScore: record.featureScore,
    scoreFinal: record.scoreFinal,
  });
  if (explanation !== null) {
    extraFields.push({
      name: "Why manual review?",
      value: explanation.slice(0, 1024),
      inline: false,
    });
  }
  return {
    content: "",
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
    embeds: [
      {
        title: "Resolution requise — revue manuelle",
        color: 0xffb020,
        fields: [
          { name: "Report ID", value: record.reportId, inline: false },
          {
            name: "Cible (defangee)",
            value: neutralize(record.valueDefanged),
            inline: false,
          },
          { name: "Type", value: String(record.type), inline: true },
          { name: "Score final", value: score, inline: true },
          {
            name: "Categorie",
            value: String(record.category ?? "n/a"),
            inline: true,
          },
          ...extraFields,
        ],
        footer: { text: "Boutons reserves aux administrateurs" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Publier on-chain",
            custom_id: `resolve:confirm:${record.reportId}`,
          },
          {
            type: 2,
            style: 2,
            label: "Rejeter",
            custom_id: `resolve:dismiss:${record.reportId}`,
          },
        ],
      },
    ],
  };
}

function resolvedMessagePatch(originalEmbed, outcome) {
  const embed = { ...originalEmbed };
  if (outcome.action === "confirm") {
    embed.color = 0xff3b5c;
    embed.title = "Publie on-chain (decision admin)";
  } else {
    embed.color = 0x6b7c92;
    embed.title = "Rejete (decision admin)";
  }
  embed.fields = [
    ...(originalEmbed.fields ?? []),
    {
      name: "Resolution",
      value: outcome.summary,
      inline: false,
    },
  ];
  return { embeds: [embed], components: [] };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Orchestration d'une resolution. Toutes les E/S passent par fetchImpl.
// - dismiss : PATCH journal status=dismissed, aucun effet blockchain.
// - confirm : relit le journal (etat courant), publie via /internal/report
//   (chemin chain-bridge deja teste : Reporter, retries cote registre),
//   puis PATCH journal avec status + txHash confirmes.
async function resolveReport({
  action,
  reportId,
  bridge,
  chainBridge,
  fetchImpl = fetch,
}) {
  const recordResponse = await fetchImpl(`${bridge.url}/reports/${reportId}`, {
    headers: { authorization: `Bearer ${bridge.secret}` },
  });
  if (!recordResponse.ok) {
    return {
      ok: false,
      code: "REPORT_NOT_FOUND",
      summary: "Signalement introuvable dans le journal.",
    };
  }
  const record = (await readJson(recordResponse))?.record;
  if (!record || record.status !== "manual_review") {
    return {
      ok: false,
      code: "ALREADY_RESOLVED",
      summary: `Deja traite (statut actuel : ${record?.status ?? "inconnu"}).`,
    };
  }

  if (action === "dismiss") {
    const patched = await fetchImpl(`${bridge.url}/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${bridge.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "dismissed" }),
    });
    if (!patched.ok) {
      return {
        ok: false,
        code: "JOURNAL_PATCH_FAILED",
        summary: "Echec de mise a jour du journal.",
      };
    }
    return {
      ok: true,
      action,
      summary: "Rejete : aucune publication on-chain.",
    };
  }

  const value = refangValue(record.type, record.valueDefanged);
  const score = Math.min(
    100,
    Math.max(0, Math.round((record.scoreFinal ?? 0.5) * 100)),
  );
  const reportResponse = await fetchImpl(`${chainBridge.url}/internal/report`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${chainBridge.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: record.type,
      value,
      category: record.category ?? "other",
      score,
    }),
  });
  const result = await readJson(reportResponse);
  // "reported" doit fournir un txHash de transaction confirme ;
  // "already_blacklisted" signifie que la cible est deja au registre
  // (publication anterieure) et n'a pas de nouveau txHash.
  const reported =
    reportResponse.ok &&
    result &&
    result.status === "reported" &&
    typeof result.txHash === "string" &&
    TX_HASH_PATTERN.test(result.txHash);
  const alreadyBlacklisted =
    reportResponse.ok && result && result.status === "already_blacklisted";
  if (!reported && !alreadyBlacklisted) {
    return {
      ok: false,
      code: "CHAIN_REPORT_FAILED",
      summary:
        "Publication blockchain non confirmee — journal inchange, reessayez.",
    };
  }

  const patched = await fetchImpl(`${bridge.url}/reports/${reportId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${bridge.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      status: result.status,
      txHash: reported ? result.txHash : null,
      decision: "reporting",
    }),
  });
  const journalNote = patched.ok ? "" : " (attention : journal non mis a jour)";
  return {
    ok: true,
    action,
    txHash: reported ? result.txHash : null,
    summary: reported
      ? `Publie on-chain : [transaction](${POLYGONSCAN_TX}${result.txHash})${journalNote}`
      : `Deja present au registre on-chain (blacklist active depuis ${result.since ?? "date inconnue"})${journalNote}`,
  };
}

module.exports = {
  buildReviewMessage,
  isAuthorizedInteraction,
  parseCustomId,
  refangValue,
  resolvedMessagePatch,
  resolveReport,
  selectNewManualReviews,
};
