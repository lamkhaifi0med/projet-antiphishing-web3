const { getRegistry, parseArgs } = require("./lib/registry");
const { checkEntry } = require("./lib/checking");
const { toCliError } = require("./lib/chainErrors");

function usage() {
  return [
    "Usage:",
    "  node scripts/check.js --type=url --value=https://example.test/claim",
    "  node scripts/check.js --type=wallet --value=0x...",
  ].join("\n");
}

<<<<<<< HEAD
=======
async function latestTransactionHash(registry, filter) {
  // WF1 a uniquement besoin de la deduplication et des donnees de l'Entry.
  // Certains RPC gratuits refusent eth_getLogs sur l'historique complet.
  if (process.env.CHECK_INCLUDE_TX_HASH === "false") return null;
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

>>>>>>> 4c12b56 (Update project)
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.type || !args.value) {
    throw new Error(usage());
  }

  const registry = getRegistry();
  const result = await checkEntry(registry, args);

  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(JSON.stringify(toCliError(error)));
  process.exitCode = 1;
});
