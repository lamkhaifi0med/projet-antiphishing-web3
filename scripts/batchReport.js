const fs = require("node:fs/promises");
const path = require("node:path");
const { parseArgs } = require("./lib/registry");
const { submitReport } = require("./lib/reporting");

function usage() {
  return "Usage: node scripts/batchReport.js --file=./reports.json";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error(usage());
  }

  const filename = path.resolve(process.cwd(), args.file);
  const input = JSON.parse(await fs.readFile(filename, "utf8"));
  const reports = Array.isArray(input) ? input : input.reports;
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error(
      "The JSON file must be a non-empty array or an object containing a reports array.",
    );
  }

  const results = [];
  for (const [index, report] of reports.entries()) {
    try {
      results.push({ index, ...(await submitReport(report)) });
    } catch (error) {
      results.push({ index, status: "error", message: error.message });
    }
  }

  console.log(JSON.stringify({ processed: reports.length, results }));
  if (results.some((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }));
  process.exitCode = 1;
});
