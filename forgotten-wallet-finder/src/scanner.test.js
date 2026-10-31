import test from "node:test";
import assert from "node:assert/strict";
import { scanCandidate } from "./scanner.js";

test("rejects unsupported chains instead of guessing", async () => {
  await assert.rejects(() => scanCandidate({ chain: "unknown", address: "x" }), /Supported discovery adapters/);
});

test("uses indexed Ethereum history and labels old documented candidates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/api/v2/addresses/") && value.endsWith("/transactions")) {
      return { ok: true, json: async () => ({ items: [{ timestamp: "2020-01-01T00:00:00.000000Z" }] }) };
    }
    if (value.includes("/api/v2/addresses/")) {
      return { ok: true, json: async () => ({ coin_balance: "1000000000000000000" }) };
    }
    if (value.includes("coingecko.com")) {
      return { ok: true, json: async () => ({ ethereum: { usd: 3000 } }) };
    }
    throw new Error("Unexpected URL " + value);
  };
  try {
    const result = await scanCandidate({
      chain: "ethereum",
      address: "0x0000000000000000000000000000000000000000",
      sourceUrl: "https://example.org/case",
      evidence: "Published recovery case"
    });
    assert.equal(result.inactiveAtLeastThreshold, true);
    assert.equal(result.documentedRecoveryEvidence, true);
    assert.equal(result.estimatedValueUsd, 3000);
    assert.equal(result.classification, "documented-lead-needs-human-review");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
