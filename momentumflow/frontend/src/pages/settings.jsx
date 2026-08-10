import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function Settings() {
  const [config, setConfig] = useState({
    startingCapital: 100,
    riskPerTrade: 0.02,
    tradesPerSession: 24,
    winRateTarget: 0.875,
    dailyLossLimit: 0.10,
    consecutiveStopLoss: 3,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getTradingConfig().then(cfg => setConfig(prev => ({ ...prev, ...cfg })));
  }, []);

  const handleChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await api.setTradingConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Settings</h1>

      <div style={{ background: '#1e2139', padding: '20px', borderRadius: '8px', border: '1px solid #2a2e4a' }}>
        
        {/* Starting Capital */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Starting Capital
          </label>
          <input
            type="number"
            value={config.startingCapital}
            onChange={(e) => handleChange('startingCapital', Number(e.target.value))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
        </div>

        {/* Risk Per Trade */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Risk Per Trade (% of capital)
          </label>
          <input
            type="number"
            step="0.01"
            value={config.riskPerTrade}
            onChange={(e) => handleChange('riskPerTrade', Number(e.target.value))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Default: 0.02 (2%)</div>
        </div>

        {/* Trades Per Session */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Trades Per Session
          </label>
          <input
            type="number"
            value={config.tradesPerSession}
            onChange={(e) => handleChange('tradesPerSession', Number(e.target.value))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Max trades per session</div>
        </div>

        {/* Win Rate Target */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Win Rate Target (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={config.winRateTarget * 100}
            onChange={(e) => handleChange('winRateTarget', Number(e.target.value) / 100)}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Default: 87.5%</div>
        </div>

        {/* Daily Loss Limit */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Daily Loss Limit (% of capital)
          </label>
          <input
            type="number"
            step="0.01"
            value={config.dailyLossLimit}
            onChange={(e) => handleChange('dailyLossLimit', Number(e.target.value))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Stop trading at this loss (Default: 10%)</div>
        </div>

        {/* Consecutive Stop Loss */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
            Consecutive Losses Before Halt
          </label>
          <input
            type="number"
            value={config.consecutiveStopLoss}
            onChange={(e) => handleChange('consecutiveStopLoss', Number(e.target.value))}
            style={{
              width: '100%',
              padding: '10px',
              background: '#0f1419',
              border: '1px solid #2a2e4a',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Stop after N consecutive losses (Default: 3)</div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          style={{
            width: '100%',
            padding: '12px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            marginTop: '20px',
          }}
        >
          Save Configuration
        </button>

        {saved && (
          <div style={{ color: '#4ade80', marginTop: '10px', textAlign: 'center', fontSize: '14px' }}>
            ✓ Configuration saved
          </div>
        )}
      </div>
    </div>
  );
}
