import React, { useState } from 'react';
import { api } from '../lib/api.js';

export default function TradingModeToggle({ mode, liveUnlocked, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function switchTo(next) {
    setError(null);
    if (next === 'live' && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await api.setTradingMode(next);
      setConfirming(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => switchTo('paper')}
          disabled={busy}
          style={{ ...segBtn, ...(mode === 'paper' ? segBtnActive : {}) }}
        >
          Paper
        </button>
        <button
          onClick={() => switchTo('live')}
          disabled={busy || !liveUnlocked}
          style={{
            ...segBtn,
            ...(mode === 'live' ? { ...segBtnActive, background: 'var(--signal-live)' } : {}),
            opacity: liveUnlocked ? 1 : 0.4,
          }}
        >
          Live
        </button>
      </div>

      {!liveUnlocked && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
          Complete the Live Gate checklist below to unlock live mode.
        </div>
      )}

      {confirming && (
        <div style={confirmBox}>
          <div style={{ fontSize: 13, color: 'var(--signal-armed)', fontWeight: 600 }}>
            Switch to live mode?
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
            The Dashboard's session runner will place real orders against your Alpaca live
            account instead of simulating. Automated trading remains stopped until you explicitly press Start Live Bot on Dashboard.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => switchTo('live')} disabled={busy} style={confirmBtn}>
              {busy ? 'Switching…' : 'Confirm live mode'}
            </button>
            <button onClick={() => setConfirming(false)} style={cancelBtn}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ color: 'var(--signal-down)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px',
};

const segBtn = {
  flex: 1,
  padding: '10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const segBtnActive = {
  background: 'var(--accent)',
  color: '#fff',
  borderColor: 'transparent',
};

const confirmBox = {
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--line)',
};

const confirmBtn = {
  background: 'var(--signal-live)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const cancelBtn = {
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--text-primary)',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
