import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function RejectionLogPanel() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      setLoading(true);
      setError('');

      const data = await api.getRejectionLog(100);

      setEntries(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (err) {
      setError(
        err?.message ||
        'Failed to load rejection log.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function clearLog() {
    if (!window.confirm('Clear rejection log?')) {
      return;
    }

    try {
      await api.clearRejectionLog();
      setEntries([]);
    } catch (err) {
      setError(
        err?.message ||
        'Failed to clear rejection log.'
      );
    }
  }

  useEffect(() => {
    refresh();

    const timer = setInterval(
      refresh,
      15000
    );

    return () => clearInterval(timer);
  }, []);

  return (
    <div style={panel}>
      <div style={header}>
        <div>
          <strong style={title}>
            Strategy Rejection Log
          </strong>

          <div style={subtitle}>
            Records why MomentumFlow rejected potential trades.
          </div>
        </div>

        <div>
          <button
            onClick={refresh}
            style={button}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button
            onClick={clearLog}
            style={clearButton}
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div style={errorStyle}>
          {error}
        </div>
      )}

      {!entries.length && !error && (
        <div style={empty}>
          No rejection data yet.
          Start the PAPER bot and this log will begin filling automatically.
        </div>
      )}

      {entries.map((entry) => {
        const strategyEquity =
          entry
            ?.top_strategy_rejections
            ?.equities
            ?.[0];

        const strategyCrypto =
          entry
            ?.top_strategy_rejections
            ?.crypto
            ?.[0];

        const prefilterEquity =
          entry
            ?.top_prefilter_rejections
            ?.equities
            ?.[0];

        const prefilterCrypto =
          entry
            ?.top_prefilter_rejections
            ?.crypto
            ?.[0];

        const top =
          strategyEquity ||
          strategyCrypto ||
          prefilterEquity ||
          prefilterCrypto;

        const near =
          entry?.near_misses?.[0];

        return (
          <div
            key={entry.id}
            style={row}
          >
            <div style={time}>
              {new Date(
                entry.timestamp
              ).toLocaleString()}
            </div>

            <div>
              <strong>
                {String(
                  entry.mode || ''
                ).toUpperCase()}
              </strong>

              {' · '}

              Qualified setups:{' '}
              {entry.qualified ?? 0}
            </div>

            <div style={reject}>
              Top reject:{' '}
              <strong>
                {top
                  ? `${top.reason} (${top.count})`
                  : 'None'}
              </strong>
            </div>

            {near && (
              <div style={nearMiss}>
                Near miss: {near.symbol}
                {' · '}
                score {near.score}/10
                {' · '}
                {near.reason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const panel = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: 14,
};

const header = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 12,
};

const title = {
  color: '#4ade80',
};

const subtitle = {
  color: '#94a3b8',
  fontSize: 11,
  marginTop: 4,
};

const button = {
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: 7,
  padding: '7px 10px',
  cursor: 'pointer',
};

const clearButton = {
  ...button,
  marginLeft: 6,
  color: '#f87171',
};

const row = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 10,
  marginTop: 8,
  fontSize: 11,
  color: '#cbd5e1',
};

const time = {
  color: '#94a3b8',
  marginBottom: 5,
};

const reject = {
  marginTop: 5,
};

const nearMiss = {
  marginTop: 5,
  color: '#fbbf24',
};

const empty = {
  color: '#94a3b8',
  padding: 10,
};

const errorStyle = {
  color: '#f87171',
  padding: 10,
};
