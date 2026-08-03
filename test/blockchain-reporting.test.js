"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { submitReport } = require("../scripts/lib/reporting");

const REPORTER = "0x000000000000000000000000000000000000dEaD";
const WALLET = "0x0000000000000000000000000000000000000001";

function entry({ active = false, category = 2n, score = 92n } = {}) {
  return {
    category,
    score,
    timestamp: active ? 1_721_838_659n : 0n,
    reporter: active ? REPORTER : "0x0000000000000000000000000000000000000000",
    active,
  };
}

function dependencies(registry) {
  return {
    getReporterRegistryImpl: () => ({
      registry,
      reporter: { address: REPORTER },
    }),
  };
}

test("submitReport publishes and confirms a new URL report", async () => {
  const calls = [];
  const registry = {
    async getURLEntry() {
      return entry();
    },
    async reportURL(urlHash, category, score) {
      calls.push({ urlHash, category, score });
      return {
        hash: "0xreported",
        async wait() {
          calls.push({ waited: true });
        },
      };
    },
  };

  const result = await submitReport(
    {
      type: "url",
      value: "HTTPS://www.Example.invalid/claim/?source=test#top",
      category: "fake_airdrop",
      score: 92,
    },
    dependencies(registry),
  );

  assert.equal(result.status, "reported");
  assert.equal(result.normalizedValue, "example.invalid/claim");
  assert.equal(result.category, "fake_airdrop");
  assert.equal(result.score, 92);
  assert.equal(result.txHash, "0xreported");
  assert.equal(calls[0].category, 2);
  assert.equal(calls[0].score, 92);
  assert.equal(calls[1].waited, true);
});

test("submitReport does not send a transaction for an existing URL", async () => {
  let reportCalls = 0;
  const registry = {
    async getURLEntry() {
      return entry({ active: true });
    },
    async reportURL() {
      reportCalls += 1;
    },
  };

  const result = await submitReport(
    {
      type: "url",
      value: "https://example.invalid/claim",
      category: "fake_airdrop",
      score: 92,
    },
    dependencies(registry),
  );

  assert.equal(result.status, "already_blacklisted");
  assert.equal(result.active, true);
  assert.equal(reportCalls, 0);
});

test("submitReport reconciles a concurrent URL publication", async () => {
  const duplicateError = new Error("EntryAlreadyActive");
  let reads = 0;
  const registry = {
    async getURLEntry() {
      reads += 1;
      return entry({ active: reads > 1 });
    },
    async reportURL() {
      throw duplicateError;
    },
  };

  const result = await submitReport(
    {
      type: "url",
      value: "https://race.invalid/claim",
      category: "fake_airdrop",
      score: 92,
    },
    dependencies(registry),
  );

  assert.equal(reads, 2);
  assert.equal(result.status, "already_blacklisted");
  assert.equal(result.reporter, REPORTER);
});

test("submitReport reconciles an uncertain wallet confirmation", async () => {
  const timeoutError = Object.assign(new Error("confirmation timeout"), {
    code: "TIMEOUT",
  });
  let reads = 0;
  const registry = {
    async getWalletEntry() {
      reads += 1;
      return entry({ active: reads > 1, category: 1n, score: 98n });
    },
    async reportWallet() {
      return {
        hash: "0xuncertain",
        async wait() {
          throw timeoutError;
        },
      };
    },
  };

  const result = await submitReport(
    {
      type: "wallet",
      value: WALLET.toLowerCase(),
      category: "wallet_drainer",
      score: 98,
    },
    dependencies(registry),
  );

  assert.equal(reads, 2);
  assert.equal(result.status, "already_blacklisted");
  assert.equal(result.normalizedValue, WALLET);
  assert.equal(result.category, "wallet_drainer");
  assert.equal(result.score, 98);
});

test("submitReport preserves the publication error if the entry is still inactive", async () => {
  const rpcError = Object.assign(new Error("RPC unavailable"), {
    code: "SERVER_ERROR",
  });
  const registry = {
    async getURLEntry() {
      return entry();
    },
    async reportURL() {
      throw rpcError;
    },
  };

  await assert.rejects(
    submitReport(
      {
        type: "url",
        value: "https://not-reported.invalid",
        category: "other",
        score: 80,
      },
      dependencies(registry),
    ),
    (error) => error === rpcError,
  );
});

test("submitReport does not replace the original error when reconciliation fails", async () => {
  const originalError = new Error("transaction failed");
  let reads = 0;
  const registry = {
    async getWalletEntry() {
      reads += 1;
      if (reads > 1) throw new Error("secondary read failed");
      return entry();
    },
    async reportWallet() {
      throw originalError;
    },
  };

  await assert.rejects(
    submitReport(
      {
        type: "wallet",
        value: WALLET,
        category: "other",
        score: 80,
      },
      dependencies(registry),
    ),
    (error) => error === originalError,
  );
});
