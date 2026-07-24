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

async function submitReport({ type, value, category, score }) {
  const normalizedType = String(type ?? "")
    .trim()
    .toLowerCase();
  const normalizedCategory = normalizeCategory(category);
  const normalizedScore = normalizeScore(score);
  const { registry, reporter } = getReporterRegistry();

  if (normalizedType === "url") {
    const normalizedValue = normalizeUrl(value);
    const urlHash = hashNormalizedUrl(normalizedValue);
    const existing = await registry.getURLEntry(urlHash);

    if (existing.active) {
      return {
        status: "already_blacklisted",
        type: "url",
        normalizedValue,
        urlHash,
        ...toEntryJson(existing),
      };
    }

    const transaction = await registry.reportURL(
      urlHash,
      normalizedCategory.id,
      normalizedScore,
    );
    await transaction.wait();

    return {
      status: "reported",
      type: "url",
      normalizedValue,
      urlHash,
      category: normalizedCategory.name,
      score: normalizedScore,
      reporter: reporter.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  if (normalizedType === "wallet") {
    const normalizedValue = normalizeWallet(value);
    const existing = await registry.getWalletEntry(normalizedValue);

    if (existing.active) {
      return {
        status: "already_blacklisted",
        type: "wallet",
        normalizedValue,
        ...toEntryJson(existing),
      };
    }

    const transaction = await registry.reportWallet(
      normalizedValue,
      normalizedCategory.id,
      normalizedScore,
    );
    await transaction.wait();

    return {
      status: "reported",
      type: "wallet",
      normalizedValue,
      category: normalizedCategory.name,
      score: normalizedScore,
      reporter: reporter.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  throw new Error("type must be either url or wallet.");
}

module.exports = { submitReport };
