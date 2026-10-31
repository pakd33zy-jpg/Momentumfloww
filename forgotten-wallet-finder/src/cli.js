import fs from "node:fs/promises";
import { scanCandidate } from "./scanner.js";

const file = process.env.CANDIDATES_FILE || new URL("../candidates.json", import.meta.url);
const minInactiveYears = Number(process.env.MIN_INACTIVE_YEARS || 2);
const candidates = JSON.parse(await fs.readFile(file, "utf8")).candidates || [];
const results = [];
for (const candidate of candidates) {
  if (!candidate.address || !candidate.sourceUrl || !candidate.evidence) continue;
  try {
    const result = await scanCandidate(candidate, minInactiveYears);
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { chain: candidate.chain, address: candidate.address, status: "error", error: error.message };
    results.push(result);
    console.error(JSON.stringify(result));
  }
}
await fs.writeFile("scan-results.json", JSON.stringify({ scannedAt: new Date().toISOString(), minInactiveYears, results }, null, 2));
console.log(`Completed: ${results.length} documented candidate(s). This scanner does not discover private keys or prove ownership is abandoned.`);
