import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const DEFAULTS = {
  startingCapital: 100,
  riskPerTrade: 0.02,
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
  winRateTarget: 0.875,
  dailyLossLimit: 0.10,
  consecutiveStopLoss: 3,
};

export default function TradingConfigPanel({ compact = false, onSaved }) {
  const [draft, setDraft] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const cfg = await api.getTradingConfig();
        if (!mounted.current) return;
        setDraft({ ...DEFAULTS, ...cfg });
      } catch (e) {
        if (mounted.current) setError(`Could not load trading settings: ${e.message}`);
      } finally {
        if (mounted.current) setLoaded(true);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  const edit = (key, value) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      api.cacheTradingConfigDraft(next);
      return next;
    });
    setSaveState('Unsaved changes');
    setError('');
  };

  const payload = useMemo(() => ({
    startingCapital: Number(draft.startingCapital),
    riskPerTrade: Number(draft.riskPerTrade),
    maxTradesPerSession: Math.trunc(Number(draft.maxTradesPerSession)),
    maxTradesPerMarket: Math.trunc(Number(draft.maxTradesPerMarket)),
    winRateTarget: Number(draft.winRateTarget),
    dailyLossLimit: Number(draft.dailyLossLimit),
    consecutiveStopLoss: Math.trunc(Number(draft.consecutiveStopLoss)),
  }), [draft]);

  const save = async () => {
    setSaveState('Saving…');
    setError('');
    try {
      const saved = await api.setTradingConfig(payload);
      // Only explicit Save is allowed to replace the draft with server values.
      setDraft({ ...DEFAULTS, ...saved });
      setSaveState('Saved ✓');
      onSaved?.(saved);
    } catch (e) {
      // Keep draft exactly as typed if save fails.
      setSaveState('Not saved');
      setError(`Save failed: ${e.message}. Your entered values are still kept on this device.`);
    }
  };

  const reloadServer = async () => {
    if (!window.confirm('Discard your current local values and reload the configuration stored on Railway?')) return;
    setError('');
    try {
      const server = await api.getServerTradingConfig();
      api.clearTradingConfigCache();
      api.cacheTradingConfigDraft(server);
      const saved = await api.setTradingConfig(server);
      setDraft({ ...DEFAULTS, ...saved });
      setSaveState('Reloaded from Railway');
    } catch (e) {
      setError(`Could not reload Railway settings: ${e.message}`);
    }
  };

  if (!loaded) return <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading trading configuration…</div>;

  return (
    <div style={compact ? compactCard : card}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: compact ? 14 : 4 }}>
        <Field label="Starting Capital ($)" value={draft.startingCapital}
          onChange={v => edit('startingCapital', v)} min="0.01" step="0.01"
          note={!compact ? 'Paper seed after Reset Paper Balance. Live equity always comes from Alpaca.' : null} />

        <PercentField label="Risk Per Trade (%)" fraction={draft.riskPerTrade}
          onChange={v => edit('riskPerTrade', v)} min="0.1" max="100" step="0.1"
          note={!compact ? 'Used for live position sizing as a percentage of current Alpaca equity.' : null} />

        <Field label="Max Trades Per Session" value={draft.maxTradesPerSession}
          onChange={v => edit('maxTradesPerSession', v)} min="1" max="1000" step="1" />

        <Field label="Max Trades Per Market / Symbol" value={draft.maxTradesPerMarket}
          onChange={v => edit('maxTradesPerMarket', v)} min="1" max="1000" step="1" />

        <PercentField label="Paper Win Rate Target (%)" fraction={draft.winRateTarget}
          onChange={v => edit('winRateTarget', v)} min="0" max="100" step="0.1"
          note={!compact ? 'Legacy paper simulator setting only. It is not a live-performance guarantee.' : null} />

        <PercentField label="Daily Loss Halt (%)" fraction={draft.dailyLossLimit}
          onChange={v => edit('dailyLossLimit', v)} min="0.1" max="100" step="0.1" />

        <Field label="Consecutive Losses Before Halt" value={draft.consecutiveStopLoss}
          onChange={v => edit('consecutiveStopLoss', v)} min="1" max="100" step="1" />
      </div>

      {error && <div style={{ marginTop: 12, color: '#fca5a5', fontSize: 12, lineHeight: 1.4 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" onClick={save} style={primaryButton}>Save Configuration</button>
        {!compact && <button type="button" onClick={reloadServer} style={secondaryButton}>Reload from Railway</button>}
        {saveState && (
          <span style={{ fontSize: 12, color: saveState === 'Saved ✓' ? '#4ade80' : '#fbbf24' }}>
            {saveState}
          </span>
        )}
      </div>

      {!compact && (
        <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 11, lineHeight: 1.45 }}>
          Values are kept locally on every keystroke. Clicking another field, closing this page, or a failed save
          will not replace them with presets. Railway is updated only when you press <b>Save Configuration</b>.
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, note, ...props }) {
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        {...props}
        style={inputStyle}
      />
      {note && <span style={noteStyle}>{note}</span>}
    </label>
  );
}

function PercentField({ label, fraction, onChange, note, ...props }) {
  const shown = fraction === '' || fraction == null ? '' : String(Number(fraction) * 100);
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        value={shown}
        onChange={e => {
          const raw = e.target.value;
          onChange(raw === '' ? '' : Number(raw) / 100);
        }}
        {...props}
        style={inputStyle}
      />
      {note && <span style={noteStyle}>{note}</span>}
    </label>
  );
}

const card = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' };
const compactCard = { background: 'transparent' };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const labelStyle = { color: '#9ca3af', fontSize: 12 };
const noteStyle = { color: '#7c8799', fontSize: 11, lineHeight: 1.35 };
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 10px',
  background: '#0f1419', border: '1px solid #2a2e4a',
  borderRadius: 6, color: '#fff', fontSize: 14,
};
const primaryButton = { padding: '10px 16px', background: '#3b82f6', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700 };
const secondaryButton = { padding: '10px 16px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' };
