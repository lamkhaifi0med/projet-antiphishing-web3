"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATEGORY_NAMES,
  hashNormalizedUrl,
  normalizeCategory,
  normalizeScore,
  normalizeUrl,
  normalizeWallet,
  parseArgs,
} = require("../scripts/lib/registry");

test("normalizeUrl applies the shared canonicalization rule", () => {
  assert.equal(
    normalizeUrl("HTTPS://www.Blnance-Support.XYZ/claim/?ref=x#top"),
    "blnance-support.xyz/claim",
  );
});

test("normalizeUrl preserves a meaningful path and non-default port", () => {
  assert.equal(
    normalizeUrl("https://Example.COM:8443/Claim/Step-1/"),
    "example.com:8443/Claim/Step-1",
  );
});

test("equivalent URL variants produce the same hash", () => {
  const left = normalizeUrl("https://www.example.invalid/claim/?ref=one#top");
  const right = normalizeUrl("http://example.invalid/claim");
  assert.equal(left, right);
  assert.equal(hashNormalizedUrl(left), hashNormalizedUrl(right));
});

test("normalizeUrl rejects invalid, credentialed, and unsupported URLs", () => {
  assert.throws(() => normalizeUrl("not-a-url"), /Invalid URL/);
  assert.throws(
    () => normalizeUrl("https://user:secret@example.invalid/"),
    /credentials are not accepted/,
  );
  assert.throws(
    () => normalizeUrl("ftp://example.invalid/file"),
    /Only http:\/\/ and https:\/\//,
  );
});

test("normalizeWallet returns an EIP-55 checksummed address", () => {
  assert.equal(
    normalizeWallet("0x000000000000000000000000000000000000dead"),
    "0x000000000000000000000000000000000000dEaD",
  );
});

test("normalizeWallet rejects malformed addresses", () => {
  assert.throws(() => normalizeWallet("0x1234"), /Invalid EVM wallet/);
  assert.throws(() => normalizeWallet(""), /non-empty EVM wallet/);
});

test("normalizeCategory maps every supported category to its enum id", () => {
  CATEGORY_NAMES.forEach((name, id) => {
    assert.deepEqual(normalizeCategory(name), { name, id });
  });
});

test("normalizeCategory rejects unsupported blockchain categories", () => {
  assert.throws(() => normalizeCategory("legitimate"), /Invalid category/);
  assert.throws(() => normalizeCategory("scam"), /Invalid category/);
});

test("normalizeScore accepts integer numbers and decimal CLI strings", () => {
  assert.equal(normalizeScore(0), 0);
  assert.equal(normalizeScore(100), 100);
  assert.equal(normalizeScore("92"), 92);
  assert.equal(normalizeScore(" 80 "), 80);
});

test("normalizeScore rejects coercible and out-of-range values", () => {
  const invalidValues = [
    "",
    " ",
    null,
    false,
    true,
    "1e2",
    "0x64",
    "01",
    -1,
    101,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => normalizeScore(value),
      /Score must be an integer from 0 to 100/,
      `expected ${String(value)} to be rejected`,
    );
  }
});

test("parseArgs supports inline and separated values", () => {
  assert.deepEqual(
    parseArgs([
      "--type=url",
      "--value",
      "https://example.invalid/claim",
      "--score=92",
    ]),
    {
      type: "url",
      value: "https://example.invalid/claim",
      score: "92",
    },
  );
});

test("parseArgs handles follow as a value-less flag", () => {
  assert.deepEqual(parseArgs(["--follow"]), { follow: true });
  assert.throws(() => parseArgs(["--follow=true"]), /does not accept a value/);
});

test("parseArgs rejects positional arguments and missing values", () => {
  assert.throws(() => parseArgs(["unexpected"]), /Unexpected argument/);
  assert.throws(() => parseArgs(["--type"]), /Missing value/);
  assert.throws(() => parseArgs(["--type="]), /Missing value/);
});
