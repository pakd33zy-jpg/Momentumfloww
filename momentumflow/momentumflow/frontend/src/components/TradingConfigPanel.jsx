import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const DRAFT_KEY = 'momentumflow_trading_config_draft_v8';

const EMPTY = {
  startingCapital: '',
  riskPerTradePct: '',
  maxTradesPerSession: '',
  maxTradesPerMarket: '',
  winRateTargetPct: '',
  dailyLossLimitPct: '',
  consecutiveStopLoss: '',
};

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

function toServer(draft) {
  return {
    startingCapital: Number(draft.startingCapital),
    riskPerTrade: Number(draft.riskPerTradePct) / 100,
    maxTradesPerSession: Math.trunc(Number(draft.maxTradesPerSession)),
    maxTradesPerMarket: Math.trunc(Number(draft.maxTradesPerMarket)),
    winRateTarget: Number(draft.winRateTargetPct) / 100,
    dailyLossLimit: Number(draft.dailyLossLimitPct) / 100,
    consecutiveStopLoss: Math.trunc(Number(draft.consecutiveStopLoss)),
  };
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}

export default function TradingConfigPanel({ compact = false, onSaved }) {
  const [draft, setDraft] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const local = readDraft();
    if (local) {
      setDraft({ ...EMPTY, ...local });
      setLoaded(true);
      setStatus('Local values loaded');
      return () => { alive = false; };
    }

    (async () => {
      try {
        const remote = await api.getTradingConfig();
        if (!alive) return;
        const values = fromServer(remote);
        setDraft(values);
        writeDraft(values);
        setStatus('');
      } catch (e) {
        if (!alive) return;
        setError(`Could not load saved settings: ${e.message}`);
        setStatus('');
      } finally {
        if (alive) setLoaded(true);
      }
    })();

    return () => { alive = false; };
  }, []);

  function change(key, value) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      writeDraft(next);
      return next;
    });
    setStatus('Unsaved changes');
    setError('');
  }

  async function save() {
    setStatus('Saving…');
    setError('');
    try {
      const saved = await api.setTradingConfig(toServer(draft));
      const canonical = fromServer(saved);
      setDraft(canonical);
      writeDraft(canonical);
      setStatus('Saved ✓');
      onSaved?.(saved);
    } catch (e) {
      setStatus('Not saved');
      setError(`Save failed: ${e.message}`);
    }
  }

  async function reloadRailway() {
    if (!window.confirm('Replace the values shown here with the configuration currently stored on Railway?')) return;
    setStatus('Reloading…');
    setError('');
    try {
      const remote = await api.getTradingConfig();
      const values = fromServer(remote);
      setDraft(values);
      writeDraft(values);
      setStatus('Reloaded from Railway');
    } catch (e) {
      setStatus('');
      setError(`Reload failed: ${e.message}`);
    }
  }

  if (!loaded) return <div style={{ fontSize: 13, color: '#9ca3af' }}>{status}</div>;

  return (
    <div style={compact ? compactCard : card}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: compact ? 14 : 8 }}>
        <Field label="Starting Capital ($)" value={draft.startingCapital} onChange={(v) => change('startingCapital', v)} min="0.01" step="0.01" />
        <Field label="Risk Per Trade (%)" value={draft.riskPerTradePct} onChange={(v) => change('riskPerTradePct', v)} min="0.1" max="100" step="0.1" />
        <Field label="Max Trades Per Session" value={draft.maxTradesPerSession} onChange={(v) => change('maxTradesPerSession', v)} min="1" max="1000" step="1" />
        <Field label="Max Trades Per Market / Symbol" value={draft.maxTradesPerMarket} onChange={(v) => change('maxTradesPerMarket', v)} min="1" max="1000" step="1" />
        <Field label="Paper Win Rate Target (%)" value={draft.winRateTargetPct} onChange={(v) => change('winRateTargetPct', v)} min="0" max="100" step="0.1" />
        <Field label="Daily Loss Halt (%)" value={draft.dailyLossLimitPct} onChange={(v) => change('dailyLossLimitPct', v)} min="0.1" max="100" step="0.1" />
        <Field label="Consecutive Losses Before Halt" value={draft.consecutiveStopLoss} onChange={(v) => change('consecutiveStopLoss', v)} min="1" max="100" step="1" />
      </div>

      {error && <div style={{ marginTop: 12, color: '#f87171', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" onClick={save} style={primaryButton}>Save Configuration</button>
        {!compact && <button type="button" onClick={reloadRailway} style={secondaryButton}>Reload from Railway</button>}
        {status && <span style={{ fontSize: 12, color: status === 'Saved ✓' ? '#4ade80' : '#fbbf24' }}>{status}</span>}
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: '#64748b' }}>SETTINGS ENGINE v8</div>
    </div>
  );
}

function Field({ label, value, onChange, ...props }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: '#9ca3af' }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '9px 10px',
          background: '#0f1419', border: '1px solid #2a2e4a', borderRadius: 6,
          color: '#fff', fontSize: 14,
        }}
      />
    </label>
  );
}

const card = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' };
const compactCard = { background: 'transparent' };
const primaryButton = { padding: '10px 16px', background: '#3b82f6', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700 };
const secondaryButton = { padding: '10px 16px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' };
