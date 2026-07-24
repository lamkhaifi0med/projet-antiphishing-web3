const {
  categoryName,
  getDeploymentBlock,
  getRegistry,
  parseArgs,
} = require("./lib/registry");

const MAX_LOG_QUERY_ATTEMPTS = 3;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryFilterWithRetry(registry, filter, fromBlock) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_LOG_QUERY_ATTEMPTS; attempt += 1) {
    try {
      return await registry.queryFilter(filter, fromBlock);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_LOG_QUERY_ATTEMPTS) {
        await wait(attempt * 1_000);
      }
    }
  }
  throw lastError;
}

function toLogJson(log) {
  if (log.fragment.name === "URLReported") {
    return {
      event: "URLReported",
      urlHash: log.args.urlHash,
      category: categoryName(log.args.category),
      score: Number(log.args.score),
      reporter: log.args.reporter,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };
  }

  if (log.fragment.name === "WalletReported") {
    return {
      event: "WalletReported",
      wallet: log.args.wallet,
      category: categoryName(log.args.category),
      score: Number(log.args.score),
      reporter: log.args.reporter,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };
  }

  return {
    event: "EntryRemoved",
    key: log.args.key,
    isWallet: log.args.isWallet,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = getRegistry();
  const fromBlock = args.fromBlock
    ? Number(args.fromBlock)
    : getDeploymentBlock();
  if (
    fromBlock !== undefined &&
    (!Number.isSafeInteger(fromBlock) || fromBlock < 0)
  ) {
    throw new Error("--fromBlock must be a non-negative integer.");
  }

  const eventFilters = [
    registry.filters.URLReported(),
    registry.filters.WalletReported(),
    registry.filters.EntryRemoved(),
  ];
  const eventGroups = await Promise.all(
    eventFilters.map((filter) =>
      queryFilterWithRetry(registry, filter, fromBlock),
    ),
  );
  const historicalLogs = eventGroups.flat().sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.index - right.index;
  });
  for (const log of historicalLogs) {
    console.log(JSON.stringify({ source: "history", ...toLogJson(log) }));
  }

  if (!args.follow) {
    return;
  }

  console.log(
    JSON.stringify({ status: "listening", fromBlock: fromBlock ?? "genesis" }),
  );
  registry.on(
    registry.filters.URLReported(),
    (urlHash, category, score, reporter, log) => {
      console.log(
        JSON.stringify({
          source: "live",
          event: "URLReported",
          urlHash,
          category: categoryName(category),
          score: Number(score),
          reporter,
          txHash: log.log.transactionHash,
          blockNumber: log.log.blockNumber,
        }),
      );
    },
  );
  registry.on(
    registry.filters.WalletReported(),
    (wallet, category, score, reporter, log) => {
      console.log(
        JSON.stringify({
          source: "live",
          event: "WalletReported",
          wallet,
          category: categoryName(category),
          score: Number(score),
          reporter,
          txHash: log.log.transactionHash,
          blockNumber: log.log.blockNumber,
        }),
      );
    },
  );
  registry.on(registry.filters.EntryRemoved(), (key, isWallet, log) => {
    console.log(
      JSON.stringify({
        source: "live",
        event: "EntryRemoved",
        key,
        isWallet,
        txHash: log.log.transactionHash,
        blockNumber: log.log.blockNumber,
      }),
    );
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exitCode = 1;
});
