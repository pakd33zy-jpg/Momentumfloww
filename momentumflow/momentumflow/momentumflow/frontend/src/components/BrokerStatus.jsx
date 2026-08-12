import React from 'react';

export default function BrokerStatus({
  mode,
  paperConnected = false,
  liveConnected = false,
  liveUnlocked = false,
  paperError = '',
  liveError = '',
}) {
  const activeConnected = mode === 'live' ? liveConnected : paperConnected;
  const activeError = mode === 'live' ? liveError : paperError;
  const dotColor = activeConnected
    ? (mode === 'live' ? 'var(--signal-live)' : 'var(--signal-up)')
    : 'var(--signal-down)';
  const label = mode === 'live'
    ? (liveUnlocked ? 'LIVE — ARMED' : 'LIVE — LOCKED')
    : 'PAPER';

  return (
    <div style={row}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Alpaca {mode === 'live' ? 'LIVE' : 'PAPER'}: {activeConnected ? 'connected' : 'not connected'}
          {!activeConnected && activeError ? ` · ${activeError}` : ''}
          {` · other account: ${mode === 'live'
            ? (paperConnected ? 'paper connected' : 'paper not connected')
            : (liveConnected ? 'live connected' : 'live not connected')}`}
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
