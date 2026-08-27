import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

function addReason(map, row, source) {
  if (!row?.reason) return;
  const key = `${source}:${row.reason}`;
  const current = map.get(key) || {
    reason: row.reason,
    source,
    count: 0,
    snapshots: 0,
  };
  current.count += Number(row.count || 0);
  current.snapshots += 1;
  map.set(key, current);
}

function summarize(entries) {
  const blockers = new Map();
  const near = new Map();
  let qualifiedScans = 0;
  let qualifiedSetups = 0;
  let marketOpenScans = 0;
  let liquidityRejects = 0;

  for (const entry of entries) {
    if (entry?.market_open) marketOpenScans += 1;
    if (Number(entry?.qualified || 0) > 0) qualifiedScans += 1;
    qualifiedSetups += Number(entry?.qualified || 0);

    for (const row of entry?.top_prefilter_rejections?.equities || []) {
      addReason(blockers, row, 'Equity prefilter');
      if (String(row?.reason || '').includes('dollar volume')) {
        liquidityRejects += Number(row?.count || 0);
      }
    }
    for (const row of entry?.top_strategy_rejections?.equities || []) {
      addReason(blockers, row, 'Equity strategy');
    }
    for (const row of entry?.top_prefilter_rejections?.crypto || []) {
      addReason(blockers, row, 'Crypto prefilter');
    }
    for (const row of entry?.top_strategy_rejections?.crypto || []) {
      addReason(blockers, row, 'Crypto strategy');
    }

    for (const miss of entry?.near_misses || []) {
      const key = `${miss?.assetClass || 'unknown'}:${miss?.reason || 'unknown'}`;
      const current = near.get(key) || {
        reason: miss?.reason || 'unknown',
        assetClass: miss?.assetClass || 'unknown',
        count: 0,
        bestScore: null,
        symbols: new Set(),
      };
      current.count += 1;
      if (miss?.score != null && Number.isFinite(Number(miss.score))) {
        current.bestScore = current.bestScore == null
          ? Number(miss.score)
          : Math.max(current.bestScore, Number(miss.score));
      }
      if (miss?.symbol) current.symbols.add(miss.symbol);
      near.set(key, current);
    }
  }

  return {
    scans: entries.length,
    marketOpenScans,
    qualifiedScans,
    qualifiedSetups,
    liquidityRejects,
    blockers: [...blockers.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    near: [...near.values()]
      .sort((a, b) => Number(b.bestScore ?? -1) - Number(a.bestScore ?? -1) || b.count - a.count)
      .slice(0, 8)
      .map((row) => ({ ...row, symbols: [...row.symbols].slice(0, 5) })),
  };
}

export default function RejectionLogPanel() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const summary = useMemo(() => summarize(entries), [entries]);

  async function refresh() {
    try {
      setLoading(true);
      setError('');
      const data = await api.getRejectionLog(100);
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || 'Failed to load rejection log.');
    } finally {
      setLoading(false);
    }
  }

  async function clearLog() {
    if (!window.confirm('Clear rejection log?')) return;
    try {
      await api.clearRejectionLog();
      setEntries([]);
    } catch (err) {
      setError(err?.message || 'Failed to clear rejection log.');
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={panel}>
      <div style={header}>
        <div>
          <strong style={title}>Strategy Diagnostics</strong>
          <div style={subtitle}>
            Aggregated rejection counts from recent scans. Counts are rejection events, not unique symbols.
          </div>
        </div>

        <div>
          <button onClick={refresh} style={button}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={clearLog} style={clearButton}>
            Clear
          </button>
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {!!entries.length && (
        <>
          <div style={summaryGrid}>
            <Metric label="Recent scans" value={summary.scans} />
            <Metric label="Market-open scans" value={summary.marketOpenScans} />
            <Metric label="Scans with setup" value={`${summary.qualifiedScans}/${summary.scans}`} />
            <Metric label="Qualified setups" value={summary.qualifiedSetups} />
          </div>

          <div style={analysisGrid}>
            <div style={analysisCard}>
              <strong>Top blockers across recent scans</strong>
              <div style={helper}>
                Repeated scans can reject the same symbol more than once; these are event counts, not unique stocks.
              </div>
              {summary.blockers.map((item) => (
                <div key={`${item.source}:${item.reason}`} style={analysisRow}>
                  <span>{item.source}: {item.reason}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
              {!summary.blockers.length && <div style={empty}>No blocker data yet.</div>}
            </div>

            <div style={analysisCard}>
              <strong>Closest rejected setups</strong>
              <div style={helper}>
                Sorted by best score first, then frequency.
              </div>
              {summary.near.map((item) => (
                <div key={`${item.assetClass}:${item.reason}`} style={nearSummaryRow}>
                  <div>
                    <strong>{item.bestScore == null ? 'N/A' : `${item.bestScore}/10`}</strong> · {item.reason}
                    {!!item.symbols.length && (
                      <div style={symbols}>{item.symbols.join(', ')}</div>
                    )}
                  </div>
                  <span>{item.count}x</span>
                </div>
              ))}
              {!summary.near.length && <div style={empty}>No near misses yet.</div>}
            </div>
          </div>

          <div style={liquidityNote}>
            Recent liquidity-gate rejection events: <strong>{summary.liquidityRejects}</strong>.
            The backend now uses adaptive liquidity thresholds rather than a fixed $5M gate.
          </div>
        </>
      )}

      {!entries.length && !error && (
        <div style={empty}>
          No rejection data yet. Start the PAPER bot and this log will fill automatically.
        </div>
      )}

      {entries.map((entry) => {
        const strategyEquity = entry?.top_strategy_rejections?.equities?.[0];
        const strategyCrypto = entry?.top_strategy_rejections?.crypto?.[0];
        const prefilterEquity = entry?.top_prefilter_rejections?.equities?.[0];
        const prefilterCrypto = entry?.top_prefilter_rejections?.crypto?.[0];
        const top = strategyEquity || strategyCrypto || prefilterEquity || prefilterCrypto;
        const near = entry?.near_misses?.[0];

        return (
          <div key={entry.id} style={row}>
            <div style={time}>{new Date(entry.timestamp).toLocaleString()}</div>
            <div>
              <strong>{String(entry.mode || '').toUpperCase()}</strong>
              {' · '}Qualified setups: {entry.qualified ?? 0}
            </div>
            <div style={reject}>
              Top reject: <strong>{top ? `${top.reason} (${top.count})` : 'None'}</strong>
            </div>
            {entry?.liquidity_gate?.samples?.length > 0 && (
              <div style={liquiditySamples}>
                Liquidity samples: {entry.liquidity_gate.samples.slice(0, 3).map((x) =>
                  `${x.symbol} prev $${Number(x.completedDayDollarVolume || 0).toLocaleString()}`
                ).join(' · ')}
              </div>
            )}
            {near && (
              <div style={nearMiss}>
                Near miss: {near.symbol} · score {near.score == null ? 'N/A' : `${near.score}/10`} · {near.reason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={metric}>
      <div style={metricLabel}>{label}</div>
      <strong style={metricValue}>{value}</strong>
    </div>
  );
}

const panel = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: 14 };
const header = { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 };
const title = { color: '#4ade80' };
const subtitle = { color: '#94a3b8', fontSize: 11, marginTop: 4, maxWidth: 720 };
const button = { background: '#1e293b', color: '#fff', border: '1px solid #475569', borderRadius: 7, padding: '7px 10px', cursor: 'pointer' };
const clearButton = { ...button, marginLeft: 6, color: '#f87171' };
const summaryGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 };
const metric = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10 };
const metricLabel = { color: '#94a3b8', fontSize: 10 };
const metricValue = { display: 'block', marginTop: 3, fontSize: 16, color: '#e2e8f0' };
const analysisGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginBottom: 10 };
const analysisCard = { background: '#0b1220', border: '1px solid #334155', borderRadius: 8, padding: 10, color: '#cbd5e1', fontSize: 11 };
const helper = { color: '#64748b', fontSize: 10, margin: '3px 0 7px' };
const analysisRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.04)' };
const nearSummaryRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.04)' };
const symbols = { color: '#94a3b8', fontSize: 10, marginTop: 2 };
const liquidityNote = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 9, marginBottom: 10, color: '#93c5fd', fontSize: 10, lineHeight: 1.45 };
const row = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 11, color: '#cbd5e1' };
const time = { color: '#94a3b8', marginBottom: 5 };
const reject = { marginTop: 5 };
const nearMiss = { marginTop: 5, color: '#fbbf24' };
const liquiditySamples = { marginTop: 5, color: '#93c5fd' };
const empty = { color: '#94a3b8', padding: 10 };
const errorStyle = { color: '#f87171', padding: 10 };
