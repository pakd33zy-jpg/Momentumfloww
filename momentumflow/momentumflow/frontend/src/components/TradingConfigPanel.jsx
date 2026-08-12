import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const FIELD_NAMES = [
  'startingCapital',
  'riskPerTradePct',
  'maxTradesPerSession',
  'maxTradesPerMarket',
  'winRateTargetPct',
  'dailyLossLimitPct',
  'consecutiveStopLoss',
];

function fromServer(cfg = {}) {
  return {
    startingCapital: String(cfg.startingCapital ?? 100),
    riskPerTradePct: String(Number(cfg.riskPerTrade ?? 0.02) * 100),
    maxTradesPerSession: String(cfg.maxTradesPerSession ?? cfg.tradesPerSession ?? 24),
    maxTradesPerMarket: String(cfg.maxTradesPerMarket ?? cfg.tradesPerMarket ?? 12),
    winRateTargetPct: String(Number(cfg.winRateTarget ?? 0.875) * 100),
    dailyLossLimitPct: String(Number(cfg.dailyLossLimit ?? 0.10) * 100),
    consecutiveStopLoss: String(cfg.consecutiveStopLoss ?? 3),
  };
}

function toServer(raw) {
  return {
    startingCapital: Number(raw.startingCapital),
    riskPerTrade: Number(raw.riskPerTradePct) / 100,
    maxTradesPerSession: Math.trunc(Number(raw.maxTradesPerSession)),
    maxTradesPerMarket: Math.trunc(Number(raw.maxTradesPerMarket)),
    winRateTarget: Number(raw.winRateTargetPct) / 100,
    dailyLossLimit: Number(raw.dailyLossLimitPct) / 100,
    consecutiveStopLoss: Math.trunc(Number(raw.consecutiveStopLoss)),
  };
}

function readForm(form) {
  if (!form) return null;
  const out = {};
  for (const name of FIELD_NAMES) {
    out[name] = form.elements[name]?.value ?? '';
  }
  return out;
}

function writeForm(form, values) {
  if (!form || !values) return;
  for (const [name, value] of Object.entries(values)) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
}

export default function TradingConfigPanel({ compact = false, onSaved }) {
  const formRef = useRef(null);
  const [initial, setInitial] = useState(null);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    (async () => {
      const local = api.readTradingConfigDraft();
      if (local) {
        if (alive) {
          setInitial(local);
          setStatus('Local values loaded');
        }
        return;
      }

      try {
        const remote = await api.getTradingConfig();
        if (!alive) return;
        const values = fromServer(remote);
        setInitial(values);
        setStatus('');
      } catch (e) {
        if (!alive) return;
        const fallback = fromServer({});
        setInitial(fallback);
        setError(`Could not load Railway configuration: ${e.message}`);
        setStatus('Using first-run defaults');
      }
    })();

    return () => { alive = false; };
  }, []);

  const preserve = () => {
    const values = readForm(formRef.current);
    if (!values) return;
    api.writeTradingConfigDraft(values);
    setStatus('Unsaved changes');
    setError('');
  };

  const save = async () => {
    const raw = readForm(formRef.current);
    if (!raw) return;

    api.writeTradingConfigDraft(raw);
    setStatus('Saving…');
    setError('');

    try {
      const saved = await api.setTradingConfig(toServer(raw));
      const canonical = fromServer(saved);
      api.clearTradingConfigDraft();
      writeForm(formRef.current, canonical);
      setStatus('Saved ✓');
      onSaved?.(saved);
    } catch (e) {
      setStatus('Not saved');
      setError(`Save failed: ${e.message}. Your typed values were not replaced.`);
    }
  };

  const reload = async () => {
    const ok = window.confirm(
      'Replace the values shown here with the configuration currently stored on Railway?'
    );
    if (!ok) return;

    try {
      const remote = await api.getTradingConfig();
      const values = fromServer(remote);
      api.clearTradingConfigDraft();
      writeForm(formRef.current, values);
      setStatus('Reloaded from Railway');
      setError('');
    } catch (e) {
      setError(`Could not reload Railway configuration: ${e.message}`);
    }
  };

  if (!initial) {
    return <div style={{ color: '#9ca3af', fontSize: 13 }}>{error || status}</div>;
  }

  return (
    <div style={compact ? compactCard : card}>
      <form
        ref={formRef}
        onSubmit={(e) => { e.preventDefault(); save(); }}
        onInput={preserve}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : '1fr',
          gap: compact ? 14 : 4,
        }}>
          <Field name="startingCapital" label="Starting Capital ($)"
            defaultValue={initial.startingCapital} min="0.01" step="0.01"
            note={!compact ? 'Paper seed after Reset Paper Balance. Live equity comes from Alpaca.' : null} />

          <Field name="riskPerTradePct" label="Risk Per Trade (%)"
            defaultValue={initial.riskPerTradePct} min="0.1" max="100" step="0.1"
            note={!compact ? 'Existing live sizing control: percent of current Alpaca equity per entry.' : null} />

          <Field name="maxTradesPerSession" label="Max Trades Per Session"
            defaultValue={initial.maxTradesPerSession} min="1" max="1000" step="1" />

          <Field name="maxTradesPerMarket" label="Max Trades Per Market / Symbol"
            defaultValue={initial.maxTradesPerMarket} min="1" max="1000" step="1" />

          <Field name="winRateTargetPct" label="Paper Win Rate Target (%)"
            defaultValue={initial.winRateTargetPct} min="0" max="100" step="0.1"
            note={!compact ? 'Legacy simulator setting only; not a live-performance guarantee.' : null} />

          <Field name="dailyLossLimitPct" label="Daily Loss Halt (%)"
            defaultValue={initial.dailyLossLimitPct} min="0.1" max="100" step="0.1" />

          <Field name="consecutiveStopLoss" label="Consecutive Losses Before Halt"
            defaultValue={initial.consecutiveStopLoss} min="1" max="100" step="1" />
        </div>

        {error && (
          <div style={{ marginTop: 12, color: '#fca5a5', fontSize: 12, lineHeight: 1.4 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
          <button type="submit" style={primaryButton}>Save Configuration</button>
          <button type="button" onClick={reload} style={secondaryButton}>Reload Saved Values</button>
          {status && (
            <span style={{ fontSize: 12, color: status === 'Saved ✓' ? '#4ade80' : '#fbbf24' }}>
              {status}
            </span>
          )}
        </div>

        <div style={{ marginTop: 10, color: '#60a5fa', fontSize: 10, fontWeight: 700 }}>
          SETTINGS ENGINE v9
        </div>
      </form>
    </div>
  );
}

function Field({ name, label, defaultValue, note, ...props }) {
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      <input
        name={name}
        type="number"
        defaultValue={defaultValue}
        {...props}
        style={inputStyle}
      />
      {note && <span style={noteStyle}>{note}</span>}
    </label>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};
const compactCard = { background: 'transparent' };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const labelStyle = { color: '#9ca3af', fontSize: 12 };
const noteStyle = { color: '#7c8799', fontSize: 11, lineHeight: 1.35 };
const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  background: '#0f1419',
  border: '1px solid #2a2e4a',
  borderRadius: 6,
  color: '#fff',
  fontSize: 14,
};
const primaryButton = {
  padding: '10px 16px',
  background: '#3b82f6',
  color: '#fff',
  border: 0,
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 700,
};
const secondaryButton = {
  padding: '10px 16px',
  background: 'transparent',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 6,
  cursor: 'pointer',
};
