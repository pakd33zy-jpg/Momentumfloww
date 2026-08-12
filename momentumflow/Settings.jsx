import React, { useCallback, useEffect, useState } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';
import { api } from '../lib/api.js';

export default function Settings() {
  const [creds, setCreds] = useState(null);
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingModeState] = useState(null);
  const [brokerAccounts, setBrokerAccounts] = useState({ paper: null, live: null });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getCredentials(),
      api.getLiveGate(),
      api.getTradingMode(),
      api.getBrokerAccounts(),
    ]);

    if (results[0].status === 'fulfilled') setCreds(results[0].value);
    if (results[1].status === 'fulfilled') setGate(results[1].value);
    if (results[2].status === 'fulfilled') setTradingModeState(results[2].value);
    if (results[3].status === 'fulfilled') setBrokerAccounts(results[3].value || { paper: null, live: null });

    const bad = results.filter(r => r.status === 'rejected');
    setError(bad.length ? bad.map(r => r.reason?.message || 'request failed').join(' · ') : '');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700 }}>MOMENTUMFLOW UI v9</div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      <section>
        <h2 style={h2}>Trading mode</h2>
        {tradingMode && (
          <TradingModeToggle
            mode={tradingMode.mode}
            liveUnlocked={gate?.unlocked}
            onChanged={refresh}
          />
        )}
      </section>

      <section>
        <h2 style={h2}>Broker connection — verified by Alpaca</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {creds && (
            <>
              <ApiKeyCard
                mode="paper"
                configured={Boolean(creds.paper?.configured)}
                keyIdMasked={creds.paper?.keyIdMasked}
                connected={Boolean(brokerAccounts.paper?.connected)}
                connectionError={brokerAccounts.paper?.error}
                onSaved={refresh}
              />
              <ApiKeyCard
                mode="live"
                configured={Boolean(creds.live?.configured)}
                keyIdMasked={creds.live?.keyIdMasked}
                connected={Boolean(brokerAccounts.live?.connected)}
                connectionError={brokerAccounts.live?.error}
                onSaved={refresh}
              />
            </>
          )}
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>
        <LiveGateChecklist gate={gate} onChange={refresh} />
        <button
          onClick={async () => { await api.resetLiveGate(); await refresh(); }}
          style={secondaryButton}
        >
          Reset all consents
        </button>
      </section>

      <section>
        <h2 style={h2}>Adjustable trading settings</h2>
        <TradingConfigPanel />
      </section>
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
const secondaryButton = {
  marginTop: 8,
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--text-secondary)',
  borderRadius: 8,
  padding: '9px 12px',
  cursor: 'pointer',
};
