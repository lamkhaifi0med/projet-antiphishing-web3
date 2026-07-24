const {
  getOwnerRegistry,
  hashNormalizedUrl,
  normalizeUrl,
  normalizeWallet,
  toEntryJson,
  txExplorerUrl,
} = require("./registry");

async function removeEntry({ type, value }) {
  const normalizedType = String(type ?? "")
    .trim()
    .toLowerCase();
  const { registry, owner } = getOwnerRegistry();
  const contractOwner = await registry.owner();

  if (owner.address !== contractOwner) {
    throw new Error("OWNER_PRIVATE_KEY does not belong to the registry owner.");
  }

  if (normalizedType === "url") {
    const normalizedValue = normalizeUrl(value);
    const urlHash = hashNormalizedUrl(normalizedValue);
    const existing = await registry.getURLEntry(urlHash);

    if (!existing.active) {
      return {
        status: "not_blacklisted",
        type: "url",
        normalizedValue,
        urlHash,
      };
    }

    const transaction = await registry.removeURL(urlHash);
    await transaction.wait();
    return {
      status: "removed",
      type: "url",
      normalizedValue,
      urlHash,
      previousEntry: toEntryJson(existing),
      owner: owner.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  if (normalizedType === "wallet") {
    const normalizedValue = normalizeWallet(value);
    const existing = await registry.getWalletEntry(normalizedValue);

    if (!existing.active) {
      return {
        status: "not_blacklisted",
        type: "wallet",
        normalizedValue,
      };
    }

    const transaction = await registry.removeWallet(normalizedValue);
    await transaction.wait();
    return {
      status: "removed",
      type: "wallet",
      normalizedValue,
      previousEntry: toEntryJson(existing),
      owner: owner.address,
      txHash: transaction.hash,
      explorerUrl: txExplorerUrl(transaction.hash),
    };
  }

  throw new Error("type must be either url or wallet.");
}

module.exports = { removeEntry };
