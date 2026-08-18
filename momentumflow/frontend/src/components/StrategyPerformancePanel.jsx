import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function StrategyPerformancePanel() {
  const [rows, setRows] = useState([]);
  const [execution, setExecution] = useState(null);
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setError('');
      const status = await api.getLiveBotStatus();

      setRows(
        Array.isArray(status?.strategyPerformance)
          ? status.strategyPerformance
          : []
      );
      setExecution(status?.executionQuality || null);
      setVersion(status?.strategyVersion || '');
    } catch (err) {
      setError(
        err?.message ||
        'Failed to load strategy performance.'
      );
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
          <strong style={title}>Strategy Performance</strong>
          <div style={subtitle}>
            Closed trades grouped by strategy. Expectancy and profit factor matter more than win rate alone.
            {version ? ` · ${version}` : ''}
          </div>
        </div>

        <button type="button" onClick={refresh} style={button}>
          Refresh
        </button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {execution && (
        <div style={executionBox}>
          <div style={executionTitle}>Paper-forward execution quality</div>
          <div style={executionHelp}>
            Adverse slippage: positive = worse fill than the decision price; negative = price improvement.
          </div>

          <div style={metricGrid}>
            <Metric label="Measured entries" value={execution.measuredEntries} />
            <Metric label="Avg entry slip" value={bps(execution.avgEntrySlippageBps)} />
            <Metric label="P90 entry slip" value={bps(execution.p90EntrySlippageBps)} />
            <Metric label="Measured exits" value={execution.measuredExits} />
            <Metric label="Avg exit slip" value={bps(execution.avgExitSlippageBps)} />
            <Metric label="P90 exit slip" value={bps(execution.p90ExitSlippageBps)} />
            <Metric label="Partial entries" value={execution.partialEntries} />
            <Metric label="Reconciled exits" value={execution.reconciledExits} />
            <Metric label="Avg size fill" value={pct(execution.avgPlannedBudgetFilledPct)} />
            <Metric label="Avg exposure/trade" value={pct(execution.avgEntryExposurePct)} />
            <Metric label="Max exposure/trade" value={pct(execution.maxEntryExposurePct)} />
            <Metric label="Execution sample" value={execution.sampleEnough ? '30+' : 'EARLY'} />
          </div>

          {execution.worstEntrySlippage?.length > 0 && (
            <div style={worstBlock}>
              <strong>Worst recent entry slippage</strong>
              {execution.worstEntrySlippage.map((row) => (
                <div key={`${row.tradeId}:${row.market}`} style={worstRow}>
                  <span>{row.market} · {row.direction}</span>
                  <span>{bps(row.slippageBps)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!error && rows.length === 0 && (
        <div style={empty}>
          No closed strategy trades yet. PAPER results will appear here as trades close.
        </div>
      )}

      {rows.length > 0 && (
        <div style={tableWrap}>
          <div style={tableHeader}>
            <span>Strategy</span>
            <span>Trades</span>
            <span>Win %</span>
            <span>P&amp;L</span>
            <span>Expect.</span>
            <span>PF</span>
            <span>Sample</span>
          </div>

          {rows.map((row) => (
            <div key={row.strategy} style={tableRow}>
              <span style={strategyName}>{friendly(row.strategy)}</span>
              <span>{row.trades}</span>
              <span>{Number(row.winRate || 0).toFixed(1)}%</span>
              <span style={{
                color: Number(row.pnl || 0) >= 0 ? '#4ade80' : '#f87171',
              }}>
                {Number(row.pnl || 0) >= 0 ? '+' : ''}
                {Number(row.pnl || 0).toFixed(2)}
              </span>
              <span style={{
                color: Number(row.expectancy || 0) >= 0 ? '#4ade80' : '#f87171',
              }}>
                {Number(row.expectancy || 0) >= 0 ? '+' : ''}
                {Number(row.expectancy || 0).toFixed(2)}
              </span>
              <span>
                {Number.isFinite(Number(row.profitFactor))
                  ? Number(row.profitFactor).toFixed(2)
                  : '∞'}
              </span>
              <span style={{
                color: row.sampleEnough ? '#4ade80' : '#fbbf24',
              }}>
                {row.sampleEnough ? '30+' : 'EARLY'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={foot}>
        Treat fewer than 30 closed trades per strategy or fewer than 30 measured executions as an early sample, not proof of profitability or execution quality.
      </div>
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

function bps(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)} bps` : '—';
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
}

function friendly(name = '') {
  return String(name)
    .replace(/^EQUITY_/, '')
    .replace(/_V20$/, '')
    .replaceAll('_', ' ');
}

const panel = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: 14,
};

const header = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 12,
};

const title = { color: '#60a5fa' };

const subtitle = {
  color: '#94a3b8',
  fontSize: 11,
  marginTop: 4,
  maxWidth: 760,
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

const executionBox = {
  background: '#0b1220',
  border: '1px solid #334155',
  borderRadius: 9,
  padding: 11,
  marginBottom: 12,
};

const executionTitle = {
  color: '#4ade80',
  fontWeight: 700,
  fontSize: 12,
};

const executionHelp = {
  color: '#64748b',
  fontSize: 10,
  marginTop: 3,
  marginBottom: 8,
};

const metricGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 7,
};

const metric = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 7,
  padding: 8,
};

const metricLabel = {
  color: '#94a3b8',
  fontSize: 9,
};

const metricValue = {
  display: 'block',
  color: '#e2e8f0',
  fontSize: 13,
  marginTop: 2,
};

const worstBlock = {
  marginTop: 9,
  fontSize: 10,
  color: '#cbd5e1',
};

const worstRow = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  padding: '4px 0',
  borderTop: '1px solid rgba(255,255,255,0.04)',
};

const tableWrap = { overflowX: 'auto' };

const tableHeader = {
  display: 'grid',
  gridTemplateColumns: 'minmax(190px, 2fr) repeat(6, minmax(70px, 1fr))',
  gap: 8,
  minWidth: 720,
  padding: '7px 8px',
  color: '#64748b',
  fontSize: 10,
  textTransform: 'uppercase',
};

const tableRow = {
  display: 'grid',
  gridTemplateColumns: 'minmax(190px, 2fr) repeat(6, minmax(70px, 1fr))',
  gap: 8,
  minWidth: 720,
  padding: '9px 8px',
  borderTop: '1px solid #334155',
  color: '#cbd5e1',
  fontSize: 11,
  alignItems: 'center',
};

const strategyName = {
  fontWeight: 700,
  color: '#e2e8f0',
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

const foot = {
  color: '#64748b',
  fontSize: 10,
  marginTop: 10,
  lineHeight: 1.4,
};
