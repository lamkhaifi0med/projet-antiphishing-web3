"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkEntry,
  isTransientRpcError,
  latestTransactionHash,
  toPublicCheckResult,
} = require("../scripts/lib/checking");

const REPORTER = "0x000000000000000000000000000000000000dEaD";
const WALLET = "0x0000000000000000000000000000000000000001";

function inactiveEntry() {
  return {
    category: 0n,
    score: 0n,
    timestamp: 0n,
    reporter: "0x0000000000000000000000000000000000000000",
    active: false,
  };
}

function activeEntry() {
  return {
    category: 2n,
    score: 92n,
    timestamp: 1_721_838_659n,
    reporter: REPORTER,
    active: true,
  };
}

function fakeRegistry({
  urlEntry = inactiveEntry(),
  walletEntry = inactiveEntry(),
  events = [],
} = {}) {
  return {
    filters: {
      URLReported: (urlHash) => ({ event: "URLReported", urlHash }),
      WalletReported: (wallet) => ({ event: "WalletReported", wallet }),
    },
    async getURLEntry() {
      return urlEntry;
    },
    async getWalletEntry() {
      return walletEntry;
    },
    async queryFilter() {
      return events;
    },
  };
}

test("checkEntry returns internal URL metadata for an unknown entry", async () => {
  const result = await checkEntry(fakeRegistry(), {
    type: "URL",
    value: "HTTPS://www.Safe-Example.invalid/path/?q=1#top",
  });

  assert.equal(result.blacklisted, false);
  assert.equal(result.type, "url");
  assert.equal(result.normalizedValue, "safe-example.invalid/path");
  assert.match(result.urlHash, /^0x[0-9a-f]{64}$/);
  assert.equal("reporter" in result, false);
});

test("checkEntry returns an active URL entry and its latest report transaction", async () => {
  const result = await checkEntry(
    fakeRegistry({
      urlEntry: activeEntry(),
      events: [{ transactionHash: "0xold" }, { transactionHash: "0xlatest" }],
    }),
    { type: "url", value: "https://reported.invalid/claim" },
  );

  assert.equal(result.blacklisted, true);
  assert.equal(result.category, "fake_airdrop");
  assert.equal(result.score, 92);
  assert.equal(result.reporter, REPORTER);
  assert.equal(result.txHash, "0xlatest");
});

test("checkEntry normalizes and reads a wallet entry", async () => {
  const result = await checkEntry(
    fakeRegistry({ walletEntry: activeEntry(), events: [] }),
    { type: "wallet", value: WALLET.toLowerCase() },
  );

  assert.equal(result.blacklisted, true);
  assert.equal(result.type, "wallet");
  assert.equal(result.normalizedValue, WALLET);
  assert.equal(result.txHash, null);
});

test("latestTransactionHash retries only transient RPC failures", async () => {
  let attempts = 0;
  const waits = [];
  const registry = {
    async queryFilter() {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("temporary RPC failure");
        error.code = "SERVER_ERROR";
        throw error;
      }
      return [{ transactionHash: "0xrecovered" }];
    },
  };

  const result = await latestTransactionHash(
    registry,
    {},
    {
      fromBlock: 1,
      waitFn: async (milliseconds) => waits.push(milliseconds),
    },
  );

  assert.equal(result, "0xrecovered");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [250, 500]);

  const permanent = new Error("invalid request");
  permanent.code = "BAD_DATA";
  let permanentAttempts = 0;
  await assert.rejects(
    latestTransactionHash(
      {
        async queryFilter() {
          permanentAttempts += 1;
          throw permanent;
        },
      },
      {},
      { waitFn: async () => {} },
    ),
    permanent,
  );
  assert.equal(permanentAttempts, 1);
});

test("isTransientRpcError recognizes retryable codes and statuses", () => {
  assert.equal(isTransientRpcError({ code: "TIMEOUT" }), true);
  assert.equal(isTransientRpcError({ status: 429 }), true);
  assert.equal(isTransientRpcError({ statusCode: 503 }), true);
  assert.equal(isTransientRpcError({ code: "BAD_DATA", status: 400 }), false);
});

test("toPublicCheckResult removes every internal blockchain field", () => {
  assert.deepEqual(
    toPublicCheckResult({ blacklisted: false, urlHash: "secret-ish" }),
    {
      blacklisted: false,
    },
  );

  assert.deepEqual(
    toPublicCheckResult({
      blacklisted: true,
      type: "url",
      normalizedValue: "reported.invalid/claim",
      urlHash: "0xhash",
      category: "fake_airdrop",
      score: 92,
      since: "2024-07-24T16:30:59.000Z",
      reporter: REPORTER,
      active: true,
      txHash: "0xtx",
    }),
    {
      blacklisted: true,
      category: "fake_airdrop",
      score: 92,
      since: "2024-07-24T16:30:59.000Z",
      txHash: "0xtx",
    },
  );
});
