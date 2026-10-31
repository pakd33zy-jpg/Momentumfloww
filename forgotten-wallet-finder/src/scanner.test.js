import test from "node:test";
import assert from "node:assert/strict";
import { scanCandidate } from "./scanner.js";

test("rejects unsupported chains instead of guessing", async () => {
  await assert.rejects(() => scanCandidate({ chain: "unknown", address: "x" }), /Unsupported chain/);
});

test("requires a configured EVM RPC", async () => {
  await assert.rejects(() => scanCandidate({ chain: "ethereum", address: "0x0000000000000000000000000000000000000000", sourceUrl: "https://example.org", evidence: "public claim" }), /Missing RPC URL/);
});
