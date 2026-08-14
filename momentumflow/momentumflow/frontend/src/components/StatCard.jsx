import React from 'react';

export default function StatCard({ label, value, tone = 'neutral', sub }) {
  const color =
    tone === 'up' ? 'var(--signal-up)' : tone === 'down' ? 'var(--signal-down)' : 'var(--text-primary)';
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color, marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};
