<import { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const cfg = await api.getTradingConfig();
      setConfig(prev => ({ ...prev, ...cfg }));
      
      const sessionsData = await api.listSessions();
      setSessions(sessionsData);
      
      const marketGrid = await api.getMarketGrid();
      setMarketData(marketGrid);
      setError('');
    } catch (err) {
      setError('Failed to load data');
    }
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
      await api.runPaperSession(config.startingCapital);
      await loadData();
    } catch (err) {
      setError(`Failed to run session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const lastSession = sessions[0];
  const totalAssets = lastSession ? lastSession.current_capital : config.startingCapital;
  const pnl = lastSession ? lastSession.pnl : 0;
  const winRate = lastSession && (lastSession.win_count + lastSession.loss_count > 0)
    ? ((lastSession.win_count / (lastSession.win_count + lastSession.loss_count)) * 100).toFixed(1)
    : '-';

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>MomentumFlow</h1>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '30px' }}>
        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>TOTAL ASSETS</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>${totalAssets.toFixed(2)}</div>
          <div style={{ fontSize: '11px', color: pnl >= 0 ? '#4ade80' : '#f87171', marginTop: '5px' }}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} since $100 seed
          </div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>LAST SESSION P&L</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: lastSession?.pnl >= 0 ? '#4ade80' : '#f87171' }}>
            {lastSession ? (lastSession.pnl >= 0 ? '+' : '') + lastSession.pnl.toFixed(2) : '-'}
          </div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>WIN RATE</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{winRate}%</div>
        </div>

        <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>SESSIONS RUN</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{sessions.length}</div>
        </div>
      </div>

      {/* Broker Status */}
      <div style={{ background: '#1e2139', padding: '15px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%' }}></div>
          <span style={{ fontSize: '14px', color: '#ccc' }}>Alpaca paper: not connected · live: not connected</span>
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
              ${market.price?.toFixed(2) || 'N/A'}
            </div>
            <div style={{ fontSize: '11px', color: market.change >= 0 ? '#4ade80' : '#f87171' }}>
              {market.change >= 0 ? '+' : ''}{market.change?.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
    
    
