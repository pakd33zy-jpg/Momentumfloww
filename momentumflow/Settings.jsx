import React, { useCallback, useEffect, useState } from 'react';
import ApiKeyCard from '../components/ApiKeyCard.jsx';
import LiveGateChecklist from '../components/LiveGateChecklist.jsx';
import TradingModeToggle from '../components/TradingModeToggle.jsx';
import { api } from '../lib/api.js';

const DEFAULT_CONFIG = {
  startingCapital: 100,
  riskPerTrade: 0.02,
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
  winRateTarget: 0.875,
  dailyLossLimit: 0.10,
  consecutiveStopLoss: 3,
};

export default function Settings() {
  const [creds, setCreds] = useState(null);
  const [gate, setGate] = useState(null);
  const [tradingMode, setTradingModeState] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState(DEFAULT_CONFIG);
  const [saveState, setSaveState] = useState('');
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getCredentials(),
      api.getLiveGate(),
      api.getTradingMode(),
    ]);
    if (results[0].status === 'fulfilled') setCreds(results[0].value);
    if (results[1].status === 'fulfilled') setGate(results[1].value);
    if (results[2].status === 'fulfilled') setTradingModeState(results[2].value);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.getTradingConfig();
      const normalized = { ...DEFAULT_CONFIG, ...c };
      setConfig(normalized);
      setSavedConfig(normalized);
      setError('');
    } catch (e) {
      setError(`Could not load trading settings: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    loadConfig();
  }, [refreshStatus, loadConfig]);

  const change = (key, raw) => {
    // Keep a local draft. Do not reload from the server when another field receives focus.
    setConfig((prev) => ({ ...prev, [key]: raw }));
    setSaveState('');
  };

  const numberPayload = () => ({
    startingCapital: Number(config.startingCapital),
    riskPerTrade: Number(config.riskPerTrade),
    maxTradesPerSession: Math.trunc(Number(config.maxTradesPerSession)),
    maxTradesPerMarket: Math.trunc(Number(config.maxTradesPerMarket)),
    winRateTarget: Number(config.winRateTarget),
    dailyLossLimit: Number(config.dailyLossLimit),
    consecutiveStopLoss: Math.trunc(Number(config.consecutiveStopLoss)),
  });

  const save = async () => {
    setSaveState('Saving…');
    setError('');
    try {
      const result = await api.setTradingConfig(numberPayload());
      const normalized = { ...DEFAULT_CONFIG, ...result };
      setConfig(normalized);
      setSavedConfig(normalized);
      setSaveState('Saved ✓');
    } catch (e) {
      setSaveState('');
      setError(e.message);
    }
  };

  const discard = () => {
    setConfig(savedConfig);
    setSaveState('Changes discarded');
    setError('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h2 style={h2}>Trading mode</h2>
        {tradingMode && (
          <TradingModeToggle mode={tradingMode.mode} liveUnlocked={gate?.unlocked} onChanged={refreshStatus} />
        )}
      </section>

      <section>
        <h2 style={h2}>Broker connection</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {creds && <>
            <ApiKeyCard mode="paper" configured={creds.paper.configured} keyIdMasked={creds.paper.keyIdMasked} onSaved={refreshStatus} />
            <ApiKeyCard mode="live" configured={creds.live.configured} keyIdMasked={creds.live.keyIdMasked} onSaved={refreshStatus} />
          </>}
        </div>
      </section>

      <section>
        <h2 style={h2}>Live Gate</h2>
        <LiveGateChecklist gate={gate} onChange={refreshStatus} />
        <button onClick={async () => { await api.resetLiveGate(); refreshStatus(); }} style={secondaryButton}>
          Reset all consents
        </button>
      </section>

      <section>
        <h2 style={h2}>Adjustable trading settings</h2>
        <div style={card}>
          <Field label="Starting capital ($)" value={config.startingCapital}
            onChange={(v) => change('startingCapital', v)} step="0.01" min="0.01"
            note="Paper-account seed used after Reset Paper Balance. Live equity always comes from Alpaca." />

          <Field label="Risk per trade (% of equity)" value={Number(config.riskPerTrade) * 100}
            onChange={(v) => change('riskPerTrade', v === '' ? '' : Number(v) / 100)} step="0.1" min="0.1" max="100"
            note="Live order sizing. Example: 2 = about 2% of current Alpaca equity per new position." />

          <Field label="Max trades per session" value={config.maxTradesPerSession}
            onChange={(v) => change('maxTradesPerSession', v)} step="1" min="1" max="1000" />

          <Field label="Max trades per market / symbol" value={config.maxTradesPerMarket}
            onChange={(v) => change('maxTradesPerMarket', v)} step="1" min="1" max="1000" />

          <Field label="Paper win-rate target (%)" value={Number(config.winRateTarget) * 100}
            onChange={(v) => change('winRateTarget', v === '' ? '' : Number(v) / 100)} step="0.1" min="0" max="100"
            note="Affects only the legacy simulated-paper generator; it does not force live wins." />

          <Field label="Daily loss halt (%)" value={Number(config.dailyLossLimit) * 100}
            onChange={(v) => change('dailyLossLimit', v === '' ? '' : Number(v) / 100)} step="0.1" min="0.1" max="100" />

          <Field label="Consecutive losses before halt" value={config.consecutiveStopLoss}
            onChange={(v) => change('consecutiveStopLoss', v)} step="1" min="1" max="100" />

          {error && <div style={{ color: '#ff8080', fontSize: 12, marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={save} style={primaryButton}>Save Configuration</button>
            <button onClick={discard} style={secondaryButton}>Discard Changes</button>
            {saveState && <span style={{ alignSelf: 'center', fontSize: 12, color: saveState.startsWith('Saved') ? '#67e8a5' : 'var(--text-secondary)' }}>{saveState}</span>}
          </div>
        </div>
      </section>

      <section>
        <h2 style={h2}>How these settings are used</h2>
        <div style={card}>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li style={li}>Starting capital applies to the paper balance after you reset it.</li>
            <li style={li}>Live Total Assets/equity remains whatever Alpaca reports.</li>
            <li style={li}>Risk per trade controls live position notional as a fraction of Alpaca equity.</li>
            <li style={li}>Trade caps, daily-loss halt and consecutive-loss halt are now read from the saved configuration on the backend.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, note, ...props }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--text-secondary)' }}>{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px',
          borderRadius: 8, border: '1px solid var(--line)',
          background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 14
        }}
      />
      {note && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.35 }}>{note}</div>}
    </label>
  );
}

const h2 = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: '0 0 8px' };
const card = { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' };
const primaryButton = { background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 };
const secondaryButton = { marginTop: 8, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text-secondary)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer' };
const li = { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 };
