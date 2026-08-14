import React from 'react';
import { api } from '../lib/api.js';

const ITEM_LABELS = {
  understands_real_capital: 'I understand live sessions risk real capital',
  reviewed_strategy_backtest: 'I reviewed the strategy\u2019s paper session results',
  alpaca_live_key_configured: 'My Alpaca live keys are configured',
  accepts_safety_halts: 'I accept the automatic safety halts and won\u2019t override them',
  confirms_risk_tolerance: 'I confirm this risk level is appropriate for me',
};

export default function LiveGateChecklist({ gate, onChange }) {
  if (!gate) return null;
  const items = Object.entries(gate.consents);

  async function toggle(key, value) {
    await api.setLiveGateItem(key, value);
    onChange?.();
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="display" style={{ fontWeight: 600 }}>Live Gate</span>
        <span className="mono" style={{ fontSize: 12, color: gate.unlocked ? 'var(--signal-up)' : 'var(--signal-armed)' }}>
          {gate.consented_count}/{gate.total_required}
        </span>
      </div>

      <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(([key, checked], idx) => (
          <li key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button
              onClick={() => toggle(key, !checked)}
              aria-pressed={checked}
              aria-label={ITEM_LABELS[key]}
              style={{
                ...checkbox,
                background: checked ? 'var(--signal-up)' : 'transparent',
                borderColor: checked ? 'var(--signal-up)' : 'var(--line)',
                color: checked ? '#08110B' : 'var(--text-secondary)',
              }}
            >
              {checked ? '✓' : idx + 1}
            </button>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {ITEM_LABELS[key]}
            </span>
          </li>
        ))}
      </ol>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--text-dim)' }}>
        Server override (<code className="mono">LIVE_TRADING_ENABLED</code>): {gate.live_trading_env_enabled ? 'ON' : 'OFF'}
      </div>

      {!gate.unlocked && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal-armed)' }}>{gate.reason}</div>
      )}
      {gate.unlocked && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal-live)', fontWeight: 600 }}>
          Live trading is armed. Starting the automated live bot is a separate explicit action on Dashboard.
        </div>
      )}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '16px',
};

const checkbox = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid var(--line)',
  color: '#08110B',
  fontSize: 12,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  cursor: 'pointer',
};
