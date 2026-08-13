import React, { useCallback, useEffect, useState } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';
import { api } from '../lib/api.js';

export default function Settings() {
  const [creds, setCreds] = useState(null);
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingMode] = useState(null);

  const [brokerAccounts, setBrokerAccounts] = useState({
    paper: null,
    live: null,
  });

  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getCredentials(),
      api.getLiveGate(),
      api.getTradingMode(),
      api.getBrokerAccounts(),
    ]);

    if (results[0].status === 'fulfilled') {
      setCreds(results[0].value);
    }

    if (results[1].status === 'fulfilled') {
      setGate(results[1].value);
    }

    if (results[2].status === 'fulfilled') {
      setTradingMode(results[2].value);
    }

    if (results[3].status === 'fulfilled') {
      setBrokerAccounts(
        results[3].value || {
          paper: null,
          live: null,
        }
      );
    }

    const failures = results.filter(
      (result) => result.status === 'rejected'
    );

    if (failures.length) {
      setError(
        failures
          .map(
            (result) =>
              result.reason?.message || 'Request failed'
          )
          .join(' · ')
      );
    } else {
      setError('');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const paperConnected =
    brokerAccounts?.paper?.connected === true;

  const liveConnected =
    brokerAccounts?.live?.connected === true;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div
        style={{
          color: '#60a5fa',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        MOMENTUMFLOW SETTINGS v10
      </div>

      {error && (
        <div
          style={{
            color: '#f87171',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

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
        <h2 style={h2}>
          Alpaca broker connection
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <ConnectionCard
            title="Paper"
            connected={paperConnected}
            error={brokerAccounts?.paper?.error}
            equity={brokerAccounts?.paper?.equity}
          />

          <ConnectionCard
            title="Live"
            connected={liveConnected}
            error={brokerAccounts?.live?.error}
            equity={brokerAccounts?.live?.equity}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {creds && (
            <>
              <ApiKeyCard
                mode="paper"
                configured={
                  Boolean(creds.paper?.configured)
                }
                keyIdMasked={
                  creds.paper?.keyIdMasked
                }
                onSaved={refresh}
              />

              <ApiKeyCard
                mode="live"
                configured={
                  Boolean(creds.live?.configured)
                }
                keyIdMasked={
                  creds.live?.keyIdMasked
                }
                onSaved={refresh}
              />
            </>
          )}
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>

        <LiveGateChecklist
          gate={gate}
          onChange={refresh}
        />

        <button
          onClick={async () => {
            await api.resetLiveGate();
            await refresh();
          }}
          style={secondaryButton}
        >
          Reset all consents
        </button>
      </section>

      <section>
        <h2 style={h2}>
          Adjustable Trading Configuration
        </h2>

        <TradingConfigPanel />
      </section>

      <section>
        <h2 style={h2}>Safety behavior</h2>

        <div style={card}>
          <SafetyRow>
            Daily loss halt uses your saved
            Daily Loss Halt setting.
          </SafetyRow>

          <SafetyRow>
            Consecutive-loss halt uses your
            saved Consecutive Losses setting.
          </SafetyRow>

          <SafetyRow>
            Session and symbol trade limits use
            your saved trading configuration.
          </SafetyRow>

          <SafetyRow>
            Live orders still require Live Mode,
            the completed Live Gate, the server
            enable flag, and verified live Alpaca
            credentials.
          </SafetyRow>
        </div>
      </section>
    </div>
  );
}

function ConnectionCard({
  title,
  connected,
  error,
  equity,
}) {
  return (
    <div style={card}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: connected
              ? '#4ade80'
              : '#f87171',
          }}
        />

        <strong
          style={{
            color: connected
              ? '#4ade80'
              : '#f87171',
          }}
        >
          {title}:{' '}
          {connected
            ? 'CONNECTED'
            : 'NOT CONNECTED'}
        </strong>
      </div>

      {connected &&
        Number.isFinite(Number(equity)) && (
          <div
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}
          >
            Equity: $
            {Number(equity).toFixed(2)}
          </div>
        )}

      {!connected && error && (
        <div
          style={{
            marginTop: 6,
            color: '#fbbf24',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function SafetyRow({ children }) {
  return (
    <div
      style={{
        padding: '7px 0',
        color: 'var(--text-secondary)',
        fontSize: 13,
        lineHeight: 1.45,
        borderBottom:
          '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {children}
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

const secondaryButton = {
  marginTop: 8,
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--text-secondary)',
  borderRadius: 8,
  padding: '9px 12px',
  cursor: 'pointer',
};
