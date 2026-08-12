import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function fromServer(cfg) {
  return {
    startingCapital: String(cfg.startingCapital ?? ''),
    riskPerTradePct: String(Number(cfg.riskPerTrade ?? 0) * 100),
    maxTradesPerSession: String(cfg.maxTradesPerSession ?? cfg.tradesPerSession ?? ''),
    maxTradesPerMarket: String(cfg.maxTradesPerMarket ?? cfg.tradesPerMarket ?? ''),
    winRateTargetPct: String(Number(cfg.winRateTarget ?? 0) * 100),
    dailyLossLimitPct: String(Number(cfg.dailyLossLimit ?? 0) * 100),
    consecutiveStopLoss: String(cfg.consecutiveStopLoss ?? ''),
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

export default function TradingConfigPanel({ compact = false, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const localDraft = api.readTradingConfigDraft();
      if (localDraft && alive) {
        setDraft(localDraft);
        setStatus('Unsaved local values');
        return;
      }
      try {
        const cfg = await api.getTradingConfig();
        if (!alive) return;
        setDraft(fromServer(cfg));
        setStatus('');
      } catch (e) {
        if (!alive) return;
        setError(`Could not load trading configuration: ${e.message}`);
        setStatus('');
      }
    })();
    return () => { alive = false; };
  }, []);

  const edit = (key, value) => {
    setDraft(prev => {
      const next = { ...(prev || {}), [key]: value };
      api.writeTradingConfigDraft(next);
      return next;
    });
    setStatus('Unsaved changes');
    setError('');
  };

  const save = async () => {
    if (!draft) return;
    setStatus('Saving…');
    setError('');
    try {
      const saved = await api.setTradingConfig(toServer(draft));
      const canonical = fromServer(saved);
      setDraft(canonical);
      api.clearTradingConfigDraft();
      setStatus('Saved ✓');
      onSaved?.(saved);
    } catch (e) {
      setStatus('Not saved');
      setError(`Save failed: ${e.message}. Your typed values are still preserved locally.`);
    }
  };

  const discardLocal = async () => {
    api.clearTradingConfigDraft();
    setStatus('Reloading…');
    setError('');
    try {
      const cfg = await api.getTradingConfig();
      setDraft(fromServer(cfg));
      setStatus('Reloaded from Railway');
    } catch (e) {
      setStatus('');
      setError(`Could not reload configuration: ${e.message}`);
    }
  };

  if (!draft) {
    return <div style={{ color: '#9ca3af', fontSize: 13 }}>{error || status}</div>;
  }

  return (
    <div style={compact ? compactCard : card}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : '1fr',
        gap: compact ? 14 : 4
      }}>
        <Field label="Starting Capital ($)" value={draft.startingCapital}
          onChange={v => edit('startingCapital', v)} min="0.01" step="0.01"
          note={!compact ? 'Paper seed after Reset Paper Balance. Live equity always comes from Alpaca.' : null} />
        <Field label="Risk Per Trade (%)" value={draft.riskPerTradePct}
          onChange={v => edit('riskPerTradePct', v)} min="0.1" max="100" step="0.1"
          note={!compact ? 'Live position sizing as a percentage of current Alpaca equity.' : null} />
        <Field label="Max Trades Per Session" value={draft.maxTradesPerSession}
          onChange={v => edit('maxTradesPerSession', v)} min="1" max="1000" step="1" />
        <Field label="Max Trades Per Market / Symbol" value={draft.maxTradesPerMarket}
          onChange={v => edit('maxTradesPerMarket', v)} min="1" max="1000" step="1" />
        <Field label="Paper Win Rate Target (%)" value={draft.winRateTargetPct}
          onChange={v => edit('winRateTargetPct', v)} min="0" max="100" step="0.1"
          note={!compact ? 'Legacy paper-simulator setting only; it does not guarantee live results.' : null} />
        <Field label="Daily Loss Halt (%)" value={draft.dailyLossLimitPct}
          onChange={v => edit('dailyLossLimitPct', v)} min="0.1" max="100" step="0.1" />
        <Field label="Consecutive Losses Before Halt" value={draft.consecutiveStopLoss}
          onChange={v => edit('consecutiveStopLoss', v)} min="1" max="100" step="1" />
      </div>

      {error && <div style={{ marginTop: 12, color: '#fca5a5', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" onClick={save} style={primaryButton}>Save Configuration</button>
        <button type="button" onClick={discardLocal} style={secondaryButton}>Discard Local Changes</button>
        {status && <span style={{ fontSize: 12, color: status === 'Saved ✓' ? '#4ade80' : '#fbbf24' }}>{status}</span>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, note, ...props }) {
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} {...props} style={inputStyle} />
      {note && <span style={noteStyle}>{note}</span>}
    </label>
  );
}

const card = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' };
const compactCard = { background: 'transparent' };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const labelStyle = { color: '#9ca3af', fontSize: 12 };
const noteStyle = { color: '#7c8799', fontSize: 11, lineHeight: 1.35 };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', background: '#0f1419', border: '1px solid #2a2e4a', borderRadius: 6, color: '#fff', fontSize: 14 };
const primaryButton = { padding: '10px 16px', background: '#3b82f6', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700 };
const secondaryButton = { padding: '10px 16px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' };
