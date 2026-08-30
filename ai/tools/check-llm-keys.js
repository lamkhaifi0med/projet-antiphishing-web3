"use strict";

// Smoke test de Phase 0 : vérifie uniquement que les clés Gemini et NVIDIA
// NIM sont valides et joignables. Ce n'est PAS le client de production —
// le vrai client (fallback automatique, validation de schéma, retries)
// relève de RF-A6 et sera construit en Phase 3 dans ai/client/llmClient.js.
// Ne pas préempter cette conception ici.

const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const PROMPT = "Reply with exactly the single word: pong";
const REQUEST_TIMEOUT_MS = 10_000;
const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

function redact(secrets, text) {
  let safe = String(text ?? "");
  for (const secret of secrets) {
    if (secret) {
      safe = safe.split(secret).join("[REDACTED]");
    }
  }
  return safe;
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkGemini() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model =
    process.env.GEMINI_MODEL_PRIMARY?.trim() || "gemini-flash-latest";
  const label = `Gemini (${model})`;

  if (!apiKey) {
    return { label, status: "missing_key" };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const started = Date.now();

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
      },
      REQUEST_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return {
        label,
        status: "unreachable",
        httpStatus: response.status,
        latencyMs,
      };
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return { label, status: "ok", latencyMs, reply };
  } catch (error) {
    return {
      label,
      status: "unreachable",
      latencyMs: Date.now() - started,
      error: redact([apiKey], error.message),
    };
  }
}

async function checkNvidia() {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const baseUrl = (
    process.env.NVIDIA_BASE_URL?.trim() || NVIDIA_DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const model =
    process.env.NVIDIA_MODEL_FALLBACK?.trim() || "openai/gpt-oss-20b";
  const label = `NVIDIA NIM (${model})`;

  if (!apiKey) {
    return { label, status: "missing_key" };
  }

  const url = `${baseUrl}/chat/completions`;
  const started = Date.now();

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: PROMPT }],
          max_tokens: 10,
          temperature: 0,
        }),
      },
      REQUEST_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return {
        label,
        status: "unreachable",
        httpStatus: response.status,
        latencyMs,
      };
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    return { label, status: "ok", latencyMs, reply };
  } catch (error) {
    return {
      label,
      status: "unreachable",
      latencyMs: Date.now() - started,
      error: redact([apiKey], error.message),
    };
  }
}

function printResult(result) {
  console.log(result.label);
  if (result.status === "missing_key") {
    console.log("  Statut     : non testé (clé absente de .env)");
  } else if (result.status === "ok") {
    console.log("  Statut     : joignable");
    console.log(`  Latence    : ${result.latencyMs} ms`);
    console.log(`  Réponse    : ${JSON.stringify(result.reply ?? null)}`);
  } else {
    console.log("  Statut     : injoignable");
    if (result.httpStatus !== undefined) {
      console.log(`  Code HTTP  : ${result.httpStatus}`);
    }
    if (result.latencyMs !== undefined) {
      console.log(`  Latence    : ${result.latencyMs} ms`);
    }
    if (result.error) {
      console.log(`  Erreur     : ${result.error}`);
    }
  }
  console.log("");
}

async function main() {
  console.log("Smoke test Phase 0 — connectivité LLM (Gemini / NVIDIA NIM)");
  console.log(
    "Ce script ne remplace pas le client de production (RF-A6, Phase 3).\n",
  );

  const [gemini, nvidia] = await Promise.all([checkGemini(), checkNvidia()]);

  printResult(gemini);
  printResult(nvidia);

  const failed = [gemini, nvidia].filter((result) => result.status !== "ok");
  if (failed.length > 0) {
    console.log(
      `${failed.length} fournisseur(s) injoignable(s) ou non configuré(s).`,
    );
    process.exitCode = 1;
  } else {
    console.log("Les deux fournisseurs sont joignables.");
  }
}

main().catch((error) => {
  const secrets = [process.env.GEMINI_API_KEY, process.env.NVIDIA_API_KEY];
  console.error(
    "Échec inattendu du smoke test :",
    redact(secrets, error.message),
  );
  process.exitCode = 1;
});
