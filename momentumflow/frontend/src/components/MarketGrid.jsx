import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function MarketGrid() {
  const [grid, setGrid] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.getMarketGrid();
        if (!cancelled) setGrid(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (error) return <div style={{ color: 'var(--signal-down)', fontSize: 13 }}>Market data unavailable: {error}</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {grid.map((m) => (
        <div key={m.market} style={cell}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{m.market}</span>
            <span style={{ fontSize: 9, color: m.source === 'coinbase_live' ? 'var(--signal-up)' : 'var(--text-dim)' }}>
              {m.source === 'coinbase_live' ? '● live' : '○ static'}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
            {m.price != null ? `$${m.price.toLocaleString()}` : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

const cell = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
};
