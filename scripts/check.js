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
