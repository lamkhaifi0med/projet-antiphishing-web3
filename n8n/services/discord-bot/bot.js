"use strict";

// Bot Discord de resolution des cas manual_review (boutons admin).
// Zero dependance : fetch + WebSocket natifs de Node 22.
//
// - Poll du journal bridge (/reports/recent) : chaque nouveau cas
//   manual_review est poste dans le canal configure avec deux boutons.
// - Clic bouton (INTERACTION_CREATE via la gateway websocket — aucun
//   endpoint public requis) : verification admin, puis publication on-chain
//   via le chain-bridge existant ou rejet (journal), et edition du message.
// - Les IDs deja postes sont persistes dans /data pour survivre aux
//   redemarrages sans reposter.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  buildReviewMessage,
  isAuthorizedInteraction,
  parseCustomId,
  resolvedMessagePatch,
  resolveReport,
  selectNewManualReviews,
} = require("./lib");

const DISCORD_API = "https://discord.com/api/v10";
const OPS = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  ACK: 11,
};

const config = {
  token: requireEnv("DISCORD_BOT_TOKEN"),
  channelId: requireEnv("DISCORD_MANUAL_REVIEW_CHANNEL_ID"),
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || null,
  bridge: {
    url: process.env.BRIDGE_URL || "http://bridge:8787",
    secret: requireEnv("BRIDGE_SHARED_SECRET"),
  },
  chainBridge: {
    url: process.env.CHAIN_BRIDGE_URL || "http://chain-bridge:3001",
    token: requireEnv("CHAIN_BRIDGE_TOKEN"),
  },
  statePath: process.env.BOT_STATE_PATH || "/data/posted.json",
  pollIntervalMs: Number(process.env.BOT_POLL_INTERVAL_MS || 20_000),
  healthPort: Number(process.env.BOT_HEALTH_PORT || 8790),
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith("PASTE_")) {
    console.error(JSON.stringify({ event: "config_error", missing: name }));
    process.exit(1);
  }
  return value;
}

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, ...extra }));
}

// --- Discord REST -----------------------------------------------------------

async function rest(pathname, options = {}) {
  const response = await fetch(`${DISCORD_API}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bot ${config.token}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Discord REST ${pathname} -> ${response.status} ${body.slice(0, 200)}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

// --- Etat persistant (IDs deja postes) --------------------------------------

function loadPostedIds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id) => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function savePostedIds(postedIds) {
  fs.mkdirSync(path.dirname(config.statePath), { recursive: true });
  fs.writeFileSync(
    config.statePath,
    JSON.stringify([...postedIds].slice(-500)),
  );
}

// --- Poll du journal ---------------------------------------------------------

const postedIds = loadPostedIds();

async function pollJournal() {
  try {
    const response = await fetch(`${config.bridge.url}/reports/recent`);
    if (!response.ok) return;
    const { records } = await response.json();
    for (const record of selectNewManualReviews(records, postedIds)) {
      // Le flux public omet llmConfidence/featureScore/indicators : on relit
      // l'enregistrement complet pour reconstruire l'explication detaillee.
      let full = record;
      try {
        const detail = await fetch(
          `${config.bridge.url}/reports/${record.reportId}`,
          { headers: { authorization: `Bearer ${config.bridge.secret}` } },
        );
        if (detail.ok) full = (await detail.json())?.record ?? record;
      } catch {
        // Message minimal si la lecture detaillee echoue.
      }
      await rest(`/channels/${config.channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(buildReviewMessage(full)),
      });
      postedIds.add(record.reportId);
      savePostedIds(postedIds);
      log("review_posted", { reportId: record.reportId });
    }
  } catch (error) {
    log("poll_error", { message: error.message });
  }
}

// --- Interactions ------------------------------------------------------------

async function handleInteraction(interaction) {
  if (interaction.type !== 3) return; // message component uniquement
  const parsed = parseCustomId(interaction.data?.custom_id);
  if (!parsed) return;

  const callback = (payload) =>
    rest(`/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

  if (!isAuthorizedInteraction(interaction, config.adminRoleId)) {
    await callback({
      type: 4,
      data: {
        content: "Non autorise : reserve aux administrateurs.",
        flags: 64,
      },
    });
    log("interaction_denied", {
      reportId: parsed.reportId,
      userId: interaction.member?.user?.id,
    });
    return;
  }

  // La publication blockchain peut depasser les 3 s du delai de reponse
  // Discord : accusé different d'abord, resultat ensuite.
  await callback({ type: 5, data: { flags: 64 } });

  const outcome = await resolveReport({
    action: parsed.action,
    reportId: parsed.reportId,
    bridge: config.bridge,
    chainBridge: config.chainBridge,
  });
  log("interaction_resolved", {
    reportId: parsed.reportId,
    action: parsed.action,
    ok: outcome.ok,
    code: outcome.code ?? null,
    userId: interaction.member?.user?.id,
  });

  if (outcome.ok) {
    const originalEmbed = interaction.message?.embeds?.[0] ?? {};
    await rest(
      `/channels/${interaction.channel_id}/messages/${interaction.message.id}`,
      {
        method: "PATCH",
        body: JSON.stringify(
          resolvedMessagePatch(originalEmbed, {
            action: parsed.action,
            summary: outcome.summary,
          }),
        ),
      },
    ).catch((error) => log("message_edit_error", { message: error.message }));
  }

  await rest(
    `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      body: JSON.stringify({ content: outcome.summary.slice(0, 1900) }),
    },
  ).catch((error) => log("followup_error", { message: error.message }));
}

// --- Gateway websocket ---------------------------------------------------------

let gatewayHealthy = false;

async function connectGateway() {
  const { url } = await rest("/gateway/bot");
  const socket = new WebSocket(`${url}?v=10&encoding=json`);
  let heartbeatTimer = null;
  let sequence = null;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.s !== null && payload.s !== undefined) sequence = payload.s;

    if (payload.op === OPS.HELLO) {
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: OPS.HEARTBEAT, d: sequence }));
        }
      }, payload.d.heartbeat_interval);
      socket.send(
        JSON.stringify({
          op: OPS.IDENTIFY,
          d: {
            token: config.token,
            intents: 0,
            properties: {
              os: "linux",
              browser: "sentinel-bot",
              device: "sentinel-bot",
            },
          },
        }),
      );
      return;
    }
    if (payload.op === OPS.RECONNECT || payload.op === OPS.INVALID_SESSION) {
      socket.close();
      return;
    }
    if (payload.op === OPS.DISPATCH) {
      if (payload.t === "READY") {
        gatewayHealthy = true;
        log("gateway_ready", { user: payload.d.user?.username });
      } else if (payload.t === "INTERACTION_CREATE") {
        handleInteraction(payload.d).catch((error) =>
          log("interaction_error", { message: error.message }),
        );
      }
    }
  });

  const reconnect = () => {
    gatewayHealthy = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    log("gateway_disconnected");
    setTimeout(() => {
      connectGateway().catch((error) => {
        log("gateway_error", { message: error.message });
        setTimeout(reconnect, 10_000);
      });
    }, 5_000);
  };
  socket.addEventListener("close", reconnect, { once: true });
  socket.addEventListener("error", () => socket.close(), { once: true });
}

// --- Sante + demarrage ---------------------------------------------------------

http
  .createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(gatewayHealthy ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({ status: gatewayHealthy ? "ok" : "connecting" }),
      );
      return;
    }
    response.writeHead(404).end();
  })
  .listen(config.healthPort, "0.0.0.0", () =>
    log("health_listening", { port: config.healthPort }),
  );

connectGateway().catch((error) => {
  log("gateway_fatal", { message: error.message });
  process.exit(1);
});
setInterval(pollJournal, config.pollIntervalMs);
pollJournal();
