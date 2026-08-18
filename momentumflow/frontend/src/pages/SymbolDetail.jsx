import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function SymbolDetail() {
  const { symbol: encoded } = useParams();
  const navigate = useNavigate();
  const symbol = decodeURIComponent(encoded || '').toUpperCase();
  const [detail, setDetail] = useState(null);
  const [mode, setMode] = useState('paper');
  const [qty, setQty] = useState('');
  const [side, setSide] = useState('buy');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setError('');
      const [d, m] = await Promise.all([
        api.getSymbolDetail(symbol),
        api.getTradingMode(),
      ]);
      setDetail(d);
      setMode(m?.mode || 'paper');
    } catch (err) {
      setError(err?.message || 'Failed to load symbol.');
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [symbol]);

  const crypto = detail?.assetClass === 'crypto' || symbol.includes('/');
  const label = crypto
    ? (side === 'buy' ? 'SPOT BUY' : 'SPOT SELL')
    : (side === 'buy' ? 'LONG / BUY' : 'SHORT / SELL');

  const points = useMemo(() => Array.isArray(detail?.points) ? detail.points : [], [detail]);

  async function submit() {
    setMessage('');
    setError('');
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      const result = await api.placeManualOrder({
        mode,
        symbol: detail?.symbol || symbol,
        side,
        qty: Number(qty),
        liveConfirmation: mode === 'live' ? 'LIVE' : undefined,
      });
      setMessage(`Order submitted: ${result?.id || result?.order?.id || 'accepted'}`);
      setConfirming(false);
      setQty('');
    } catch (err) {
      setError(err?.message || 'Order failed.');
    }
  }

  return (
    <div style={{ maxWidth: 1050, margin: '0 auto' }}>
      <button onClick={() => navigate(-1)} style={back}>← Back</button>
      <div style={head}>
        <div>
          <h2 style={{ margin: 0 }}>{detail?.symbol || symbol}</h2>
          <div style={muted}>{detail?.assetClass || 'market'} · {String(mode).toUpperCase()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {Number.isFinite(Number(detail?.price)) ? `$${Number(detail.price).toLocaleString()}` : '—'}
          </div>
          <div style={muted}>{detail?.source || ''}</div>
        </div>
      </div>

      {error && <div style={err}>{error}</div>}

      <div style={card}>
        <strong>Market chart</strong>
        <div style={muted}>Recent Alpaca 5-minute closes. Equities currently use IEX bars.</div>
        <MiniChart points={points} />
      </div>

      <div style={grid}>
        <Metric label="Open" value={money(detail?.stats?.open)} />
        <Metric label="High" value={money(detail?.stats?.high)} />
        <Metric label="Low" value={money(detail?.stats?.low)} />
        <Metric label="Last" value={money(detail?.stats?.last ?? detail?.price)} />
        <Metric label="Change" value={pct(detail?.stats?.changePct)} />
        <Metric label="Volume" value={number(detail?.stats?.volume)} />
      </div>

      <div style={card}>
        <strong>Manual trade</strong>
        <div style={muted}>
          {crypto ? 'Crypto uses spot BUY/SELL. No crypto shorting.' : 'Equities use BUY to go long and SELL to sell/short where the broker permits.'}
        </div>

        <div style={row}>
          <select value={side} onChange={e => { setSide(e.target.value); setConfirming(false); }} style={input}>
            <option value="buy">{crypto ? 'SPOT BUY' : 'LONG / BUY'}</option>
            <option value="sell">{crypto ? 'SPOT SELL' : 'SHORT / SELL'}</option>
          </select>
          <input value={qty} onChange={e => { setQty(e.target.value); setConfirming(false); }}
            type="number" min="0" step="any" placeholder="Quantity" style={input} />
        </div>

        <div style={{ ...muted, marginTop: 8 }}>
          Active order mode: <strong>{String(mode).toUpperCase()}</strong>
          {mode === 'live' ? ' · REAL CAPITAL' : ' · Alpaca paper account'}
        </div>

        {confirming && (
          <div style={confirm}>
            Confirm {label} {qty || 0} {detail?.symbol || symbol} at market in <strong>{String(mode).toUpperCase()}</strong>.
            {mode === 'live' && <div style={{ color: '#f87171', marginTop: 5 }}>This will submit a real-money order.</div>}
          </div>
        )}

        <button disabled={!qty || Number(qty) <= 0} onClick={submit}
          style={{ ...tradeButton, background: mode === 'live' ? '#dc2626' : '#2563eb' }}>
          {confirming ? 'Confirm & Submit' : 'Review Order'}
        </button>
        {confirming && <button onClick={() => setConfirming(false)} style={cancel}>Cancel</button>}
        {message && <div style={ok}>{message}</div>}
      </div>
    </div>
  );
}

function MiniChart({ points }) {
  const rows = points.filter(p => Number.isFinite(Number(p.c)));
  if (rows.length < 2) return <div style={{ ...muted, padding: 30, textAlign: 'center' }}>No bar history returned.</div>;
  const values = rows.map(p => Number(p.c));
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, hi * 0.001, 0.01);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 1000;
    const y = 220 - ((v - lo) / span) * 200;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 1000 240" style={{ width: '100%', height: 240, marginTop: 10 }}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function Metric({label,value}) { return <div style={metric}><div style={muted}>{label}</div><strong>{value}</strong></div>; }
function money(v){ const n=Number(v); return Number.isFinite(n)?`$${n.toLocaleString()}`:'—'; }
function pct(v){ const n=Number(v); return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—'; }
function number(v){ const n=Number(v); return Number.isFinite(n)?n.toLocaleString():'—'; }

const card={background:'#1e2139',border:'1px solid #2a2e4a',borderRadius:8,padding:16,marginBottom:16};
const head={...card,display:'flex',justifyContent:'space-between',alignItems:'center'};
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16};
const metric={background:'#1e2139',border:'1px solid #2a2e4a',borderRadius:8,padding:12};
const muted={color:'#94a3b8',fontSize:11,marginTop:4};
const row={display:'flex',gap:8,marginTop:12,flexWrap:'wrap'};
const input={flex:1,minWidth:150,background:'#0f172a',color:'#fff',border:'1px solid #475569',borderRadius:6,padding:10};
const tradeButton={width:'100%',border:0,color:'#fff',fontWeight:700,borderRadius:6,padding:12,marginTop:10,cursor:'pointer'};
const cancel={...tradeButton,background:'transparent',border:'1px solid #475569'};
const confirm={background:'#0f172a',border:'1px solid #475569',padding:10,borderRadius:6,marginTop:10,fontSize:12};
const back={background:'transparent',color:'#93c5fd',border:0,cursor:'pointer',marginBottom:10};
const err={color:'#f87171',marginBottom:10};
const ok={color:'#4ade80',marginTop:10};
