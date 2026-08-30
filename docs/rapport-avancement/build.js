"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const sourceDir = path.join(root, "src");
const outputPath = path.join(root, "rapport-avancement.html");

const pageFiles = fs
  .readdirSync(sourceDir)
  .filter((name) => /^part-\d+\.html$/.test(name))
  .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));

if (pageFiles.length === 0) {
  throw new Error("Aucun fragment de page trouvé dans src/.");
}

const chunks = [
  fs.readFileSync(path.join(sourceDir, "document-start.html"), "utf8"),
  ...pageFiles.map((name) =>
    fs.readFileSync(path.join(sourceDir, name), "utf8"),
  ),
  fs.readFileSync(path.join(sourceDir, "document-end.html"), "utf8"),
];

const html = chunks.join("\n");
const pageNumbers = [...html.matchAll(/data-page="(\d+)"/g)].map((match) =>
  Number(match[1]),
);
const expected = Array.from({ length: 20 }, (_, index) => index + 1);

if (JSON.stringify(pageNumbers) !== JSON.stringify(expected)) {
  throw new Error(
    `Pages invalides : ${pageNumbers.join(", ")} (attendu : 1 à 20).`,
  );
}

fs.writeFileSync(outputPath, html, "utf8");
console.log(`Rapport assemblé : ${outputPath}`);
console.log(`Fragments : ${pageFiles.length} — pages : ${pageNumbers.length}`);
