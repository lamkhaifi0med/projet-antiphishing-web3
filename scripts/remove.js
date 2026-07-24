const { parseArgs } = require("./lib/registry");
const { removeEntry } = require("./lib/removal");

function usage() {
  return [
    "Owner-only false-positive correction:",
    "  node scripts/remove.js --type=url --value=https://example.test/claim",
    "  node scripts/remove.js --type=wallet --value=0x...",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.type || !args.value) {
    throw new Error(usage());
  }

  const result = await removeEntry(args);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exitCode = 1;
});
