import React, { useEffect, useState, useCallback } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import { api } from '../lib/api.js';

const SAFETY_RULES = [
  'Paper mode is forced on every server restart',
  '10% daily loss triggers an automatic session halt',
  '3 consecutive losses triggers an automatic halt',
  '12-trade cap per market, 24-trade cap per session',
  'Live orders require the full Live Gate + a server-side LIVE_TRADING_ENABLED flag',
];

export default function Settings() {
  const [creds, setCreds] = useState(null);
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingModeState] = useState(null);
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    const [c, g, m, cfg] = await Promise.all([
      api.getCredentials(), api.getLiveGate(), api.getTradingMode(), api.getTradingConfig(),
    ]);
    setCreds(c);
    setGate(g);
    setTradingModeState(m);
    setConfig(cfg);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h2 style={h2}>Trading mode</h2>
        {tradingMode && (
          <TradingModeToggle mode={tradingMode.mode} liveUnlocked={gate?.unlocked} onChanged={refresh} />
        )}
      </section>

      <section>
        <h2 style={h2}>Broker connection</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {creds && (
            <>
              <ApiKeyCard mode="paper" configured={creds.paper.configured} keyIdMasked={creds.paper.keyIdMasked} onSaved={refresh} />
              <ApiKeyCard mode="live" configured={creds.live.configured} keyIdMasked={creds.live.keyIdMasked} onSaved={refresh} />
            </>
          )}
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>
        <LiveGateChecklist gate={gate} onChange={refresh} />
        <button
          onClick={async () => { await api.resetLiveGate(); refresh(); }}
          style={{ marginTop: 8, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          Reset all consents
        </button>
      </section>

      <section>
        <h2 style={h2}>Safety rules</h2>
        <div style={card}>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SAFETY_RULES.map((rule) => (
              <li key={rule} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{rule}</li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 style={h2}>Trading config</h2>
        <div style={card}>
          {config && <StartingCapitalRow value={config.startingCapital} onSaved={refresh} />}
          <ConfigRow label="Risk per trade" value="2% (paper simulation)" />
          <ConfigRow label="Max trades / session" value="24" />
          <ConfigRow label="Max trades / market" value="12" />
        </div>
      </section>
    </div>
  );
}

function StartingCapitalRow({ value, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setStartingCapital(Number(input));
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Starting capital (seed)</span>
        <button
          onClick={() => { setInput(String(value)); setEditing(true); }}
          style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span className="mono">${value}</span>
          <span style={{ fontSize: 11, textDecoration: 'underline' }}>edit</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Starting capital (seed)</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number"
          min="1"
          step="any"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={seedInput}
        />
        <button onClick={save} disabled={busy || !input || Number(input) <= 0} style={saveBtn}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} style={cancelBtn}>Cancel</button>
      </div>
      {error && <div style={{ color: 'var(--signal-down)', fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
        Applies to the next session you run — it doesn't rewrite past session history.
      </div>
    </div>
  );
}

function ConfigRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

const h2 = {
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-secondary)',
  margin: '0 0 8px',
};

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};

const seedInput = {
  flex: 1,
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 10px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
};

const saveBtn = {
  background: 'var(--accent)',
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
