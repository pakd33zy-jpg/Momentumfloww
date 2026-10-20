import React, { useCallback, useEffect, useState } from 'react';

const fmt = (v) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—';
async function request(path, options = {}) {
  const response = await fetch('/api/kalshi' + path, {
    headers: { 'Content-Type': 'application/json' }, ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function Kalshi() {
  const [status, setStatus] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ticker, setTicker] = useState('');
  const [side, setSide] = useState('yes');
  const [contracts, setContracts] = useState('1');
  const [priceCents, setPriceCents] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const results = await Promise.all([
      request('/status'), request('/markets?limit=100'), request('/positions'), request('/orders'),
    ]);
    setStatus(results[0]);
    setMarkets(results[1].markets || []);
    setPositions(results[2].positions || []);
    setOrders(results[3].orders || []);
  }, []);

  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);

  async function submitPaperOrder(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/orders', { method: 'POST', body: JSON.stringify({
        ticker, side, contracts: Number(contracts), priceCents: Number(priceCents),
      }) });
      setMessage(`Paper order simulated: ${result.order.contracts} ${result.order.side.toUpperCase()} contracts of ${result.order.ticker}. No live order was sent.`);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function settle(id, result) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/positions/${id}/settle`, { method: 'POST', body: JSON.stringify({ result }) });
      setMessage('Paper settlement recorded.');
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const panel = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 12 };
  const field = { width: '100%', boxSizing: 'border-box', padding: 10, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8 };
  const button = { padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 700 };
  return <div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <div><h1 style={{ margin: 0, fontSize: 24 }}>Kalshi Paper Trading</h1><p style={{ color: 'var(--text-secondary)', margin: '5px 0 0' }}>Independent prediction-market simulator inside MomentumFlow.</p></div>
      <button style={button} disabled={busy} onClick={() => refresh().catch(e => setError(e.message))}>Refresh</button>
    </div>
    <div style={{ ...panel, borderColor: 'var(--accent)' }}>
      <strong>Paper mode only</strong><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)' }}>Market data is read-only. Simulated orders never reach Kalshi. P/L is not evidence of a profitable strategy until enough settled trades have been tested.</p>
    </div>
    {error && <div role="alert" style={{ ...panel, color: '#ff7676' }}>{error}</div>}
    {message && <div role="status" style={panel}>{message}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
      {[['Paper cash', fmt(status?.cash)], ['Realized P/L', fmt(status?.realizedPnl)], ['Open positions', status?.openPositions ?? '—'], ['Orders simulated', status?.totalOrders ?? '—']].map(([label, value]) =>
        <div key={label} style={{ ...panel, margin: 0 }}><div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 750, marginTop: 4 }}>{value}</div></div>)}
    </div>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Simulate a contract purchase</h2>
      <form onSubmit={submitPaperOrder} style={{ display: 'grid', gap: 10 }}>
        <label>Open market<select required value={ticker} onChange={e => { const m = markets.find(x => x.ticker === e.target.value); setTicker(e.target.value); if (m) { const ask = side === 'yes' ? m.yes_ask : m.no_ask; if (Number.isFinite(Number(ask))) setPriceCents(String(ask)); } }} style={field}>
          <option value="">Choose a market…</option>{markets.map(m => <option key={m.ticker} value={m.ticker}>{m.title || m.ticker} ({m.ticker})</option>)}
        </select></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>Outcome<select value={side} onChange={e => { setSide(e.target.value); const m = markets.find(x => x.ticker === ticker); const ask = e.target.value === 'yes' ? m?.yes_ask : m?.no_ask; if (Number.isFinite(Number(ask))) setPriceCents(String(ask)); }} style={field}><option value="yes">YES</option><option value="no">NO</option></select></label>
          <label>Contracts<input type="number" min="1" max="1000" step="1" value={contracts} onChange={e => setContracts(e.target.value)} style={field} required /></label>
        </div>
        <label>Simulated entry price (¢)<input type="number" min="1" max="99" step="1" value={priceCents} onChange={e => setPriceCents(e.target.value)} style={field} required /></label>
        <button type="submit" disabled={busy || !ticker} style={button}>{busy ? 'Working…' : 'Place paper order'}</button>
        <small style={{ color: 'var(--text-secondary)' }}>Orders are capped at 5% of the starting paper balance per position. Fees are estimates and may differ from actual product fees.</small>
      </form>
    </section>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Open paper positions</h2>
      {!positions.length && <p style={{ color: 'var(--text-secondary)' }}>No open positions yet.</p>}
      {positions.map(p => <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
        <strong>{p.title || p.ticker}</strong><div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.side.toUpperCase()} · {p.contracts} contracts · entry {p.entryPriceCents}¢ · cost {fmt(p.costBasis + p.fees)}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button style={button} disabled={busy} onClick={() => settle(p.id, 'yes')}>Settle YES</button><button style={{ ...button, background: 'transparent', color: 'var(--text)' }} disabled={busy} onClick={() => settle(p.id, 'no')}>Settle NO</button></div>
        <small style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 6 }}>Manual paper settlement only—select the verified final outcome, not a price prediction.</small>
      </div>)}
    </section>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Open Kalshi markets</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {markets.slice(0, 30).map(m => <button key={m.ticker} type="button" onClick={() => { setTicker(m.ticker); setSide('yes'); if (Number.isFinite(Number(m.yes_ask))) setPriceCents(String(m.yes_ask)); }} style={{ textAlign: 'left', padding: 10, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)' }}>
          <strong>{m.title || m.ticker}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{m.ticker} · YES bid/ask {m.yes_bid ?? '—'}/{m.yes_ask ?? '—'}¢ · NO bid/ask {m.no_bid ?? '—'}/{m.no_ask ?? '—'}¢</div>
        </button>)}
        {!markets.length && <p style={{ color: 'var(--text-secondary)' }}>No market feed loaded. Use Refresh to retry.</p>}
      </div>
    </section>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Recent simulated orders</h2>
      {!orders.length && <p style={{ color: 'var(--text-secondary)' }}>No paper orders yet.</p>}
      {orders.slice(0, 20).map(o => <div key={o.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', fontSize: 13 }}><strong>{o.ticker}</strong> · {o.side.toUpperCase()} · {o.contracts} @ {o.priceCents}¢ · fee est. {fmt(o.estimatedFees)} · {new Date(o.createdAt).toLocaleString()}</div>)}
    </section>
  </div>;
}
