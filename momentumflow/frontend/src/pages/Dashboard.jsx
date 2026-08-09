import React, { useEffect, useState, useCallback } from 'react';
import StatCard from '../components/StatCard.jsx';
import SessionChart from '../components/SessionChart.jsx';
import StrategyCard from '../components/StrategyCard.jsx';
import MarketGrid from '../components/MarketGrid.jsx';
import BrokerStatus from '../components/BrokerStatus.jsx';
import LiveTradeForm from '../components/LiveTradeForm.jsx';
import { api } from '../lib/api.js';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [lastSessionTrades, setLastSessionTrades] = useState([]);
  const [gate, setGate] = useState(null);
  const [creds, setCreds] = useState(null);
  const [tradingMode, setTradingMode] = useState(null);
  const [config, setConfig] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const [s, g, c, m, cfg] = await Promise.all([
      api.listSessions(), api.getLiveGate(), api.getCredentials(), api.getTradingMode(), api.getTradingConfig(),
    ]);
    setSessions(s);
    setGate(g);
    setCreds(c);
    setTradingMode(m);
    setConfig(cfg);
    if (s[0]) {
      const trades = await api.getSessionTrades(s[0].id);
      setLastSessionTrades(trades);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const seed = config?.startingCapital ?? 100;
  const totalAssets = seed + sessions.reduce((sum, s) => sum + (s.total_pnl || 0), 0);
  const lastSession = sessions[0];
  const mode = tradingMode?.mode ?? 'paper';
  const openLiveSession = sessions.find((s) => s.mode === 'live' && s.status === 'running');

  async function handleRunPaper() {
    setRunning(true);
    setError(null);
    try {
      await api.runPaperSession(seed);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero */}
      <div style={hero}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Total Assets
        </div>
        <div className="mono display" style={{ fontSize: 40, fontWeight: 700, marginTop: 4 }}>
          ${totalAssets.toFixed(2)}
        </div>
        <div style={{ fontSize: 13, color: totalAssets >= seed ? 'var(--signal-up)' : 'var(--signal-down)', marginTop: 4 }}>
          {totalAssets >= seed ? '▲' : '▼'} {(totalAssets - seed).toFixed(2)} since ${seed} seed
        </div>
        <div style={{ marginTop: 16 }}>
          <SessionChart trades={lastSessionTrades} startingCapital={lastSession?.starting_capital ?? seed} />
        </div>
      </div>

      <BrokerStatus
        mode={mode}
        paperConfigured={creds?.paper?.configured}
        liveConfigured={creds?.live?.configured}
        liveUnlocked={gate?.unlocked}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCard label="Last session P&L" value={lastSession ? `$${lastSession.total_pnl}` : '—'} tone={lastSession?.total_pnl >= 0 ? 'up' : 'down'} />
        <StatCard label="Win rate" value={lastSession ? `${lastSession.win_rate}%` : '—'} />
        <StatCard label="Sessions run" value={sessions.length} />
        <StatCard label="Status" value={lastSession?.status ?? '—'} sub={lastSession?.halt_reason} />
      </div>

      <StrategyCard />

      {mode === 'paper' ? (
        <div>
          <button onClick={handleRunPaper} disabled={running} style={runBtn}>
            {running ? 'Running paper session…' : 'Run paper session'}
          </button>
          {error && <div style={{ color: 'var(--signal-down)', fontSize: 12, marginTop: 6 }}>{error}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
            Simulated only — no real capital. Switch to live mode in Settings once the Live Gate is unlocked.
          </div>
        </div>
      ) : (
        <LiveTradeForm sessionId={openLiveSession?.id} onPlaced={refresh} />
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Live market grid</div>
        <MarketGrid />
      </div>
    </div>
  );
}

const hero = {
  background: 'linear-gradient(180deg, var(--bg-raised) 0%, var(--bg) 100%)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '20px 18px',
};

const runBtn = {
  width: '100%',
  padding: '14px',
  borderRadius: 'var(--radius)',
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
