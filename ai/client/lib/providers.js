"use strict";

// Appels bruts Gemini / NVIDIA NIM (RF-A6). Ne valide rien ici — juste le
// transport HTTP et la distinction erreur transitoire (timeout/429/5xx)
// vs erreur définitive, qui pilote le basculement Gemini -> NVIDIA.

const REQUEST_TIMEOUT_MS = 20_000;
const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

class TransientProviderError extends Error {}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout après ${REQUEST_TIMEOUT_MS} ms`)), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL_PRIMARY?.trim() || "gemini-flash-latest";
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
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
  } catch (error) {
    // Timeout / échec réseau : traité comme transitoire (RF-A6).
    throw new TransientProviderError(`Gemini injoignable : ${error.message}`);
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const message = `Gemini a répondu HTTP ${response.status}`;
    if (isTransientStatus(response.status)) throw new TransientProviderError(message);
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
  const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || NVIDIA_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.NVIDIA_MODEL_FALLBACK?.trim() || "meta/llama-3.1-8b-instruct";
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY manquante dans .env");
  }

  const url = `${baseUrl}/chat/completions`;
  const started = Date.now();

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
  } catch (error) {
    throw new TransientProviderError(`NVIDIA NIM injoignable : ${error.message}`);
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const message = `NVIDIA NIM a répondu HTTP ${response.status}`;
    if (isTransientStatus(response.status)) throw new TransientProviderError(message);
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

module.exports = { callGemini, callNvidia, callModelWithFallback, TransientProviderError, isTransientStatus, REQUEST_TIMEOUT_MS };
