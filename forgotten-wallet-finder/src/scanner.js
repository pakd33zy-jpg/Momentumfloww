const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const timeoutMs = 15000;

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "ForgottenWalletFinder/0.2 (public-chain-research)" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from public data provider`);
  return response.json();
}

async function scanBitcoin(address) {
  const [stats, txs] = await Promise.all([
    getJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`),
    getJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}/txs`)
  ]);
  const chainStats = stats.chain_stats || {};
  const balanceSats = (chainStats.funded_txo_sum || 0) - (chainStats.spent_txo_sum || 0);
  const newest = Array.isArray(txs) ? txs[0] : null;
  const lastSeen = newest ? (newest.status?.confirmed ? newest.status.block_time : Math.floor(Date.now() / 1000)) : null;
  return { balance: balanceSats / 1e8, unit: "BTC", lastActivity: lastSeen ? new Date(lastSeen * 1000).toISOString() : null, historyStatus: "Blockstream address transaction history" };
}

async function scanEthereum(address) {
  const [account, txs] = await Promise.all([
    getJson(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}`),
    getJson(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}/transactions`)
  ]);
  const wei = BigInt(account.coin_balance || "0");
  const items = Array.isArray(txs.items) ? txs.items : [];
  const newest = items[0];
  const lastSeen = newest?.timestamp ? Date.parse(newest.timestamp) : null;
  return { balance: Number(wei) / 1e18, unit: "ETH", lastActivity: Number.isFinite(lastSeen) ? new Date(lastSeen).toISOString() : null, historyStatus: "Blockscout indexed transaction history" };
}

async function priceUsd(unit) {
  const ids = { BTC: "bitcoin", ETH: "ethereum", MATIC: "matic-network", AVAX: "avalanche-2", BNB: "binancecoin" };
  const id = ids[unit];
  if (!id) return null;
  try {
    const data = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
    return data[id]?.usd ?? null;
  } catch {
    return null; // Price enrichment is optional; never fail the chain scan because of it.
  }
}

export async function scanCandidate(candidate, minInactiveYears = 2) {
  const chain = String(candidate.chain || "").toLowerCase();
  let data;
  if (chain === "bitcoin" || chain === "btc") data = await scanBitcoin(candidate.address);
  else if (chain === "ethereum" || chain === "eth") data = await scanEthereum(candidate.address);
  else {
    throw new Error("Supported discovery adapters are Bitcoin and Ethereum. Other EVM networks need their own indexed-history adapter.");
  }
  const cutoff = Date.now() - minInactiveYears * YEAR_MS;
  const inactive = data.lastActivity ? Date.parse(data.lastActivity) < cutoff : null;
  const documented = Boolean(candidate.sourceUrl && candidate.evidence);
  const price = await priceUsd(data.unit);
  const valueUsd = price === null ? null : data.balance * price;
  return {
    chain, address: candidate.address, ...data,
    priceUsd: price, estimatedValueUsd: valueUsd,
    inactiveAtLeastThreshold: inactive,
    thresholdYears: minInactiveYears,
    documentedRecoveryEvidence: documented,
    evidence: candidate.evidence,
    sourceUrl: candidate.sourceUrl,
    classification: !documented ? "unverified" : inactive === true ? "documented-lead-needs-human-review" : inactive === false ? "active-within-threshold" : "history-unavailable",
    warning: "Dormancy and balance do not establish abandonment, ownership, or legal authority to recover funds."
  };
}
