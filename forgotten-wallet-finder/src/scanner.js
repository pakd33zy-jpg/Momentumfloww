const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const timeout = AbortSignal.timeout(15000);

async function getJson(url) {
  const response = await fetch(url, { signal: timeout, headers: { "user-agent": "ForgottenWalletFinder/0.1 (public-chain-research)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from public data provider`);
  return response.json();
}

async function scanBitcoin(address) {
  const [stats, txs, tip] = await Promise.all([
    getJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`),
    getJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}/txs`),
    getJson("https://blockstream.info/api/blocks/tip/height")
  ]);
  const chainStats = stats.chain_stats || {};
  const funded = (chainStats.funded_txo_sum || 0) - (chainStats.spent_txo_sum || 0);
  // Blockstream returns newest transactions first. Unconfirmed activity is treated as current.
  const newest = Array.isArray(txs) ? txs[0] : null;
  const lastSeen = newest ? (newest.status?.confirmed ? newest.status.block_time : Math.floor(Date.now() / 1000)) : 0;
  return { balance: funded / 1e8, unit: "BTC", lastActivity: lastSeen ? new Date(lastSeen * 1000).toISOString() : null, confirmationsTip: tip };
}

async function scanEvm(address, rpcUrl, unit) {
  if (!rpcUrl) throw new Error("Missing RPC URL for this EVM chain (set the chain-specific environment variable).");
  const body = (method, params = []) => fetch(rpcUrl, {
    method: "POST", signal: timeout, headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }).then(async r => { if (!r.ok) throw new Error(`RPC HTTP ${r.status}`); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; });
  const [wei, latestHex] = await Promise.all([body("eth_getBalance", [address, "latest"]), body("eth_blockNumber")]);
  const latest = Number(BigInt(latestHex));
  // Binary search first block with a transaction involving this address is not generally possible via standard RPC.
  // Do not invent inactivity: require an indexed explorer endpoint for transaction history.
  return { balance: Number(BigInt(wei)) / 1e18, unit, lastActivity: null, latestBlock: latest, historyStatus: "requires indexed explorer history" };
}

export async function scanCandidate(candidate, minInactiveYears = 2) {
  const chain = String(candidate.chain || "").toLowerCase();
  let data;
  if (chain === "bitcoin" || chain === "btc") data = await scanBitcoin(candidate.address);
  else if (["ethereum", "polygon", "base", "arbitrum", "optimism", "avalanche", "bsc"].includes(chain)) {
    const envKey = ({ ethereum:"ETHEREUM_RPC_URL", polygon:"POLYGON_RPC_URL", base:"BASE_RPC_URL", arbitrum:"ARBITRUM_RPC_URL", optimism:"OPTIMISM_RPC_URL", avalanche:"AVALANCHE_RPC_URL", bsc:"BSC_RPC_URL" })[chain];
    data = await scanEvm(candidate.address, process.env[envKey], ({ethereum:"ETH",polygon:"MATIC",base:"ETH",arbitrum:"ETH",optimism:"ETH",avalanche:"AVAX",bsc:"BNB"})[chain]);
  } else {
    throw new Error("Unsupported chain. Add a reviewed chain adapter before scanning.");
  }
  const cutoff = Date.now() - minInactiveYears * YEAR_MS;
  const inactive = data.lastActivity ? Date.parse(data.lastActivity) < cutoff : null;
  const documented = Boolean(candidate.sourceUrl && candidate.evidence);
  return {
    chain, address: candidate.address, ...data,
    inactiveAtLeastThreshold: inactive,
    thresholdYears: minInactiveYears,
    documentedRecoveryEvidence: documented,
    evidence: candidate.evidence,
    sourceUrl: candidate.sourceUrl,
    classification: !documented ? "unverified" : inactive === true ? "documented-lead-needs-human-review" : inactive === false ? "active-within-threshold" : "history-unavailable",
    warning: "Dormancy does not establish abandonment, ownership, or legal authority to recover funds."
  };
}
