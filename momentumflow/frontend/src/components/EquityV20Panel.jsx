import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Kept under the old filename for import compatibility. The V20-only controls
// are retired in V35; equities and crypto are independent engines.
export default function EquityV20Panel() {
  const [fastScalpEnabled, setFastScalpEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setLoading(true);
      setError('');

      let saved = await api.getTradingConfig();

      // Clear any persisted legacy focus mode. In V35, enabling equities must
      // never disable the crypto engine.
      if (saved?.equityFocusMode === true) {
        saved = await api.setTradingConfig({ equityFocusMode: false });
      }

      setFastScalpEnabled(saved?.equityFastScalpEnabled === true);
    } catch (err) {
      setError(err?.message || 'Failed to load V35 market settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleFastScalp() {
    try {
      setSaving(true);
      setError('');
      const saved = await api.setTradingConfig({
        equityFocusMode: false,
        equityFastScalpEnabled: !fastScalpEnabled,
      });
      setFastScalpEnabled(saved?.equityFastScalpEnabled === true);
    } catch (err) {
      setError(err?.message || 'Failed to save Fast Scalp setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={stack}>
      <div style={engineGrid}>
        <EngineCard
          title="EQUITY V35"
          detail="Independent equity engine. Turning equities on does not disable crypto."
        />
        <EngineCard
          title="CRYPTO V35"
          detail="Independent 24/7 crypto engine. It can run at the same time as equities."
        />
      </div>

      <div style={notice}>
        V35 runs equity and crypto as separate strategy engines. The old Equity Focus Mode switch was removed because it incorrectly made the markets mutually exclusive.
      </div>

      <ToggleCard
        title="1-MIN EQUITY FAST SCALP"
        note="PAPER only. Experimental early-momentum entry with reversal/fade exits. It is separate from the V35 equity/crypto engine split."
        enabled={fastScalpEnabled}
        loading={loading}
        saving={saving}
        onToggle={toggleFastScalp}
        onText="FAST EQUITY SCALP ON — PAPER only"
        offText="FAST EQUITY SCALP OFF"
      />

      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

function EngineCard({ title, detail }) {
  return (
    <div style={engineCard}>
      <strong style={titleStyle}>{title}</strong>
      <div style={noteStyle}>{detail}</div>
      <div style={status}>INDEPENDENT ENGINE</div>
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
          <div style={titleStyle}>{title}</div>
          <div style={noteStyle}>{note}</div>
        </div>

        <button
          type="button"
          disabled={loading || saving}
          onClick={onToggle}
          style={{
            ...button,
            ...(enabled ? onButton : offButton),
          }}
        >
          {loading ? 'Loading…' : saving ? 'Saving…' : enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={status}>{enabled ? onText : offText}</div>
    </div>
  );
}

const stack = {
  display: 'grid',
  gap: 10,
};

const engineGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 10,
};

const engineCard = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};

const notice = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 10,
  color: '#93c5fd',
  fontSize: 11,
  lineHeight: 1.45,
};

const row = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 14,
};

const titleStyle = {
  color: '#4ade80',
  fontSize: 13,
  fontWeight: 800,
};

const noteStyle = {
  color: 'var(--text-secondary)',
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
  fontWeight: 700,
};

const errorStyle = {
  color: '#f87171',
  fontSize: 12,
};
