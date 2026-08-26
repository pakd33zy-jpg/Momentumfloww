from pathlib import Path

path = Path('momentumflow/v34Replay.js')
text = path.read_text(encoding='utf-8')

if "import fetch from 'node-fetch';" not in text:
    text = text.replace(
        "import { getCryptoBars } from './alpacaClient.js';",
        "import fetch from 'node-fetch';\nimport { getCryptoBars } from './alpacaClient.js';",
        1,
    )

start_marker = 'async function fetchBars(symbol, end) {'
end_marker = '\n\nasync function replaySymbol(symbol, end) {'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate fetchBars block')

replacement = r'''async function fetchResearchExportBars(symbol, timeframe, days, end) {
  const base = String(process.env.RESEARCH_BASE_URL || '').replace(/\/$/, '');
  const token = String(process.env.RESEARCH_EXPORT_TOKEN || '');
  if (!base || !token) return null;

  const query = new URLSearchParams({
    symbol,
    timeframe,
    days: String(days),
    end: end.toISOString(),
  });
  const response = await fetch(`${base}/api/research/crypto-bars?${query.toString()}`, {
    headers: { 'x-research-token': token },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Research export failed (${response.status}): ${data.error || response.statusText}`);
  }
  return Array.isArray(data.bars) ? data.bars : [];
}

async function fetchBars(symbol, end) {
  const start = new Date(end.getTime() - DAYS * 24 * 60 * 60 * 1000);

  // Preferred path for isolated Railway replay: use the production backend's
  // protected bars-only research export. This avoids copying saved Alpaca keys.
  if (process.env.RESEARCH_BASE_URL && process.env.RESEARCH_EXPORT_TOKEN) {
    const [b15, b1h, b1d] = await Promise.all([
      fetchResearchExportBars(symbol, '15Min', Math.min(365, DAYS + 3), end),
      fetchResearchExportBars(symbol, '1Hour', Math.min(730, DAYS + 10), end),
      fetchResearchExportBars(symbol, '1Day', Math.min(1825, DAYS + 50), end),
    ]);
    return { start, b15, b1h, b1d };
  }

  // Local fallback for a developer machine that has paper credentials directly.
  const dailyWarmup = new Date(start.getTime() - 50 * 24 * 60 * 60 * 1000);
  const hourlyWarmup = new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000);
  const fifteenWarmup = new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000);

  const [b15, b1h, b1d] = await Promise.all([
    getCryptoBars('paper', [symbol], {
      timeframe: '15Min', start: fifteenWarmup, end, limit: 10000, sort: 'asc', maxPages: 5,
    }),
    getCryptoBars('paper', [symbol], {
      timeframe: '1Hour', start: hourlyWarmup, end, limit: 10000, sort: 'asc', maxPages: 3,
    }),
    getCryptoBars('paper', [symbol], {
      timeframe: '1Day', start: dailyWarmup, end, limit: 10000, sort: 'asc', maxPages: 2,
    }),
  ]);

  return {
    start,
    b15: b15[symbol] || b15[symbol.replace('/', '')] || [],
    b1h: b1h[symbol] || b1h[symbol.replace('/', '')] || [],
    b1d: b1d[symbol] || b1d[symbol.replace('/', '')] || [],
  };
}'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding='utf-8')
print('Patched v34Replay.js for protected research-export data source')
