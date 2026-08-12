import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import BrokerStatus from '../components/BrokerStatus.jsx';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [marketData, setMarketData] = useState([]);
  const [paperAccount, setPaperAccount] = useState(null);
  const [accounts, setAccounts] = useState({ paper: null, live: null });
  const [tradingMode, setTradingMode] = useState('paper');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resettingPaper, setResettingPaper] = useState(false);
  const [error, setError] = useState('');
  const [liveBot, setLiveBot] = useState(null);
  const [liveBusy, setLiveBusy] = useState(false);

  async function loadDynamicData() {
    const results = await Promise.allSettled([
      api.listSessions(),
      api.getMarketGrid(),
      api.getPaperAccount(),
      api.getBrokerAccounts(),
      api.getTradingMode(),
      api.getLiveBotStatus(),
    ]);

    const [sr, mr, pr, ar, tr, br] = results;
    if (sr.status === 'fulfilled') setSessions(sr.value || []);
    if (mr.status === 'fulfilled') setMarketData(mr.value || []);
    if (pr.status === 'fulfilled') setPaperAccount(pr.value || null);
    if (ar.status === 'fulfilled') setAccounts(ar.value || { paper: null, live: null });
    if (tr.status === 'fulfilled') setTradingMode(tr.value?.mode || 'paper');
    if (br.status === 'fulfilled') setLiveBot(br.value || null);

    const failures = results.filter((r) => r.status === 'rejected');
    setError(failures.length ? `Some data failed to load: ${failures.map((r) => r.reason?.message || 'request failed').join(' · ')}` : '');
  }

  useEffect(() => {
    loadDynamicData();
    const interval = setInterval(loadDynamicData, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleRunSession() {
    try {
      setLoading(true);
      setError('');
      await api.runPaperSession();
      await loadDynamicData();
    } catch (e) {
      setError(`Failed to run session: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPaperAccount() {
    try {
      const cfg = await api.getTradingConfig();
      const seed = Number(cfg.startingCapital || 100);
      if (!window.confirm(`Reset paper balance to $${seed.toFixed(2)} and start a new cumulative run?`)) return;
      setResettingPaper(true);
      await api.resetPaperAccount(seed);
      await loadDynamicData();
    } catch (e) {
      setError(`Failed to reset paper balance: ${e.message}`);
    } finally {
      setResettingPaper(false);
    }
  }

  async function handleStartLiveBot() {
    try {
      setLiveBusy(true);
      setError('');
      setLiveBot(await api.startLiveBot());
      await loadDynamicData();
    } catch (e) {
      setError(`Live bot not started: ${e.message}`);
    } finally {
      setLiveBusy(false);
    }
  }

  async function handleStopLiveBot() {
    try {
      setLiveBusy(true);
      setError('');
      setLiveBot(await api.stopLiveBot());
      await loadDynamicData();
    } catch (e) {
      setError(`Failed to stop live bot: ${e.message}`);
    } finally {
      setLiveBusy(false);
    }
  }

  const lastSession = sessions[0] || null;
  const paperTotal = Number(paperAccount?.currentCapital ?? paperAccount?.seedCapital ?? 100);
  const liveTotal = Number(accounts?.live?.equity ?? accounts?.live?.portfolioValue ?? 0);
  const totalAssets = tradingMode === 'live' && accounts?.live?.connected ? liveTotal : paperTotal;
  const lastPnl = Number(lastSession?.total_pnl ?? lastSession?.pnl ?? 0);
  const wins = Number(lastSession?.wins ?? lastSession?.win_count ?? 0);
  const losses = Number(lastSession?.losses ?? lastSession?.loss_count ?? 0);
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '—';
  const sessionsRun = tradingMode === 'paper'
    ? Number(paperAccount?.sessionsSinceReset ?? 0)
    : sessions.filter((s) => s.mode === 'live').length;

  const topCandidates = liveBot?.topCandidates || [];
  const universe = liveBot?.universe || {};

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h1>MomentumFlow</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15, marginBottom: 22 }}>
        <Stat label={tradingMode === 'live' ? 'LIVE ALPACA EQUITY' : 'TOTAL PAPER ASSETS'} value={`$${Number(totalAssets || 0).toFixed(2)}`} />
        <Stat label="LAST SESSION P&L" value={`${lastPnl >= 0 ? '+' : ''}$${lastPnl.toFixed(2)}`} valueColor={lastPnl >= 0 ? '#4ade80' : '#f87171'} />
        <Stat label="LAST SESSION WIN RATE" value={winRate === '—' ? '—' : `${winRate}%`} />
        <Stat label={tradingMode === 'paper' ? 'SESSIONS SINCE RESET' : 'LIVE SESSIONS'} value={String(sessionsRun)} />
      </div>

      <div style={{ marginBottom: 22 }}>
        <BrokerStatus mode={tradingMode} accounts={accounts} />
      </div>

      <button onClick={() => setShowSettings((v) => !v)} style={toggleButton}>
        {showSettings ? '▼ Hide Settings' : '▶ Show Settings'}
      </button>

      {showSettings && (
        <div style={panel}>
          <h3 style={{ marginTop: 0, color: '#ccc' }}>Trading Configuration</h3>
          <TradingConfigPanel compact />
          <button onClick={handleResetPaperAccount} disabled={resettingPaper} style={resetButton}>
            {resettingPaper ? 'Resetting…' : 'Reset Paper Balance'}
          </button>
        </div>
      )}

      <div style={panel}>
        <h3 style={{ margin: '0 0 10px', color: '#4ade80', fontSize: 14 }}>TREND-ALIGNED MOMENTUM</h3>
        <p style={{ margin: 0, color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>
          Automated live scanning covers Alpaca active tradable equities/ETFs plus crypto. Risk Per Trade controls live entry size as a percentage of current Alpaca live equity; there is no fixed $5 entry cap.
        </p>
      </div>

      <button onClick={handleRunSession} disabled={loading} style={{ ...runButton, opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Running…' : 'Run paper session'}
      </button>

      {error && <div style={{ color: '#f87171', marginBottom: 20, fontSize: 13 }}>{error}</div>}

      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: liveBot?.running ? '#4ade80' : '#fff' }}>Automated Live Bot — Alpaca Equities/ETFs + Crypto</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
              Scans the supported Alpaca tradable universe every {liveBot?.config?.pollSeconds ?? 5}s and waits for a qualifying momentum signal.
            </div>
          </div>
          <div style={{ fontSize: 12, color: liveBot?.running ? '#4ade80' : '#888' }}>{liveBot?.running ? 'RUNNING' : 'STOPPED'}</div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: '#cbd5e1' }}>
          {liveBot?.lastDecision || 'Waiting for bot status…'}
        </div>
        {liveBot?.lastError && <div style={{ marginTop: 7, color: '#f87171', fontSize: 12 }}>{liveBot.lastError}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: '#888' }}>
          <span>Universe: {Number(universe.totalCount || 0).toLocaleString()}</span>
          <span>Equities/ETFs: {Number(universe.equityCount || 0).toLocaleString()}</span>
          <span>Crypto: {Number(universe.cryptoCount || 0).toLocaleString()}</span>
          <span>US market: {liveBot?.marketOpen == null ? 'unknown' : liveBot.marketOpen ? 'OPEN' : 'CLOSED'}</span>
          <span>Risk/trade: {liveBot?.config?.riskPerTrade != null ? `${(Number(liveBot.config.riskPerTrade) * 100).toFixed(2)}%` : '—'}</span>
        </div>

        {topCandidates.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
            Top signals: {topCandidates.slice(0, 5).map((c) => `${c.symbol} ${Number(c.momentumPct).toFixed(3)}%`).join(' · ')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={handleStartLiveBot} disabled={liveBusy || liveBot?.running} style={{ ...liveStartButton, opacity: liveBusy || liveBot?.running ? 0.5 : 1 }}>
            {liveBusy ? 'Please wait…' : 'Start Live Bot'}
          </button>
          <button onClick={handleStopLiveBot} disabled={liveBusy || !liveBot?.running} style={{ ...liveStopButton, opacity: liveBusy || !liveBot?.running ? 0.5 : 1 }}>
            Stop Live Bot
          </button>
        </div>
      </div>

      <h3 style={{ color: '#ccc', marginBottom: 15, marginTop: 30 }}>Market grid</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 15 }}>
        {marketData.map((market) => (
          <div key={market.market} style={marketCell}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>{market.market}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
              ${Number.isFinite(Number(market.price)) ? Number(market.price).toFixed(2) : 'N/A'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{market.source || 'market data'}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, fontSize: 10, color: '#64748b' }}>MOMENTUMFLOW UI v8</div>
    </div>
  );
}

function Stat({ label, value, valueColor = '#fff' }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: valueColor }}>{value}</div>
    </div>
  );
}

const statCard = { background: '#1e2139', padding: 20, borderRadius: 8, border: '1px solid #2a2e4a' };
const panel = { background: '#1e2139', padding: 20, borderRadius: 8, border: '1px solid #2a2e4a', marginBottom: 22 };
const toggleButton = { padding: '10px 15px', background: '#1e2139', color: '#3b82f6', border: '1px solid #2a2e4a', borderRadius: 4, cursor: 'pointer', marginBottom: 20, fontSize: 14 };
const resetButton = { marginTop: 14, padding: '9px 14px', background: '#7f1d1d', color: '#fff', border: '1px solid #991b1b', borderRadius: 6, cursor: 'pointer' };
const runButton = { width: '100%', padding: 16, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', marginBottom: 20 };
const liveStartButton = { flex: 1, padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' };
const liveStopButton = { flex: 1, padding: 12, background: '#111827', color: '#fff', border: '1px solid #4b5563', borderRadius: 6, fontWeight: 700, cursor: 'pointer' };
const marketCell = { background: '#1e2139', padding: 15, borderRadius: 8, border: '1px solid #2a2e4a' };
