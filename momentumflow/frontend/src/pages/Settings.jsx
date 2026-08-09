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

  const refresh = useCallback(async () => {
    const [c, g, m] = await Promise.all([api.getCredentials(), api.getLiveGate(), api.getTradingMode()]);
    setCreds(c);
    setGate(g);
    setTradingModeState(m);
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
          <ConfigRow label="Starting capital" value="$100 (seed)" />
          <ConfigRow label="Risk per trade" value="2% (paper simulation)" />
          <ConfigRow label="Max trades / session" value="24" />
          <ConfigRow label="Max trades / market" value="12" />
        </div>
      </section>
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
