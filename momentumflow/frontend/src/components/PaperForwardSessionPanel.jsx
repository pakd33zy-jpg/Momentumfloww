import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function PaperForwardSessionPanel() {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setError('');
      const status = await api.getLiveBotStatus();
      setRow(status?.paperForwardSession || null);
    } catch (err) {
      setError(err?.message || 'Failed to load paper-forward session metrics.');
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
          <strong style={title}>Paper-Forward Session</strong>
          <div style={subtitle}>
            Execution and exposure diagnostics for the current bot session. Measurement only.
          </div>
        </div>
        <button type="button" onClick={refresh} style={button}>Refresh</button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {!error && !row && (
        <div style={empty}>No active or recoverable session metrics yet.</div>
      )}

      {row && (
        <>
          <div style={grid}>
            <Metric label="Mode" value={String(row.mode || '').toUpperCase()} />
            <Metric label="Trades entered" value={row.tradesEntered} />
            <Metric label="Closed / open" value={`${row.closedTrades} / ${row.openTrades}`} />
            <Metric label="Realized P&L" value={money(row.realizedPnl)} tone={Number(row.realizedPnl) >= 0 ? 'good' : 'bad'} />
            <Metric label="Session return" value={pct(row.realizedReturnPct)} tone={Number(row.realizedReturnPct) >= 0 ? 'good' : 'bad'} />
            <Metric label="Win rate" value={pct(row.winRatePct)} />
            <Metric label="Current exposure est." value={pct(row.currentExposurePctEstimate)} />
            <Metric label="Max concurrent exposure est." value={pct(row.maxConcurrentExposurePctEstimate)} />
            <Metric label="Max single trade exposure" value={pct(row.maxSingleTradeExposurePct)} />
            <Metric label="Avg entry slippage" value={bps(row.avgEntrySlippageBps)} />
            <Metric label="Avg exit slippage" value={bps(row.avgExitSlippageBps)} />
            <Metric label="Partial entries" value={row.partialEntries} />
            <Metric label="Reconciled exits" value={row.reconciledExits} />
            <Metric label="Starting capital" value={money(row.startingCapital)} />
          </div>

          <div style={foot}>
            Exposure is an estimate using recorded entry notional divided by session starting capital.
            Positive slippage means the fill was worse than the decision price.
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }) {
  const color =
    tone === 'good'
      ? '#4ade80'
      : tone === 'bad'
        ? '#f87171'
        : '#e2e8f0';

  return (
    <div style={metric}>
      <div style={metricLabel}>{label}</div>
      <strong style={{ ...metricValue, color }}>{value ?? '—'}</strong>
    </div>
  );
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}` : '—';
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
}

function bps(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)} bps` : '—';
}

const panel = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: 14,
};

const header = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 10,
};

const title = { color: '#22d3ee' };

const subtitle = {
  color: '#94a3b8',
  fontSize: 11,
  marginTop: 4,
  lineHeight: 1.4,
};

const button = {
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: 7,
  padding: '7px 10px',
  cursor: 'pointer',
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
  gap: 8,
};

const metric = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 9,
};

const metricLabel = {
  color: '#94a3b8',
  fontSize: 9,
};

const metricValue = {
  display: 'block',
  marginTop: 2,
  fontSize: 13,
};

const foot = {
  color: '#64748b',
  fontSize: 10,
  marginTop: 9,
  lineHeight: 1.45,
};

const empty = {
  color: '#94a3b8',
  padding: '8px 0',
  fontSize: 12,
};

const errorStyle = {
  color: '#f87171',
  padding: '8px 0',
  fontSize: 12,
};
