const {
  getDeploymentBlock,
  getRegistry,
  hashNormalizedUrl,
  normalizeUrl,
  normalizeWallet,
  parseArgs,
  toEntryJson,
} = require("./lib/registry");

function usage() {
  return [
    "Usage:",
    "  node scripts/check.js --type=url --value=https://example.test/claim",
    "  node scripts/check.js --type=wallet --value=0x...",
  ].join("\n");
}

async function latestTransactionHash(registry, filter) {
  const events = await registry.queryFilter(filter, getDeploymentBlock());
  return events.length > 0 ? events.at(-1).transactionHash : null;
}

async function checkUrl(registry, value) {
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
    ),
  };
}

async function checkWallet(registry, value) {
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
    ),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.type || !args.value) {
    throw new Error(usage());
  }

  const registry = getRegistry();
  const type = args.type.toLowerCase();
  const result =
    type === "url"
      ? await checkUrl(registry, args.value)
      : type === "wallet"
        ? await checkWallet(registry, args.value)
        : (() => {
            throw new Error("type must be either url or wallet.");
          })();

  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exitCode = 1;
});
