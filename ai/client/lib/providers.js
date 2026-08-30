"use strict";

// Appels bruts Gemini / NVIDIA NIM (RF-A6). Ne valide rien ici — juste le
// transport HTTP et la distinction erreur transitoire (timeout/429/5xx)
// vs erreur définitive, qui pilote le basculement Gemini -> NVIDIA.

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const configuredTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS);
const REQUEST_TIMEOUT_MS =
  Number.isInteger(configuredTimeoutMs) &&
  configuredTimeoutMs >= 5_000 &&
  configuredTimeoutMs <= 120_000
    ? configuredTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;
const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

// Sous-ensemble JSON Schema accepte par Gemini structured output. La regle
// conditionnelle category/verdict reste controlee par validateOutput.js.
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "category", "indicators", "explanation"],
  properties: {
    verdict: {
      type: "string",
      enum: ["malicious", "suspicious", "legitimate"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    category: {
      type: ["string", "null"],
      enum: [
        "fake_exchange",
        "wallet_drainer",
        "fake_airdrop",
        "fake_support",
        "ponzi",
        "other",
        null,
      ],
    },
    indicators: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 200 },
    },
    explanation: { type: "string", maxLength: 500 },
  },
};

class TransientProviderError extends Error {
  constructor(message, { retryAfterMs = null } = {}) {
    super(message);
    this.name = "TransientProviderError";
    this.retryAfterMs = retryAfterMs;
  }
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

// Les reponses 429/503 renvoient souvent un delai d'attente explicite
// (en-tete Retry-After en secondes, ou detail RetryInfo Gemini). Le
// respecter permet de reussir au retry suivant au lieu de re-consommer le
// quota trop tot. Borne a 60 s pour ne jamais bloquer une analyse.
const MAX_RETRY_AFTER_MS = 60_000;

function retryAfterMsFromResponse(response, body) {
  const header = response.headers?.get?.("retry-after");
  const headerSeconds = Number(header);
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return Math.min(Math.ceil(headerSeconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const delay = detail?.retryDelay;
      const match =
        typeof delay === "string" && delay.match(/^(\d+(?:\.\d+)?)s$/);
      if (match) {
        return Math.min(Math.ceil(Number(match[1]) * 1000), MAX_RETRY_AFTER_MS);
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout après ${REQUEST_TIMEOUT_MS} ms`)),
    REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model =
    process.env.GEMINI_MODEL_PRIMARY?.trim() || "gemini-flash-latest";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY manquante dans .env");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const started = Date.now();

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    });
  } catch (error) {
    // Timeout / échec réseau : traité comme transitoire (RF-A6).
    throw new TransientProviderError(`Gemini injoignable : ${error.message}`);
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const message = `Gemini a répondu HTTP ${response.status}`;
    if (isTransientStatus(response.status)) {
      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch {
        // Le corps d'erreur est optionnel : seul Retry-After nous intéresse.
      }
      throw new TransientProviderError(message, {
        retryAfterMs: retryAfterMsFromResponse(response, errorBody),
      });
    }
    throw new Error(message);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Réponse Gemini sans texte exploitable");
  }

  return { rawText: text, model, provider: "gemini", latencyMs };
}

async function callNvidia({ systemPrompt, userPrompt }) {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const baseUrl = (
    process.env.NVIDIA_BASE_URL?.trim() || NVIDIA_DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const model =
    process.env.NVIDIA_MODEL_FALLBACK?.trim() || "openai/gpt-oss-20b";
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY manquante dans .env");
  }

  const url = `${baseUrl}/chat/completions`;
  const started = Date.now();

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // NVIDIA NIM recommande guided_json plutot que json_object, qui ne
        // garantit que la syntaxe JSON et pas la forme de l'objet.
        guided_json: RESPONSE_SCHEMA,
        temperature: 0,
      }),
    });
  } catch (error) {
    throw new TransientProviderError(
      `NVIDIA NIM injoignable : ${error.message}`,
    );
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const message = `NVIDIA NIM a répondu HTTP ${response.status}`;
    if (isTransientStatus(response.status)) {
      throw new TransientProviderError(message, {
        retryAfterMs: retryAfterMsFromResponse(response, null),
      });
    }
    throw new Error(message);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Réponse NVIDIA NIM sans texte exploitable");
  }

  return { rawText: text, model, provider: "nvidia", latencyMs };
}

/**
 * Gemini d'abord ; bascule sur NVIDIA uniquement si Gemini échoue de façon
 * transitoire (timeout, 429, 5xx — RF-A6). Une erreur définitive (clé
 * invalide, 400...) n'entraîne PAS de bascule : elle remonte telle quelle.
 */
async function callModelWithFallback({ systemPrompt, userPrompt }) {
  try {
    return await callGemini({ systemPrompt, userPrompt });
  } catch (error) {
    if (error instanceof TransientProviderError) {
      return await callNvidia({ systemPrompt, userPrompt });
    }
    throw error;
  }
}

module.exports = {
  callGemini,
  callNvidia,
  callModelWithFallback,
  TransientProviderError,
  isTransientStatus,
  REQUEST_TIMEOUT_MS,
};
