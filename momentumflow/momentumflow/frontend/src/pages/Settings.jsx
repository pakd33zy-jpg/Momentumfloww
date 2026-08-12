import React, { useCallback, useEffect, useState } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';
import BrokerStatus from '../components/BrokerStatus.jsx';
import { api } from '../lib/api.js';

export default function Settings() {
  const [creds, setCreds] = useState(null);
  const [accounts, setAccounts] = useState({ paper: null, live: null });
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingModeState] = useState({ mode: 'paper' });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getCredentials(),
      api.getBrokerAccounts(),
      api.getLiveGate(),
      api.getTradingMode(),
    ]);
    if (results[0].status === 'fulfilled') setCreds(results[0].value);
    if (results[1].status === 'fulfilled') setAccounts(results[1].value || { paper: null, live: null });
    if (results[2].status === 'fulfilled') setGate(results[2].value);
    if (results[3].status === 'fulfilled') setTradingModeState(results[3].value || { mode: 'paper' });
    const failures = results.filter((r) => r.status === 'rejected');
    setError(failures.length ? failures.map((r) => r.reason?.message || 'request failed').join(' · ') : '');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h2 style={h2}>Trading mode</h2>
        <TradingModeToggle mode={tradingMode?.mode || 'paper'} liveUnlocked={gate?.unlocked} onChanged={refresh} />
      </section>

      <section>
        <h2 style={h2}>Broker status</h2>
        <BrokerStatus mode={tradingMode?.mode || 'paper'} accounts={accounts} />
      </section>

      <section>
        <h2 style={h2}>Broker connection</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {creds && <>
            <ApiKeyCard
              mode="paper"
              configured={creds.paper?.configured}
              keyIdMasked={creds.paper?.keyIdMasked}
              connected={Boolean(accounts?.paper?.connected)}
              connectionError={accounts?.paper?.error}
              onSaved={refresh}
            />
            <ApiKeyCard
              mode="live"
              configured={creds.live?.configured}
              keyIdMasked={creds.live?.keyIdMasked}
              connected={Boolean(accounts?.live?.connected)}
              connectionError={accounts?.live?.error}
              onSaved={refresh}
            />
          </>}
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>
        <LiveGateChecklist gate={gate} onChange={refresh} />
        <button onClick={async () => { await api.resetLiveGate(); refresh(); }} style={secondaryButton}>Reset all consents</button>
      </section>

      <section>
        <h2 style={h2}>Trading configuration</h2>
        <TradingConfigPanel />
      </section>

      <section>
        <h2 style={h2}>Live bot scope</h2>
        <div style={card}>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            Automated live scanning covers Alpaca active tradable equities/ETFs plus crypto. Live order size uses the Risk Per Trade setting as a percentage of current Alpaca live equity, limited by available buying power. There is no fixed $5 entry cap.
          </div>
        </div>
      </section>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      <div style={{ fontSize: 10, color: '#64748b' }}>MOMENTUMFLOW UI v8</div>
    </div>
  );
}

const h2 = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: '0 0 8px' };
const card = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' };
const secondaryButton = { marginTop: 8, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text-secondary)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer' };
