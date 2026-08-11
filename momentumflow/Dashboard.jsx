import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [marketData, setMarketData] = useState([]);
  const [config, setConfig] = useState({
    startingCapital: 100,
    riskPerTrade: 0.02,
    tradesPerSession: 24,
    tradesPerMarket: 12,
    winRateTarget: 0.875,
    dailyLossLimit: 0.10,
    consecutiveStopLoss: 3,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [liveBot, setLiveBot] = useState(null);
  const [paperAccount, setPaperAccount] = useState(null);
  const [tradingMode, setTradingMode] = useState('paper');
  const [brokerAccounts, setBrokerAccounts] = useState({ paper: null, live: null });
  const [resettingPaper, setResettingPaper] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    const results = await Promise.allSettled([api.getTradingConfig(),api.listSessions(),api.getPaperAccount(),api.getTradingMode(),api.getBrokerAccounts(),api.getMarketGrid(),api.getLiveBotStatus()]);
    const [cfg,sr,pr,mr,ar,gr,br]=results;
    if(cfg.status==='fulfilled') setConfig(prev=>({...prev,...cfg.value}));
    if(sr.status==='fulfilled') setSessions(sr.value||[]);
    if(pr.status==='fulfilled') setPaperAccount(pr.value);
    if(mr.status==='fulfilled') setTradingMode(mr.value?.mode||'paper');
    if(ar.status==='fulfilled') setBrokerAccounts(ar.value||{paper:null,live:null});
    if(gr.status==='fulfilled') setMarketData(gr.value||[]);
    if(br.status==='fulfilled') setLiveBot(br.value);
    const bad=results.filter(r=>r.status==='rejected');
    setError(bad.length?`Some data failed to load: ${bad.map(x=>x.reason?.message||'request failed').join(' · ')}`:'');
  };

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveConfig = async () => {
    try {
      await api.setTradingConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError('Failed to save config');
    }
  };

  const handleRunSession = async () => {
    try {
      setLoading(true);
      setError('');
      await api.runPaperSession();
      await loadData();
    } catch (err) {
      setError(`Failed to run session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };


  const handleResetPaperAccount = async () => {
    const confirmed = window.confirm(`Reset the simulated paper balance to $${Number(config.startingCapital).toFixed(2)}? This starts a new cumulative run.`);
    if (!confirmed) return;
    try {
      setResettingPaper(true);
      setError('');
      const account = await api.resetPaperAccount(config.startingCapital);
      setPaperAccount(account);
      await loadData();
    } catch (err) {
      setError(`Failed to reset paper balance: ${err.message}`);
    } finally {
      setResettingPaper(false);
    }
  };

  const handleStartLiveBot = async () => {
    try {
      setLiveBusy(true);
      setError('');
      const status = await api.startLiveBot();
      setLiveBot(status);
      await loadData();
    } catch (err) {
      setError(`Live bot not started: ${err.message}`);
    } finally {
      setLiveBusy(false);
    }
  };

  const handleStopLiveBot = async () => {
    try {
      setLiveBusy(true);
      const status = await api.stopLiveBot();
      setLiveBot(status);
      await loadData();
    } catch (err) {
      setError(`Failed to stop live bot: ${err.message}`);
    } finally {
      setLiveBusy(false);
    }
  };

  const lastSession = sessions.find((session) => session.mode === 'paper');
  const seedCapital = Number(paperAccount?.seedCapital ?? config.startingCapital ?? 100);
  const simulatedPaperAssets = Number(paperAccount?.currentCapital ?? seedCapital);
  const simulatedPaperPnl = Number(paperAccount?.cumulativePnl ?? (simulatedPaperAssets - seedCapital));
  const liveAccount = brokerAccounts?.live;
  const liveConnected = Boolean(liveAccount?.connected);
  const paperBrokerConnected = Boolean(brokerAccounts?.paper?.connected);
  const isLiveMode = tradingMode === 'live';
  // In LIVE mode the dashboard is broker-authoritative: Alpaca equity is the source of truth.
  // In PAPER mode this app continues to show the resettable compounded simulator balance.
  const totalAssets = isLiveMode && liveConnected
    ? Number(liveAccount.equity ?? liveAccount.portfolioValue ?? 0)
    : simulatedPaperAssets;
  const cumulativePnl = isLiveMode && liveConnected
    ? Number(totalAssets - Number(liveAccount.lastEquity || totalAssets))
    : simulatedPaperPnl;
  const pnl = lastSession ? Number(lastSession.total_pnl ?? lastSession.pnl ?? 0) : 0;
  const wins = Number(lastSession?.wins ?? lastSession?.win_count ?? 0);
  const losses = Number(lastSession?.losses ?? lastSession?.loss_count ?? 0);
  const winRate = (wins + losses > 0) ? ((wins / (wins + losses)) * 100).toFixed(1) : '-';
  const sessionsSinceReset = Number(paperAccount?.sessionsSinceReset ?? 0);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>MomentumFlow</h1>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '30px' }}>
        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>{isLiveMode ? 'LIVE ALPACA EQUITY' : 'TOTAL ASSETS'}</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>${totalAssets.toFixed(2)}</div>
          <div style={{ fontSize: '11px', color: pnl >= 0 ? '#4ade80' : '#f87171', marginTop: '5px' }}>
            {isLiveMode && liveConnected
              ? `${cumulativePnl >= 0 ? '+' : ''}${cumulativePnl.toFixed(2)} vs Alpaca previous equity · BP $${Number(liveAccount.buyingPower || 0).toFixed(2)}`
              : `${cumulativePnl >= 0 ? '+' : ''}${cumulativePnl.toFixed(2)} since $${seedCapital.toFixed(2)} reset`}
          </div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>LAST SESSION P&L</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: lastSession?.pnl >= 0 ? '#4ade80' : '#f87171' }}>
            {lastSession ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '-'}
          </div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>WIN RATE</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{winRate}%</div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>SESSIONS RUN</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{sessionsSinceReset}</div>
        </div>
      </div>

      {/* Broker Status */}
      <div style={{ background: '#1e2139', padding: '15px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', background: (paperBrokerConnected || liveConnected) ? '#4ade80' : '#f87171', borderRadius: '50%' }}></div>
          <span style={{ fontSize: '14px', color: '#ccc' }}>
            Alpaca paper: {paperBrokerConnected ? 'connected' : 'not connected'} · live: {liveConnected ? 'connected' : 'not connected'}
            {isLiveMode && liveConnected ? ` · live equity $${Number(liveAccount.equity || 0).toFixed(2)} · cash $${Number(liveAccount.cash || 0).toFixed(2)}` : ''}
            {!paperBrokerConnected && brokerAccounts?.paper?.error ? ` · paper error: ${brokerAccounts.paper.error}` : ''}
            {!liveConnected && brokerAccounts?.live?.error ? ` · live error: ${brokerAccounts.live.error}` : ''}
          </span>
        </div>
      </div>

      {/* Settings Toggle */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        style={{
          padding: '10px 15px',
          background: '#1e2139',
          color: '#3b82f6',
          border: '1px solid #2a2e4a',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '20px',
          fontSize: '14px',
        }}
      >
        {showSettings ? '▼ Hide Settings' : '▶ Show Settings'}
      </button>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '30px' }}>
          <h3 style={{ marginTop: '0', color: '#ccc' }}>Trading Configuration</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Starting Capital */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Starting Capital
              </label>
              <input
                type="number"
                value={config.startingCapital}
                onChange={(e) => handleConfigChange('startingCapital', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Risk Per Trade */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={config.riskPerTrade}
                onChange={(e) => handleConfigChange('riskPerTrade', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Trades Per Session */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Trades Per Session
              </label>
              <input
                type="number"
                value={config.tradesPerSession}
                onChange={(e) => handleConfigChange('tradesPerSession', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Trades Per Market */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Max Trades Per Market
              </label>
              <input
                type="number"
                value={config.tradesPerMarket}
                onChange={(e) => handleConfigChange('tradesPerMarket', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Win Rate Target */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Win Rate Target (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={config.winRateTarget * 100}
                onChange={(e) => handleConfigChange('winRateTarget', Number(e.target.value) / 100)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Daily Loss Limit */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Daily Loss Limit (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={config.dailyLossLimit}
                onChange={(e) => handleConfigChange('dailyLossLimit', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>

            {/* Consecutive Stop Loss */}
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#888', fontSize: '12px' }}>
                Consecutive Losses Before Halt
              </label>
              <input
                type="number"
                value={config.consecutiveStopLoss}
                onChange={(e) => handleConfigChange('consecutiveStopLoss', Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#0f1419',
                  border: '1px solid #2a2e4a',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            style={{
              marginTop: '15px',
              padding: '10px 20px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Save Configuration
          </button>

          {saved && <span style={{ marginLeft: '10px', color: '#4ade80' }}>✓ Saved</span>}


          <button
            onClick={handleResetPaperAccount}
            disabled={resettingPaper}
            style={{
              marginTop: '15px',
              marginLeft: '10px',
              padding: '10px 20px',
              background: '#7f1d1d',
              color: 'white',
              border: '1px solid #991b1b',
              borderRadius: '4px',
              cursor: resettingPaper ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: resettingPaper ? 0.6 : 1,
            }}
          >
            {resettingPaper ? 'Resetting…' : 'Reset Paper Balance'}
          </button>
        </div>
      )}

      {/* Strategy Info */}
      <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '30px' }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#4ade80', fontSize: '14px' }}>TREND-ALIGNED MOMENTUM</h3>
        <p style={{ margin: '0 0 15px 0', color: '#aaa', fontSize: '13px' }}>
          Sizes positions by conviction tier and trades across crypto and equity momentum names. Every session runs paper-first with hard safety halts.
        </p>
      </div>

      {/* Run Button */}
      <button
        onClick={handleRunSession}
        disabled={loading}
        style={{
          width: '100%',
          padding: '16px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          marginBottom: '20px',
        }}
      >
        {loading ? 'Running...' : 'Run paper session'}
      </button>

      {error && <div style={{ color: '#f87171', marginBottom: '20px', fontSize: '14px' }}>{error}</div>}

      {/* Live Bot */}
      <div style={{ background: '#1e2139', padding: '18px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 'bold', color: liveBot?.running ? '#4ade80' : '#fff' }}>Automated Live Bot</div>
            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
              Scans Alpaca's active tradable US equities/ETFs plus crypto. Requires Live Mode, completed Live Gate, server enable flag, and live Alpaca keys.
            </div>
          </div>
          <div style={{ fontSize: '12px', color: liveBot?.running ? '#4ade80' : '#888' }}>
            {liveBot?.running ? 'RUNNING' : 'STOPPED'}
          </div>
        </div>
        {liveBot?.lastError && <div style={{ marginTop: '8px', color: '#f87171', fontSize: '12px' }}>{liveBot.lastError}</div>}
        {liveBot?.running && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#0f1419', borderRadius: '6px', fontSize: '12px', color: '#bbb' }}>
            <div><strong>Scanner:</strong> every {liveBot?.config?.pollSeconds ?? 5}s · {liveBot?.lastDecision || 'starting'}</div>
            <div style={{ marginTop: '5px' }}>Universe: {Number(liveBot?.universe?.totalCount || 0).toLocaleString()} tradable assets ({Number(liveBot?.universe?.equityCount || 0).toLocaleString()} equities/ETFs + {Number(liveBot?.universe?.cryptoCount || 0).toLocaleString()} crypto) · US market {liveBot?.marketOpen == null ? 'checking' : liveBot.marketOpen ? 'OPEN' : 'CLOSED'}</div>
            {Array.isArray(liveBot?.topCandidates) && liveBot.topCandidates.length > 0 && (<div style={{ marginTop: '7px' }}><strong>Top signals:</strong> {liveBot.topCandidates.slice(0,5).map(c => `${c.symbol} ${Number(c.momentumPct).toFixed(3)}%`).join(' · ')}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
          <button
            onClick={handleStartLiveBot}
            disabled={liveBusy || liveBot?.running}
            style={{ flex: 1, padding: '12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', opacity: liveBusy || liveBot?.running ? 0.5 : 1 }}
          >
            {liveBusy ? 'Please wait…' : 'Start Live Bot'}
          </button>
          <button
            onClick={handleStopLiveBot}
            disabled={liveBusy || !liveBot?.running}
            style={{ flex: 1, padding: '12px', background: '#111827', color: '#fff', border: '1px solid #4b5563', borderRadius: '6px', fontWeight: 'bold', opacity: liveBusy || !liveBot?.running ? 0.5 : 1 }}
          >
            Stop Live Bot
          </button>
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: '#888' }}>
          Live scanner checks every 5 seconds, rotates through the full Alpaca tradable universe, and only places an order when a qualifying momentum signal appears. Default live size is capped at $5 per entry.
        </div>
      </div>

      {/* Market Grid */}
      <h3 style={{ color: '#ccc', marginBottom: '15px', marginTop: '30px' }}>Live market grid</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
        {marketData.map(market => (
          <div
            key={market.market}
            style={{
              background: '#1e2139',
              padding: '15px',
              borderRadius: '8px',
              border: '1px solid #2a2e4a',
            }}
          >
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>{market.market}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', marginBottom: '5px' }}>
              ${Number.isFinite(Number(market.price)) ? Number(market.price).toFixed(2) : 'N/A'}
            </div>
            <div style={{ fontSize: '11px', color: market.change >= 0 ? '#4ade80' : '#f87171' }}>
              {Number.isFinite(Number(market.change)) ? `${Number(market.change) >= 0 ? '+' : ''}${Number(market.change).toFixed(2)}%` : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
    
    
