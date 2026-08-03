const {
  getReporterRegistry,
  normalizeCategory,
  normalizeScore,
  normalizeUrl,
  normalizeWallet,
  hashNormalizedUrl,
  toEntryJson,
  txExplorerUrl,
} = require("./registry");

function alreadyBlacklistedResult(base, entry) {
  return {
    status: "already_blacklisted",
    ...base,
    ...toEntryJson(entry),
  };
}

async function reconcileFailedReport({ error, readEntry, base }) {
  let current;
  try {
    current = await readEntry();
  } catch {
    // Preserve the publication error: a failed reconciliation must not
    // replace it with a less useful secondary read error.
    throw error;
  }

  if (current.active) {
    return alreadyBlacklistedResult(base, current);
  }
  throw error;
}

async function submitReport(
  { type, value, category, score },
  { getReporterRegistryImpl = getReporterRegistry } = {},
) {
  const normalizedType = String(type ?? "")
    .trim()
    .toLowerCase();
  const normalizedCategory = normalizeCategory(category);
  const normalizedScore = normalizeScore(score);
  const { registry, reporter } = getReporterRegistryImpl();

  if (normalizedType === "url") {
    const normalizedValue = normalizeUrl(value);
    const urlHash = hashNormalizedUrl(normalizedValue);
    const readEntry = () => registry.getURLEntry(urlHash);
    const base = { type: "url", normalizedValue, urlHash };
    const existing = await readEntry();

    if (existing.active) {
      return alreadyBlacklistedResult(base, existing);
    }

    let transaction;
    try {
      transaction = await registry.reportURL(
        urlHash,
        normalizedCategory.id,
        normalizedScore,
      );
      await transaction.wait();
    } catch (error) {
      return reconcileFailedReport({ error, readEntry, base });
    }

    return {
      status: "reported",
      ...base,
      category: normalizedCategory.name,
      score: normalizedScore,
      reporter: reporter.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  if (normalizedType === "wallet") {
    const normalizedValue = normalizeWallet(value);
    const readEntry = () => registry.getWalletEntry(normalizedValue);
    const base = { type: "wallet", normalizedValue };
    const existing = await readEntry();

    if (existing.active) {
      return alreadyBlacklistedResult(base, existing);
    }

    let transaction;
    try {
      transaction = await registry.reportWallet(
        normalizedValue,
        normalizedCategory.id,
        normalizedScore,
      );
      await transaction.wait();
    } catch (error) {
      return reconcileFailedReport({ error, readEntry, base });
    }

    return {
      status: "reported",
      ...base,
      category: normalizedCategory.name,
      score: normalizedScore,
      reporter: reporter.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  throw new Error("type must be either url or wallet.");
}

module.exports = {
  alreadyBlacklistedResult,
  reconcileFailedReport,
  submitReport,
};
