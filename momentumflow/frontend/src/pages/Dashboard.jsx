import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [marketData, setMarketData] = useState([]);
  const [startingCapital, setStartingCapital] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const config = await api.getTradingConfig();
      setStartingCapital(config.startingCapital);
      
      const sessionsData = await api.listSessions();
      setSessions(sessionsData);
      
      const marketGrid = await api.getMarketGrid();
      setMarketData(marketGrid);
      setError('');
    } catch (err) {
      setError('Failed to load data');
    }
  };

  const handleRunSession = async () => {
    try {
      setLoading(true);
      setError('');
      const config = await api.getTradingConfig();
      await api.runPaperSession(config.startingCapital);
      await loadData();
    } catch (err) {
      setError(`Failed to run session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const lastSession = sessions[0];
  const totalAssets = lastSession ? lastSession.current_capital : startingCapital;
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

      {/* Strategy Info */}
      <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a', marginBottom: '30px' }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#4ade80', fontSize: '14px' }}>TREND-ALIGNED MOMENTUM</h3>
        <p style={{ margin: '0 0 15px 0', color: '#aaa', fontSize: '13px' }}>
          Sizes positions by conviction tier and trades across crypto and equity momentum names. Every session runs paper-first with hard safety halts.
        </p>
        <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: '#888' }}>
          <span>Probe <span style={{ color: '#60a5fa' }}>0.5x</span></span>
          <span>Standard <span style={{ color: '#60a5fa' }}>1.0x</span></span>
          <span>High <span style={{ color: '#60a5fa' }}>1.25x</span></span>
        </div>
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
    
    
