"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const htmlPath = path.join(root, "rapport-avancement.html");
const pdfPath = path.join(
  root,
  "Rapport-avancement_Anti-Phishing-Web3_11-08-2026.pdf",
);

const html = fs.readFileSync(htmlPath, "utf8");
const htmlPages = [
  ...html.matchAll(/<section\s+class="[^"]*page[^"]*"\s+data-page="(\d+)"/g),
].map((match) => Number(match[1]));
const expectedPages = Array.from({ length: 20 }, (_, index) => index + 1);

if (JSON.stringify(htmlPages) !== JSON.stringify(expectedPages)) {
  throw new Error(`Séquence HTML invalide : ${htmlPages.join(", ")}.`);
}

for (const requiredText of [
  "Lamkhaifi Mohamed",
  "Malek Mouhcine",
  "11 août 2026",
  "46,2&nbsp;%",
  "WF1",
  "WF2",
  "E2E",
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Texte obligatoire absent du HTML : ${requiredText}`);
  }
}

const pdf = fs.readFileSync(pdfPath);
if (pdf.length < 500_000) {
  throw new Error(`PDF anormalement petit : ${pdf.length} octets.`);
}
if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
  throw new Error("Signature PDF absente.");
}
if (!pdf.subarray(-1_024).toString("latin1").includes("%%EOF")) {
  throw new Error("Marqueur de fin PDF absent.");
}

const pdfText = pdf.toString("latin1");
const pdfPages = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
if (pdfPages !== 20) {
  throw new Error(`Nombre de pages PDF invalide : ${pdfPages} (attendu : 20).`);
}

console.log(`HTML : ${htmlPages.length} pages dans l’ordre 1–20.`);
console.log(
  `PDF  : ${pdfPages} pages, ${pdf.length} octets, structure complète.`,
);
console.log("Mentions obligatoires et statuts transparents présents.");
