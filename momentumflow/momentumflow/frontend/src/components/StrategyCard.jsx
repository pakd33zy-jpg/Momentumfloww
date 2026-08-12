import React from 'react';

export default function StrategyCard() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="display" style={{ fontWeight: 600 }}>Trend-Aligned Momentum</span>
        <span style={pill}>ACTIVE</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
        Scans supported Alpaca tradable equities/ETFs and crypto for qualifying momentum signals.
        Live entry size uses the existing Risk Per Trade percentage of current Alpaca live equity.
      </p>
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
