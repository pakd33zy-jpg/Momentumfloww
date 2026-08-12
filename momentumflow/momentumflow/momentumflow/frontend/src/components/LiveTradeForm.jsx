import React, { useState } from 'react';
import { api } from '../lib/api.js';

const MARKETS = ['BTC', 'ETH', 'SOL', 'SPY', 'QQQ', 'GLD', 'GBTC'];

export default function LiveTradeForm({ sessionId, onPlaced }) {
  const [market, setMarket] = useState('BTC');
  const [direction, setDirection] = useState('LONG');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    setError(null);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const result = await api.placeLiveTrade({ sessionId, market, direction, conviction: 'standard', qty: Number(qty) });
      setConfirming(false);
      setQty('');
      onPlaced?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--signal-live)' }}>Place live order</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>real capital</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <select value={market} onChange={(e) => setMarket(e.target.value)} style={select}>
          {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} style={select}>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          style={{ ...select, width: 70 }}
        />
      </div>

      {error && <div style={{ color: 'var(--signal-down)', fontSize: 12, marginTop: 8 }}>{error}</div>}

      {confirming ? (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 12, color: 'var(--signal-armed)' }}>
            Confirm: {direction} {qty || '0'} {market} at market, real Alpaca live order.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={submit} disabled={busy || !qty} style={confirmBtn}>
              {busy ? 'Placing…' : 'Confirm order'}
            </button>
            <button onClick={() => setConfirming(false)} style={cancelBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={submit} disabled={!qty || Number(qty) <= 0} style={submitBtn}>
          Review order
        </button>
      )}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--signal-live)',
  borderRadius: 'var(--radius)',
  padding: '14px',
};

const select = {
  flex: 1,
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 10px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
};

const submitBtn = {
  width: '100%',
  marginTop: 10,
  padding: '11px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--signal-live)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const confirmBtn = { ...submitBtn, marginTop: 0, flex: 1 };
const cancelBtn = { ...submitBtn, marginTop: 0, flex: 1, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text-primary)' };
