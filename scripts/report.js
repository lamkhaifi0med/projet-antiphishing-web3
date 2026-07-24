const { parseArgs } = require("./lib/registry");
const { submitReport } = require("./lib/reporting");

function usage() {
  return [
    "Usage:",
    "  node scripts/report.js --type=url --value=https://example.test/claim --category=fake_airdrop --score=92",
    "  node scripts/report.js --type=wallet --value=0x... --category=wallet_drainer --score=98",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.type || !args.value || !args.category || args.score === undefined) {
    throw new Error(usage());
  }

  const result = await submitReport(args);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exitCode = 1;
});
