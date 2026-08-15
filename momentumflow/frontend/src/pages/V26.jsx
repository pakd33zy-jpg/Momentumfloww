import { useEffect, useMemo, useState } from 'react';
import { v26Api } from '../lib/v26Api.js';

const money = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

const pct = (value) =>
  `${Number(value || 0).toFixed(2)}%`;

function Card({ children, style = {} }) {
  return (
    <div
      style={{
        background: '#1e2139',
        border: '1px solid #2a2e4a',
        borderRadius: 10,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SmallStat({ label, value, color = '#fff' }) {
  return (
    <Card>
      <div style={{ color: '#8f96b2', fontSize: 11, fontWeight: 700, letterSpacing: '.05em' }}>
        {label}
      </div>
      <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </Card>
  );
}

export default function V26() {
  const [data, setData] = useState(null);
  const [budget, setBudget] = useState(100000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      setError('');
      const result = await v26Api.status(budget);
      setData(result);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [budget]);

  const topTargets = useMemo(
    () =>
      Object.entries(data?.targets || {}).map(([symbol, weight]) => ({
        symbol,
        weight: Number(weight),
      })),
    [data]
  );

  async function execute() {
    if (!data?.rebalanceDue) {
      setMessage('No rebalance is due.');
      return;
    }
    if (
      !window.confirm(
        'Submit the displayed V26 orders to ALPACA PAPER trading? This cannot place live orders.'
      )
    ) {
      return;
    }

    try {
      setBusy(true);
      setError('');
      setMessage('');
      const result = await v26Api.execute(budget);
      setMessage(result.message || 'Paper orders submitted.');
      setData(result.snapshot || data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>V26 Paper Forward</h1>
          <div style={{ color: '#9ba3c2', marginTop: 6, fontSize: 13 }}>
            Frozen 63-day momentum + SMA150 ETF rotation · paper only
          </div>
        </div>
        <div
          style={{
            border: '1px solid #245f3e',
            color: '#4ade80',
            background: '#11271c',
            borderRadius: 999,
            padding: '7px 12px',
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          PAPER ONLY · FROZEN RULES
        </div>
      </div>

      {error && (
        <div
          style={{
            background: '#3a1820',
            border: '1px solid #7f1d1d',
            color: '#fecaca',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            background: '#132b20',
            border: '1px solid #245f3e',
            color: '#bbf7d0',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {message}
        </div>
      )}

      {!data ? (
        <Card>Loading V26 paper status…</Card>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <SmallStat label="PAPER EQUITY" value={money(data.account?.equity)} />
            <SmallStat label="V26 BUDGET NOW" value={money(data.strategyBudget)} />
            <SmallStat
              label="REBALANCE"
              value={data.rebalanceDue ? 'DUE' : 'WAIT'}
              color={data.rebalanceDue ? '#facc15' : '#4ade80'}
            />
            <SmallStat
              label="SESSIONS SINCE"
              value={`${data.completedSessionsSince} / ${data.rule?.rebalanceEveryCompletedSessions}`}
            />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 12,
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Current V26 Target</div>
                <div style={{ color: '#9ba3c2', fontSize: 12, marginTop: 4 }}>
                  Signal session {data.signalSession} · last rebalance{' '}
                  {data.lastRebalanceSession || 'none'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {topTargets.length ? (
                  topTargets.map((x) => (
                    <div
                      key={x.symbol}
                      style={{
                        background: '#111827',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        padding: '10px 14px',
                      }}
                    >
                      <span style={{ fontWeight: 900 }}>{x.symbol}</span>{' '}
                      <span style={{ color: '#60a5fa' }}>{Math.round(x.weight * 100)}%</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#facc15', fontWeight: 800 }}>100% CASH</div>
                )}
              </div>
            </div>
          </Card>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 12 }}>Momentum Ranking</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#8f96b2', textAlign: 'left' }}>
                    <th style={th}>Symbol</th>
                    <th style={th}>MOM63</th>
                    <th style={th}>Close</th>
                    <th style={th}>SMA150</th>
                    <th style={th}>Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.ranking || []).map((row) => (
                    <tr key={row.symbol} style={{ borderTop: '1px solid #2a2e4a' }}>
                      <td style={td}><strong>{row.symbol}</strong></td>
                      <td style={{ ...td, color: row.momentumPct >= 0 ? '#4ade80' : '#f87171' }}>
                        {pct(row.momentumPct)}
                      </td>
                      <td style={td}>{money(row.close)}</td>
                      <td style={td}>{money(row.sma150)}</td>
                      <td style={{ ...td, color: row.eligible ? '#4ade80' : '#8f96b2' }}>
                        {row.eligible ? 'YES' : 'NO'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <Card>
              <div style={{ fontWeight: 800, marginBottom: 10 }}>V26 Positions</div>
              {!data.positions?.length ? (
                <div style={{ color: '#8f96b2' }}>No filled V26 ETF positions yet.</div>
              ) : (
                data.positions.map((p) => (
                  <div
                    key={p.symbol}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      borderTop: '1px solid #2a2e4a',
                      padding: '10px 0',
                    }}
                  >
                    <strong>{p.symbol}</strong>
                    <span>
                      {money(p.marketValue)} ·{' '}
                      <span style={{ color: p.unrealizedPl >= 0 ? '#4ade80' : '#f87171' }}>
                        {p.unrealizedPl >= 0 ? '+' : ''}
                        {money(p.unrealizedPl)}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </Card>

            <Card>
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Open V26 Orders</div>
              {!data.openOrders?.length ? (
                <div style={{ color: '#8f96b2' }}>No open V26 paper orders.</div>
              ) : (
                data.openOrders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      borderTop: '1px solid #2a2e4a',
                      padding: '10px 0',
                    }}
                  >
                    <strong>{o.side?.toUpperCase()} {o.symbol}</strong>
                    <span style={{ color: '#facc15' }}>{o.status}</span>
                  </div>
                ))
              )}
            </Card>
          </div>

          <Card>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'end',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <label style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                <span style={{ color: '#9ba3c2', fontSize: 12 }}>Requested V26 paper budget</span>
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value || 0))}
                  style={{
                    background: '#111827',
                    color: '#fff',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                />
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={refresh} style={buttonSecondary} disabled={busy}>
                  Refresh
                </button>
                <button
                  onClick={execute}
                  disabled={busy || !data.rebalanceDue || data.openOrders?.length > 0}
                  style={{
                    ...buttonPrimary,
                    opacity:
                      busy || !data.rebalanceDue || data.openOrders?.length > 0 ? 0.5 : 1,
                  }}
                >
                  {busy ? 'Submitting…' : 'Execute PAPER Rebalance'}
                </button>
              </div>
            </div>

            <div style={{ color: '#8f96b2', fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
              This control is hard-wired to Alpaca paper trading. It will not place live orders.
              Existing non-V26 positions are not shown or modified.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

const th = { padding: '8px 10px', whiteSpace: 'nowrap' };
const td = { padding: '10px', whiteSpace: 'nowrap' };

const buttonPrimary = {
  border: 0,
  background: '#2563eb',
  color: '#fff',
  fontWeight: 800,
  borderRadius: 7,
  padding: '11px 14px',
  cursor: 'pointer',
};

const buttonSecondary = {
  ...buttonPrimary,
  background: '#1f2937',
  border: '1px solid #374151',
};
