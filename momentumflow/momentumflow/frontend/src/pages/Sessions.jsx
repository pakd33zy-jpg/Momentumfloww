import React, { useEffect, useState } from 'react';
import SessionChart from '../components/SessionChart.jsx';
import { api } from '../lib/api.js';

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [trades, setTrades] = useState({});

  useEffect(() => {
    api.listSessions().then(setSessions);
  }, []);

  async function toggle(id) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!trades[id]) {
      const t = await api.getSessionTrades(id);
      setTrades((prev) => ({ ...prev, [id]: t }));
    }
  }

  if (sessions.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No sessions yet. Run a paper session from the Dashboard.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sessions.map((s) => (
        <div key={s.id} style={card}>
          <button onClick={() => toggle(s.id)} style={rowBtn}>
            <div>
              <span className="mono" style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: s.mode === 'live' ? 'rgba(255,59,92,0.15)' : 'rgba(76,141,255,0.15)', color: s.mode === 'live' ? 'var(--signal-live)' : 'var(--accent)' }}>
                {s.mode.toUpperCase()}
              </span>
              <div style={{ fontSize: 13, marginTop: 6 }}>{new Date(s.created_at).toLocaleString()}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                {s.trades} trades · {s.win_rate}% win rate · {s.status}
              </div>
            </div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: s.total_pnl >= 0 ? 'var(--signal-up)' : 'var(--signal-down)' }}>
              {s.total_pnl >= 0 ? '+' : ''}{s.total_pnl}
            </div>
          </button>

          {expanded === s.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <SessionChart trades={trades[s.id] || []} startingCapital={s.starting_capital} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {(trades[s.id] || []).map((t) => (
                  <div key={t.id} style={tradeRow}>
                    <span className="mono" style={{ width: 46 }}>{t.market}</span>
                    <span style={{ color: t.direction === 'LONG' ? 'var(--signal-up)' : 'var(--signal-down)', width: 52 }}>{t.direction}</span>
                    <span style={{ color: 'var(--text-dim)', flex: 1 }}>{t.conviction}</span>
                    <span className="mono" style={{ color: (t.pnl ?? 0) >= 0 ? 'var(--signal-up)' : 'var(--signal-down)' }}>
                      {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl}` : 'open'}
                    </span>
                  </div>
                ))}
                {s.halt_reason && (
                  <div style={{ fontSize: 12, color: 'var(--signal-armed)', marginTop: 6 }}>Halted: {s.halt_reason}</div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
};

const rowBtn = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left',
};

const tradeRow = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 12,
  padding: '4px 0',
};
