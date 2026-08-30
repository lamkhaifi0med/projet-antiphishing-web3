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
const MAX_LOG_BLOCK_RANGE = 10_000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientRpcError(error) {
  return classifyChainError(error).retryable;
}

async function withRpcRetry(operation, maxAttempts, waitFn) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === maxAttempts) throw error;
      await waitFn(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function resolveLatestBlock(registry, toBlock, maxAttempts, waitFn) {
  if (toBlock !== undefined) {
    if (!Number.isSafeInteger(toBlock) || toBlock < 0) {
      throw new Error("toBlock must be a non-negative integer.");
    }
    return toBlock;
  }

  const runner = registry.runner;
  const provider =
    (typeof runner?.getBlockNumber === "function" && runner) ||
    (typeof runner?.provider?.getBlockNumber === "function" &&
      runner.provider) ||
    (typeof registry.provider?.getBlockNumber === "function" &&
      registry.provider);
  if (!provider) {
    throw new Error(
      "Registry provider must expose getBlockNumber for bounded event queries.",
    );
  }

  const latestBlock = await withRpcRetry(
    () => provider.getBlockNumber(),
    maxAttempts,
    waitFn,
  );
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
    throw new Error("RPC provider returned an invalid latest block number.");
  }
  return latestBlock;
}

async function latestTransactionHash(
  registry,
  filter,
  {
    fromBlock = getDeploymentBlock() ?? 0,
    toBlock,
    maxBlockRange = MAX_LOG_BLOCK_RANGE,
    maxAttempts = MAX_LOG_QUERY_ATTEMPTS,
    waitFn = wait,
  } = {},
) {
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
    throw new Error("fromBlock must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(maxBlockRange) || maxBlockRange < 1) {
    throw new Error("maxBlockRange must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer.");
  }

  const latestBlock = await resolveLatestBlock(
    registry,
    toBlock,
    maxAttempts,
    waitFn,
  );
  for (let rangeEnd = latestBlock; rangeEnd >= fromBlock; ) {
    const rangeStart = Math.max(fromBlock, rangeEnd - maxBlockRange + 1);
    const events = await withRpcRetry(
      () => registry.queryFilter(filter, rangeStart, rangeEnd),
      maxAttempts,
      waitFn,
    );
    if (events.length > 0) return events.at(-1).transactionHash;
    rangeEnd = rangeStart - 1;
  }
  return null;
}

// L'enrichissement txHash repose sur eth_getLogs, nettement moins fiable
// que eth_call sur les RPC publics (limites de plage, pannes temporaires).
// Le verdict blacklisted/score/since provient de getURLEntry/getWalletEntry
// et est deja acquis : une panne de getLogs ne doit jamais transformer une
// reponse valide en echec complet ni depasser les timeouts HTTP en amont
// (nginx 15s, WF4). Best-effort : txHash null si echec ou budget depasse.
const TX_HASH_TIME_BUDGET_MS = 3_000;

async function bestEffortTransactionHash(registry, filter, options) {
  let timer;
  try {
    return await Promise.race([
      latestTransactionHash(registry, filter, options),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), TX_HASH_TIME_BUDGET_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    txHash: await bestEffortTransactionHash(
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
    txHash: await bestEffortTransactionHash(
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
  MAX_LOG_BLOCK_RANGE,
  MAX_LOG_QUERY_ATTEMPTS,
  checkEntry,
  checkUrl,
  checkWallet,
  isTransientRpcError,
  latestTransactionHash,
  toPublicCheckResult,
};
