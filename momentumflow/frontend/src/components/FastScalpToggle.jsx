import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function FastScalpToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setLoading(true);
      setError('');
      const cfg = await api.getTradingConfig();
      setEnabled(cfg?.fastScalpEnabled === true);
    } catch (err) {
      setError(err?.message || 'Failed to load Fast Scalp setting.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggle() {
    try {
      setSaving(true);
      setError('');

      const saved = await api.setTradingConfig({
        fastScalpEnabled: !enabled,
      });

      setEnabled(saved?.fastScalpEnabled === true);
    } catch (err) {
      setError(err?.message || 'Failed to save Fast Scalp setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={card}>
      <div style={row}>
        <div>
          <div style={title}>FAST SCALP — 1 MIN CRYPTO</div>
          <div style={note}>
            PAPER only. Buys strong upward 1-minute impulses, then exits
            back to cash on reversal/fade. It does not open crypto shorts.
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={loading || saving}
          style={{
            ...button,
            ...(enabled ? onButton : offButton),
          }}
        >
          {loading
            ? 'Loading…'
            : saving
              ? 'Saving…'
              : enabled
                ? 'ON'
                : 'OFF'}
        </button>
      </div>

      <div style={status}>
        {enabled
          ? 'FAST SCALP ENABLED — run the bot in PAPER mode to test it.'
          : 'FAST SCALP OFF — v19 crypto strategy remains active.'}
      </div>

      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};

const row = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 14,
};

const title = {
  color: '#4ade80',
  fontSize: 13,
  fontWeight: 800,
};

const note = {
  color: 'var(--text-secondary)',
  fontSize: 12,
  lineHeight: 1.45,
  marginTop: 5,
  maxWidth: 760,
};

const button = {
  minWidth: 74,
  borderRadius: 8,
  padding: '10px 16px',
  fontWeight: 800,
  cursor: 'pointer',
};

const onButton = {
  background: '#14532d',
  border: '1px solid #4ade80',
  color: '#4ade80',
};

const offButton = {
  background: '#111827',
  border: '1px solid #475569',
  color: '#cbd5e1',
};

const status = {
  marginTop: 10,
  color: '#94a3b8',
  fontSize: 11,
};

const errorStyle = {
  marginTop: 8,
  color: '#f87171',
  fontSize: 12,
};
