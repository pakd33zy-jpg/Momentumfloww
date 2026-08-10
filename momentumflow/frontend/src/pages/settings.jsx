import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function Settings() {
  const [startingCapital, setStartingCapital] = useState(100);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getTradingConfig().then(cfg => setStartingCapital(cfg.startingCapital));
  }, []);

  const handleSave = async () => {
    await api.setTradingConfig(startingCapital);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Settings</h1>
      <div style={{ marginBottom: '20px' }}>
        <label>Starting Capital: </label>
        <input
          type="number"
          value={startingCapital}
          onChange={(e) => setStartingCapital(Number(e.target.value))}
          style={{ padding: '8px', marginLeft: '10px', width: '150px' }}
        />
        <button
          onClick={handleSave}
          style={{
            padding: '8px 16px',
            marginLeft: '10px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
        {saved && <span style={{ marginLeft: '10px', color: 'green' }}>✓ Saved</span>}
      </div>
    </div>
  );
}
