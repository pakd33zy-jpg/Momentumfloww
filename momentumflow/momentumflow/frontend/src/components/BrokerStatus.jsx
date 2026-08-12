import React from 'react';

export default function BrokerStatus({
  mode,
  paperConnected = false,
  liveConnected = false,
  liveUnlocked = false,
  paperError = '',
  liveError = '',
}) {
  const isLive = mode === 'live';
  const connected = isLive ? liveConnected : paperConnected;
  const error = isLive ? liveError : paperError;

  return (
    <div style={row}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: connected ? 'var(--signal-up)' : 'var(--signal-down)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
          {isLive ? (liveUnlocked ? 'LIVE — ARMED' : 'LIVE — LOCKED') : 'PAPER'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Alpaca {isLive ? 'LIVE' : 'PAPER'}: {connected ? 'connected' : 'not connected'}
          {!connected && error ? ` · ${error}` : ''}
          {` · other account: ${isLive
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
