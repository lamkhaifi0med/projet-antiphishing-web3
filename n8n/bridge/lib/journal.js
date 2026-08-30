"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createJournal(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const records = new Map();

  if (fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record?.reportId) records.set(record.reportId, record);
      } catch {
        throw new Error(
          `Journal corrompu : ligne JSON invalide dans ${filePath}`,
        );
      }
    }
  }

  let writeQueue = Promise.resolve();

  async function persist() {
    const temporaryPath = `${filePath}.tmp`;
    const payload = [...records.values()]
      .map((record) => JSON.stringify(record))
      .join("\n");
    await fs.promises.writeFile(
      temporaryPath,
      payload ? `${payload}\n` : "",
      "utf8",
    );
    await fs.promises.rename(temporaryPath, filePath);
  }

  async function append(record) {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        if (records.has(record.reportId)) {
          return { created: false, record: records.get(record.reportId) };
        }
        records.set(record.reportId, record);
        try {
          await persist();
        } catch (error) {
          records.delete(record.reportId);
          throw error;
        }
        return { created: true, record };
      });
    return writeQueue;
  }

  async function update(reportId, patch) {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        const current = records.get(reportId);
        if (!current) return;
        records.set(reportId, {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        });
        try {
          await persist();
        } catch (error) {
          records.set(reportId, current);
          throw error;
        }
      });
    await writeQueue;
    return records.get(reportId) || null;
  }

  return {
    append,
    update,
    get: (reportId) => records.get(reportId) || null,
    recent: (limit = 10) =>
      [...records.values()]
        .sort((a, b) =>
          String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
        )
        .slice(0, limit),
  };
}

module.exports = { createJournal };
