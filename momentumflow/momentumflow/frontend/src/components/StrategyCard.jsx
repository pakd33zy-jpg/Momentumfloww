import React from 'react';

export default function StrategyCard() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="display" style={{ fontWeight: 600 }}>Trend-Aligned Momentum</span>
        <span style={pill}>ACTIVE</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
        Scans Alpaca tradable equities/ETFs and crypto for momentum signals; live sizing uses the saved account-risk percentage.
        Every session runs paper-first with hard safety halts.
      </p>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12 }}>
        <div><span className="mono" style={{ color: 'var(--text-dim)' }}>Probe</span> 0.5×</div>
        <div><span className="mono" style={{ color: 'var(--text-dim)' }}>Standard</span> 1.0×</div>
        <div><span className="mono" style={{ color: 'var(--text-dim)' }}>High</span> 1.25×</div>
      </div>
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '16px',
};

const pill = {
  fontSize: 10,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'rgba(61, 220, 132, 0.12)',
  color: 'var(--signal-up)',
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.05em',
};
