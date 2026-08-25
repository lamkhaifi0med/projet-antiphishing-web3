const path = require("node:path");
const dotenv = require("dotenv");
const {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
} = require("ethers");

if (process.env.SKIP_PROJECT_DOTENV !== "1") {
  dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
}

const AMOY_EXPLORER_URL = "https://amoy.polygonscan.com";

const REGISTRY_ABI = [
  "function reportURL(bytes32 urlHash, uint8 category, uint8 score)",
  "function reportWallet(address wallet, uint8 category, uint8 score)",
  "function removeURL(bytes32 urlHash)",
  "function removeWallet(address wallet)",
  "function owner() view returns (address)",
  "function isBlacklistedURL(bytes32 urlHash) view returns (bool)",
  "function isBlacklistedWallet(address wallet) view returns (bool)",
  "function getURLEntry(bytes32 urlHash) view returns (tuple(uint8 category, uint8 score, uint40 timestamp, address reporter, bool active))",
  "function getWalletEntry(address wallet) view returns (tuple(uint8 category, uint8 score, uint40 timestamp, address reporter, bool active))",
  "event URLReported(bytes32 indexed urlHash, uint8 category, uint8 score, address indexed reporter)",
  "event WalletReported(address indexed wallet, uint8 category, uint8 score, address indexed reporter)",
  "event EntryRemoved(bytes32 indexed key, bool isWallet)",
];

const CATEGORY_NAMES = [
  "fake_exchange",
  "wallet_drainer",
  "fake_airdrop",
  "fake_support",
  "ponzi",
  "other",
];

const CATEGORY_IDS = new Map(
  CATEGORY_NAMES.map((category, index) => [category, index]),
);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required in .env.`);
  }
  return value;
}

function getProvider() {
  return new JsonRpcProvider(requireEnv("AMOY_RPC_URL"), 80002);
}

function getContractAddress() {
  return getAddress(requireEnv("REGISTRY_CONTRACT_ADDRESS"));
}

function getRegistry(provider = getProvider()) {
  return new Contract(getContractAddress(), REGISTRY_ABI, provider);
}

function getReporterRegistry() {
  const provider = getProvider();
  const reporter = new Wallet(requireEnv("REPORTER_PRIVATE_KEY"), provider);
  return {
    registry: getRegistry(provider).connect(reporter),
    reporter,
  };
}

function getOwnerRegistry() {
  const provider = getProvider();
  const owner = new Wallet(requireEnv("OWNER_PRIVATE_KEY"), provider);
  return {
    registry: getRegistry(provider).connect(owner),
    owner,
  };
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A non-empty URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Invalid URL. Include http:// or https://.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be reported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing credentials are not accepted.");
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("www.")) {
    hostname = hostname.slice(4);
  }
  if (!hostname) {
    throw new Error("URL hostname is missing.");
  }

  const port = parsed.port ? `:${parsed.port}` : "";
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "/") {
    pathname = "";
  }

  return `${hostname}${port}${pathname}`;
}

function hashNormalizedUrl(normalizedUrl) {
  return keccak256(toUtf8Bytes(normalizedUrl));
}

function normalizeWallet(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A non-empty EVM wallet address is required.");
  }
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error("Invalid EVM wallet address.");
  }
}

function normalizeCategory(value) {
  const category = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!CATEGORY_IDS.has(category)) {
    throw new Error(
      `Invalid category. Use one of: ${CATEGORY_NAMES.join(", ")}.`,
    );
  }
  return {
    name: category,
    id: CATEGORY_IDS.get(category),
  };
}

function categoryName(categoryId) {
  return CATEGORY_NAMES[Number(categoryId)] ?? "other";
}

function normalizeScore(value) {
  let score;
  if (typeof value === "number") {
    score = value;
  } else if (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,2})$/.test(value.trim())
  ) {
    score = Number(value.trim());
  } else {
    throw new Error("Score must be an integer from 0 to 100.");
  }

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error("Score must be an integer from 0 to 100.");
  }
  return score;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [name, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    if (name === "follow") {
      if (inlineValue !== undefined) {
        throw new Error("--follow does not accept a value.");
      }
      args.follow = true;
      continue;
    }

    if (inlineValue !== undefined) {
      if (!inlineValue) {
        throw new Error(`Missing value for --${name}.`);
      }
      args[name] = inlineValue;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function getDeploymentBlock() {
  const configuredBlock = process.env.REGISTRY_DEPLOYMENT_BLOCK?.trim();
  if (!configuredBlock) {
    return undefined;
  }
  const block = Number(configuredBlock);
  if (!Number.isSafeInteger(block) || block < 0) {
    throw new Error(
      "REGISTRY_DEPLOYMENT_BLOCK must be a non-negative integer.",
    );
  }
  return block;
}

function timestampToIso(timestamp) {
  return new Date(Number(timestamp) * 1_000).toISOString();
}

function txExplorerUrl(txHash) {
  return `${AMOY_EXPLORER_URL}/tx/${txHash}`;
}

function contractExplorerUrl(address = getContractAddress()) {
  return `${AMOY_EXPLORER_URL}/address/${address}#code`;
}

function toEntryJson(entry) {
  return {
    category: categoryName(entry.category),
    score: Number(entry.score),
    since: timestampToIso(entry.timestamp),
    reporter: entry.reporter,
    active: entry.active,
  };
}

module.exports = {
  AMOY_EXPLORER_URL,
  CATEGORY_NAMES,
  categoryName,
  contractExplorerUrl,
  getDeploymentBlock,
  getOwnerRegistry,
  getProvider,
  getRegistry,
  getReporterRegistry,
  hashNormalizedUrl,
  normalizeCategory,
  normalizeScore,
  normalizeUrl,
  normalizeWallet,
  parseArgs,
  timestampToIso,
  toEntryJson,
  txExplorerUrl,
};
