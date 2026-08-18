"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");

const CHECK_SCRIPT = path.resolve(__dirname, "../../../scripts/check.js");

function runCheck({ type, value }, options = {}) {
  const executable = options.executable || process.execPath;
  const script = options.script || CHECK_SCRIPT;

  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [script, `--type=${type}`, `--value=${value}`],
      {
        cwd: path.resolve(__dirname, "../../.."),
        env: process.env,
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || "").trim();
          reject(new Error(detail || `check.js a echoue : ${error.message}`));
          return;
        }

        try {
          const result = JSON.parse(String(stdout).trim());
          if (typeof result !== "object" || result === null || typeof result.blacklisted !== "boolean") {
            throw new Error("sortie JSON inattendue");
          }
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Sortie check.js invalide : ${parseError.message}`));
        }
      },
    );
  });
}

module.exports = { CHECK_SCRIPT, runCheck };
