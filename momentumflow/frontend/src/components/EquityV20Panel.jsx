import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function EquityV20Panel() {
  const [config, setConfig] = useState({
    equityFocusMode: true,
    equityV20Enabled: true,
    equityFastScalpEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setLoading(true);
      setError('');

      const saved =
        await api.getTradingConfig();

      setConfig({
        equityFocusMode:
          saved?.equityFocusMode !==
          false,
        equityV20Enabled:
          saved?.equityV20Enabled !==
          false,
        equityFastScalpEnabled:
          saved
            ?.equityFastScalpEnabled ===
          true,
      });
    } catch (err) {
      setError(
        err?.message ||
        'Failed to load Equity v20 settings.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setValue(
    key,
    value
  ) {
    try {
      setSaving(key);
      setError('');

      const saved =
        await api.setTradingConfig({
          [key]: value,
        });

      setConfig({
        equityFocusMode:
          saved?.equityFocusMode !==
          false,
        equityV20Enabled:
          saved?.equityV20Enabled !==
          false,
        equityFastScalpEnabled:
          saved
            ?.equityFastScalpEnabled ===
          true,
      });
    } catch (err) {
      setError(
        err?.message ||
        'Failed to save Equity v20 setting.'
      );
    } finally {
      setSaving('');
    }
  }

  return (
    <div style={stack}>
      <ToggleCard
        title="EQUITY FOCUS MODE"
        note="Ignores crypto and spends scanner capacity on U.S. equities. Recommended while crypto costs are too high for the current scalp edge."
        enabled={
          config.equityFocusMode
        }
        loading={loading}
        saving={
          saving ===
          'equityFocusMode'
        }
        onToggle={() =>
          setValue(
            'equityFocusMode',
            !config
              .equityFocusMode
          )
        }
        onText="EQUITY FOCUS ON — crypto scanner disabled"
        offText="EQUITY FOCUS OFF — crypto scanner available"
      />

      <ToggleCard
        title="EQUITY v20 ADAPTIVE"
        note="Automatically compares Opening Range Breakout, VWAP Pullback/Reclaim, and Trend Continuation, then takes the highest-quality LONG or SHORT setup."
        enabled={
          config.equityV20Enabled
        }
        loading={loading}
        saving={
          saving ===
          'equityV20Enabled'
        }
        onToggle={() =>
          setValue(
            'equityV20Enabled',
            !config
              .equityV20Enabled
          )
        }
        onText="EQUITY v20 ON — adaptive multi-strategy engine active"
        offText="EQUITY v20 OFF — legacy v19 equity logic active"
      />

      <ToggleCard
        title="1-MIN EQUITY FAST SCALP"
        note="PAPER only. Adds high-speed LONG/SHORT entries on liquid stocks with tight spreads. SHORT still requires Alpaca shortable + easy-to-borrow status."
        enabled={
          config
            .equityFastScalpEnabled
        }
        loading={loading}
        saving={
          saving ===
          'equityFastScalpEnabled'
        }
        onToggle={() =>
          setValue(
            'equityFastScalpEnabled',
            !config
              .equityFastScalpEnabled
          )
        }
        onText="FAST EQUITY SCALP ON — PAPER only"
        offText="FAST EQUITY SCALP OFF"
      />

      <div style={strategyGrid}>
        <Strategy
          name="ORB"
          detail="9:35–10:45 ET · opening-range break with momentum, volume, spread and anti-chase checks."
        />
        <Strategy
          name="VWAP PULLBACK"
          detail="Waits for a trend-aligned pullback into VWAP, then enters the reclaim instead of chasing."
        />
        <Strategy
          name="TREND CONTINUATION"
          detail="Looks for aligned 5m/15m trend plus renewed momentum after a pullback or strong resumption."
        />
        <Strategy
          name="FAST SCALP"
          detail="Optional PAPER-only 1-minute impulse strategy with reversal/fade exits."
        />
      </div>

      {error && (
        <div style={errorStyle}>
          {error}
        </div>
      )}
    </div>
  );
}

function ToggleCard({
  title,
  note,
  enabled,
  loading,
  saving,
  onToggle,
  onText,
  offText,
}) {
  return (
    <div style={card}>
      <div style={row}>
        <div>
          <div style={titleStyle}>
            {title}
          </div>

          <div style={noteStyle}>
            {note}
          </div>
        </div>

        <button
          type="button"
          disabled={
            loading ||
            saving
          }
          onClick={onToggle}
          style={{
            ...button,
            ...(enabled
              ? onButton
              : offButton),
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
          ? onText
          : offText}
      </div>
    </div>
  );
}

function Strategy({
  name,
  detail,
}) {
  return (
    <div style={strategyCard}>
      <strong>
        {name}
      </strong>
      <div style={strategyText}>
        {detail}
      </div>
    </div>
  );
}

const stack = {
  display: 'grid',
  gap: 10,
};

const card = {
  background:
    'var(--bg-raised)',
  border:
    '1px solid var(--line)',
  borderRadius:
    'var(--radius)',
  padding: '14px 16px',
};

const row = {
  display: 'flex',
  justifyContent:
    'space-between',
  alignItems: 'center',
  gap: 14,
};

const titleStyle = {
  color: '#4ade80',
  fontSize: 13,
  fontWeight: 800,
};

const noteStyle = {
  color:
    'var(--text-secondary)',
  fontSize: 12,
  lineHeight: 1.45,
  marginTop: 5,
  maxWidth: 820,
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
  border:
    '1px solid #4ade80',
  color: '#4ade80',
};

const offButton = {
  background: '#111827',
  border:
    '1px solid #475569',
  color: '#cbd5e1',
};

const status = {
  marginTop: 10,
  color: '#94a3b8',
  fontSize: 11,
};

const strategyGrid = {
  display: 'grid',
  gridTemplateColumns:
    'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 8,
};

const strategyCard = {
  background: '#0f172a',
  border:
    '1px solid #334155',
  borderRadius: 8,
  padding: 10,
  fontSize: 11,
};

const strategyText = {
  marginTop: 4,
  color: '#94a3b8',
  lineHeight: 1.4,
};

const errorStyle = {
  color: '#f87171',
  fontSize: 12,
};
