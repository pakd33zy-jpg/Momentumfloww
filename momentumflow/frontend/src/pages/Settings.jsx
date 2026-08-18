import React, { useCallback, useEffect, useState } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';
import { api } from '../lib/api.js';
import RejectionLogPanel from '../components/RejectionLogPanel.jsx';
import FastScalpToggle from '../components/FastScalpToggle.jsx';
import EquityV20Panel from '../components/EquityV20Panel.jsx';
import StrategyPerformancePanel from '../components/StrategyPerformancePanel.jsx';
import PaperForwardSessionPanel from '../components/PaperForwardSessionPanel.jsx';
const EMPTY_CREDS = {
  paper: { configured: false, keyIdMasked: '' },
  live: { configured: false, keyIdMasked: '' },
};

export default function Settings() {
  // Keep credential forms mounted even when the credential-status GET request
  // fails. This lets the user enter/replace keys instead of hiding the inputs.
  const [creds, setCreds] = useState(EMPTY_CREDS);
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingMode] = useState(null);
  const [brokerAccounts, setBrokerAccounts] = useState({
    paper: null,
    live: null,
  });
  const [errors, setErrors] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);

    const results = await Promise.allSettled([
      api.getCredentials(),
      api.getLiveGate(),
      api.getTradingMode(),
      api.getBrokerAccounts(),
    ]);

    const nextErrors = [];

    if (results[0].status === 'fulfilled') {
      setCreds({
        paper: {
          ...EMPTY_CREDS.paper,
          ...(results[0].value?.paper || {}),
        },
        live: {
          ...EMPTY_CREDS.live,
          ...(results[0].value?.live || {}),
        },
      });
    } else {
      nextErrors.push(
        `Credential status: ${results[0].reason?.message || 'request failed'}`
      );
    }

    if (results[1].status === 'fulfilled') {
      setGate(results[1].value);
    } else {
      nextErrors.push(
        `Live Gate: ${results[1].reason?.message || 'request failed'}`
      );
    }

    if (results[2].status === 'fulfilled') {
      setTradingMode(results[2].value);
    } else {
      nextErrors.push(
        `Trading mode: ${results[2].reason?.message || 'request failed'}`
      );
    }

    if (results[3].status === 'fulfilled') {
      setBrokerAccounts(
        results[3].value || {
          paper: null,
          live: null,
        }
      );
    } else {
      nextErrors.push(
        `Broker account check: ${results[3].reason?.message || 'request failed'}`
      );
    }

    setErrors(nextErrors);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const paperConnected = brokerAccounts?.paper?.connected === true;
  const liveConnected = brokerAccounts?.live?.connected === true;

  return (
    <div style={page}>
      <div style={versionLabel}>MOMENTUMFLOW SETTINGS v20</div>

      {errors.length > 0 && (
        <div style={warningCard}>
          <strong>Some backend status checks failed.</strong>
          <div style={{ marginTop: 5 }}>
            You can still type or replace your Alpaca keys below. If saving also
            fails, the error shown on the key card is the request we need to fix.
          </div>
          {errors.map((message) => (
            <div key={message} style={{ marginTop: 4 }}>
              • {message}
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 style={h2}>Trading mode</h2>
        {tradingMode ? (
          <TradingModeToggle
            mode={tradingMode.mode}
            liveUnlocked={gate?.unlocked}
            onChanged={refresh}
          />
        ) : (
          <div style={muted}>Loading trading mode…</div>
        )}
      </section>

      <section>
        <div style={sectionTitleRow}>
          <h2 style={{ ...h2, margin: 0 }}>Alpaca broker connection</h2>
          <button onClick={refresh} disabled={refreshing} style={secondaryButton}>
            {refreshing ? 'Refreshing…' : 'Refresh Status'}
          </button>
        </div>

        <div style={connectionGrid}>
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

        <div style={keyCards}>
          <ApiKeyCard
            mode="paper"
            configured={Boolean(creds.paper?.configured)}
            keyIdMasked={creds.paper?.keyIdMasked}
            onSaved={refresh}
          />

          <ApiKeyCard
            mode="live"
            configured={Boolean(creds.live?.configured)}
            keyIdMasked={creds.live?.keyIdMasked}
            onSaved={refresh}
          />
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>
        <LiveGateChecklist gate={gate} onChange={refresh} />
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
        <h2 style={h2}>Adjustable Trading Configuration</h2>
        <TradingConfigPanel />
      </section>

           <section>
      <h2 style={h2}>Fast Scalp</h2>
      <FastScalpToggle />
    </section>

    <section>
      <h2 style={h2}>Equity v20 Adaptive</h2>
      <EquityV20Panel />
    </section>

    <section>
        <h2 style={h2}>
          Strategy Analysis
        </h2>

        <StrategyPerformancePanel />
        <div style={{ height: 10 }} />
        <PaperForwardSessionPanel />
        <div style={{ height: 10 }} />
        <RejectionLogPanel />
      </section> <section>
        <h2 style={h2}>Safety behavior</h2>
        <div style={card}>
          <SafetyRow>Daily loss halt uses your saved Daily Loss Halt setting.</SafetyRow>
          <SafetyRow>
            Consecutive-loss halt uses your saved Consecutive Losses setting.
          </SafetyRow>
          <SafetyRow>
            Session and symbol trade limits use your saved trading configuration.
          </SafetyRow>
          <SafetyRow>
            Live orders still require Live Mode, the completed Live Gate, the
            server enable flag, and verified live Alpaca credentials.
          </SafetyRow>
        </div>
      </section>
    </div>
  );
}

function ConnectionCard({ title, connected, error, equity }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: connected ? '#4ade80' : '#f87171',
          }}
        />
        <strong style={{ color: connected ? '#4ade80' : '#f87171' }}>
          {title}: {connected ? 'CONNECTED' : 'NOT CONNECTED'}
        </strong>
      </div>

      {connected && Number.isFinite(Number(equity)) && (
        <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
          Equity: ${Number(equity).toFixed(2)}
        </div>
      )}

      {!connected && error && (
        <div style={{ marginTop: 6, color: '#fbbf24', fontSize: 11, lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SafetyRow({ children }) {
  return <div style={safetyRow}>{children}</div>;
}

const page = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const versionLabel = {
  color: '#60a5fa',
  fontSize: 11,
  fontWeight: 700,
};

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

const warningCard = {
  ...card,
  color: '#fbbf24',
  fontSize: 12,
  lineHeight: 1.45,
};

const muted = {
  color: 'var(--text-dim)',
  fontSize: 12,
};

const sectionTitleRow = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  marginBottom: 8,
};

const connectionGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 10,
  marginBottom: 12,
};

const keyCards = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const secondaryButton = {
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--text-secondary)',
  borderRadius: 8,
  padding: '9px 12px',
  cursor: 'pointer',
};

const safetyRow = {
  padding: '7px 0',
  color: 'var(--text-secondary)',
  fontSize: 13,
  lineHeight: 1.45,
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};
