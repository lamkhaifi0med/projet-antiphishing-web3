"use strict";

const {
  getDeploymentBlock,
  hashNormalizedUrl,
  normalizeUrl,
  normalizeWallet,
  toEntryJson,
} = require("./registry");
const { classifyChainError } = require("./chainErrors");

const MAX_LOG_QUERY_ATTEMPTS = 3;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientRpcError(error) {
  return classifyChainError(error).retryable;
}

async function latestTransactionHash(
  registry,
  filter,
  {
    fromBlock = getDeploymentBlock(),
    maxAttempts = MAX_LOG_QUERY_ATTEMPTS,
    waitFn = wait,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const events = await registry.queryFilter(filter, fromBlock);
      return events.length > 0 ? events.at(-1).transactionHash : null;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === maxAttempts) throw error;
      await waitFn(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function checkUrl(registry, value, options) {
  const normalizedValue = normalizeUrl(value);
  const urlHash = hashNormalizedUrl(normalizedValue);
  const entry = await registry.getURLEntry(urlHash);

  if (!entry.active) {
    return { blacklisted: false, type: "url", normalizedValue, urlHash };
  }

  return {
    blacklisted: true,
    type: "url",
    normalizedValue,
    urlHash,
    ...toEntryJson(entry),
    txHash: await latestTransactionHash(
      registry,
      registry.filters.URLReported(urlHash),
      options,
    ),
  };
}

async function checkWallet(registry, value, options) {
  const normalizedValue = normalizeWallet(value);
  const entry = await registry.getWalletEntry(normalizedValue);

  if (!entry.active) {
    return { blacklisted: false, type: "wallet", normalizedValue };
  }

  return {
    blacklisted: true,
    type: "wallet",
    normalizedValue,
    ...toEntryJson(entry),
    txHash: await latestTransactionHash(
      registry,
      registry.filters.WalletReported(normalizedValue),
      options,
    ),
  };
}

async function checkEntry(registry, { type, value }, options) {
  const normalizedType = String(type ?? "")
    .trim()
    .toLowerCase();
  if (normalizedType === "url") return checkUrl(registry, value, options);
  if (normalizedType === "wallet") return checkWallet(registry, value, options);
  throw new Error("type must be either url or wallet.");
}

function toPublicCheckResult(result) {
  if (!result || result.blacklisted !== true) {
    return { blacklisted: false };
  }

  return {
    blacklisted: true,
    category: result.category,
    score: result.score,
    since: result.since,
    txHash: result.txHash,
  };
}

module.exports = {
  MAX_LOG_QUERY_ATTEMPTS,
  checkEntry,
  checkUrl,
  checkWallet,
  isTransientRpcError,
  latestTransactionHash,
  toPublicCheckResult,
};
