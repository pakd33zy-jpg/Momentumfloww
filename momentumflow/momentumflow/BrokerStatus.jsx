import React from 'react';

export default function BrokerStatus({ mode, paperConfigured, liveConfigured, liveUnlocked }) {
  const dotColor = mode === 'live' ? (liveUnlocked ? 'var(--signal-live)' : 'var(--signal-armed)') : 'var(--signal-up)';
  const label = mode === 'live' ? (liveUnlocked ? 'LIVE — ARMED' : 'LIVE — LOCKED') : 'PAPER';

  return (
    <div style={row}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Alpaca {mode === 'live' ? 'LIVE' : 'PAPER'}: {(mode === 'live' ? liveConfigured : paperConfigured) ? 'connected' : 'not connected'} · other account: {mode === 'live' ? (paperConfigured ? 'paper connected' : 'paper not configured') : (liveConfigured ? 'live connected' : 'live not configured')}
        </div>
      </div>
    </div>
  );
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
};
