import React from 'react';

export default function BrokerStatus({ mode = 'paper', accounts = {} }) {
  const paper = accounts?.paper || {};
  const live = accounts?.live || {};
  const active = mode === 'live' ? live : paper;
  const connected = active?.connected === true;

  return (
    <div style={row}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: connected ? '#4ade80' : '#f87171', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {mode === 'live' ? 'LIVE' : 'PAPER'} Alpaca account: {connected ? 'CONNECTED' : 'NOT CONNECTED'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
          Paper: {paper.connected ? 'connected' : 'not connected'} · Live: {live.connected ? 'connected' : 'not connected'}
        </div>
        {!connected && active?.error && (
          <div style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>{active.error}</div>
        )}
      </div>
    </div>
  );
}

const row = {
  display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-raised)',
  border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px',
};
