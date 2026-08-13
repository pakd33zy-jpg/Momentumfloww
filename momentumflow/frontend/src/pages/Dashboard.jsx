import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import TradingConfigPanel from '../components/TradingConfigPanel.jsx';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [marketData, setMarketData] = useState([]);
  const [liveBot, setLiveBot] = useState(null);
  const [brokerAccounts, setBrokerAccounts] = useState({
    paper: null,
    live: null,
  });
  const [paperAccount, setPaperAccount] = useState(null);
  const [tradingMode, setTradingMode] = useState('paper');

  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    refreshDashboard();

    const interval = setInterval(() => {
      refreshDashboard();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  async function refreshDashboard() {
    const results = await Promise.allSettled([
      api.listSessions(),
      api.getMarketGrid(),
      api.getLiveBotStatus(),
      api.getBrokerAccounts(),
      api.getPaperAccount(),
      api.getTradingMode(),
    ]);

    if (results[0].status === 'fulfilled') {
      setSessions(
        Array.isArray(results[0].value)
          ? results[0].value
          : []
      );
    }

    if (results[1].status === 'fulfilled') {
      setMarketData(
        Array.isArray(results[1].value)
          ? results[1].value
          : []
      );
    }

    if (results[2].status === 'fulfilled') {
      setLiveBot(results[2].value);
    }

    if (results[3].status === 'fulfilled') {
      setBrokerAccounts(
        results[3].value || {
          paper: null,
          live: null,
        }
      );
    }

    if (results[4].status === 'fulfilled') {
      setPaperAccount(results[4].value);
    }

    if (results[5].status === 'fulfilled') {
      setTradingMode(
        results[5].value?.mode || 'paper'
      );
    }

    const failures = results.filter(
      (result) => result.status === 'rejected'
    );

    if (failures.length === 0) {
      setError('');
    }
  }

  async function handleRunSession() {
    try {
      setLoading(true);
      setError('');

      await api.runPaperSession();
      await refreshDashboard();
    } catch (err) {
      setError(
        `Failed to run paper session: ${err.message}`
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleStartLiveBot() {
    try {
      setLiveBusy(true);
      setError('');

      const status = await api.startLiveBot();
      setLiveBot(status);

      await refreshDashboard();
    } catch (err) {
      setError(
        `Live bot not started: ${err.message}`
      );
    } finally {
      setLiveBusy(false);
    }
  }

  async function handleStopLiveBot() {
    try {
      setLiveBusy(true);
      setError('');

      const status = await api.stopLiveBot();
      setLiveBot(status);

      await refreshDashboard();
    } catch (err) {
      setError(
        `Failed to stop live bot: ${err.message}`
      );
    } finally {
      setLiveBusy(false);
    }
  }

  const paperConnected =
    brokerAccounts?.paper?.connected === true;

  const liveConnected =
    brokerAccounts?.live?.connected === true;

  const activeConnected =
    tradingMode === 'live'
      ? liveConnected
      : paperConnected;

  const lastSession = sessions[0];

  const lastPnl = Number(
    lastSession?.total_pnl ??
    lastSession?.pnl ??
    0
  );

  const wins = Number(
    lastSession?.wins ??
    lastSession?.win_count ??
    0
  );

  const losses = Number(
    lastSession?.losses ??
    lastSession?.loss_count ??
    0
  );

  const winRate =
    wins + losses > 0
      ? ((wins / (wins + losses)) * 100).toFixed(1)
      : '-';

  const paperAssets = Number(
    paperAccount?.currentCapital ??
    paperAccount?.current_capital ??
    paperAccount?.seedCapital ??
    100
  );

  const liveAssets = Number(
    brokerAccounts?.live?.equity ??
    brokerAccounts?.live?.portfolioValue ??
    brokerAccounts?.live?.portfolio_value ??
    0
  );

  const totalAssets =
    tradingMode === 'live' && liveConnected
      ? liveAssets
      : paperAssets;

  const sessionCount =
    paperAccount?.sessionsSinceReset != null
      ? Number(paperAccount.sessionsSinceReset)
      : sessions.length;

  return (
    <div
      style={{
        padding: '20px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <h1 style={{ margin: 0 }}>
          MomentumFlow
        </h1>

        <span
          style={{
            color: '#60a5fa',
            fontSize: '11px',
            fontWeight: 'bold',
          }}
        >
          MOMENTUMFLOW UI v10
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '15px',
          marginBottom: '25px',
        }}
      >
        <StatCard
          label={
            tradingMode === 'live'
              ? 'LIVE ALPACA EQUITY'
              : 'PAPER TOTAL ASSETS'
          }
          value={`$${Number(totalAssets || 0).toFixed(2)}`}
        />

        <StatCard
          label="LAST SESSION P&L"
          value={
            lastSession
              ? `${lastPnl >= 0 ? '+' : ''}$${lastPnl.toFixed(2)}`
              : '-'
          }
          valueColor={
            lastPnl >= 0
              ? '#4ade80'
              : '#f87171'
          }
        />

        <StatCard
          label="WIN RATE"
          value={
            winRate === '-'
              ? '-'
              : `${winRate}%`
          }
        />

        <StatCard
          label="SESSIONS SINCE RESET"
          value={String(sessionCount)}
        />
      </div>

      <div
        style={{
          background: '#1e2139',
          padding: '15px',
          borderRadius: '8px',
          border: '1px solid #2a2e4a',
          marginBottom: '25px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              background: activeConnected
                ? '#4ade80'
                : '#f87171',
              borderRadius: '50%',
              flexShrink: 0,
            }}
          />

          <div>
            <div
              style={{
                color: activeConnected
                  ? '#4ade80'
                  : '#f87171',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              {activeConnected
                ? 'ALPACA CONNECTED'
                : 'ALPACA NOT CONNECTED'}
            </div>

            <div
              style={{
                color: '#aaa',
                fontSize: '12px',
                marginTop: '3px',
              }}
            >
              Paper:{' '}
              {paperConnected
                ? 'connected'
                : 'not connected'}
              {' · '}
              Live:{' '}
              {liveConnected
                ? 'connected'
                : 'not connected'}
              {' · '}
              Active mode: {tradingMode}
            </div>

            {!paperConnected &&
              brokerAccounts?.paper?.error && (
                <div
                  style={{
                    color: '#fbbf24',
                    fontSize: '11px',
                    marginTop: '4px',
                  }}
                >
                  Paper: {brokerAccounts.paper.error}
                </div>
              )}

            {!liveConnected &&
              brokerAccounts?.live?.error && (
                <div
                  style={{
                    color: '#fbbf24',
                    fontSize: '11px',
                    marginTop: '4px',
                  }}
                >
                  Live: {brokerAccounts.live.error}
                </div>
              )}
          </div>
        </div>
      </div>

      <button
        onClick={() =>
          setShowSettings((current) => !current)
        }
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
        {showSettings
          ? '▼ Hide Settings'
          : '▶ Show Settings'}
      </button>

      {showSettings && (
        <div
          style={{
            background: '#1e2139',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #2a2e4a',
            marginBottom: '25px',
          }}
        >
          <h3
            style={{
              marginTop: 0,
              color: '#ccc',
            }}
          >
            Trading Configuration
          </h3>

          <TradingConfigPanel compact />
        </div>
      )}

      <div
        style={{
          background: '#1e2139',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid #2a2e4a',
          marginBottom: '25px',
        }}
      >
        <h3
          style={{
            margin: '0 0 10px',
            color: '#4ade80',
            fontSize: '14px',
          }}
        >
          TREND-ALIGNED MOMENTUM
        </h3>

        <p
          style={{
            margin: 0,
            color: '#aaa',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          Scans supported Alpaca tradable
          equities/ETFs and crypto. Live entry
          size uses the existing Risk Per Trade
          percentage of current Alpaca live
          equity, limited by available buying
          power.
        </p>
      </div>

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
          cursor: loading
            ? 'not-allowed'
            : 'pointer',
          opacity: loading ? 0.7 : 1,
          marginBottom: '20px',
        }}
      >
        {loading
          ? 'Running...'
          : 'Run paper session'}
      </button>

      {error && (
        <div
          style={{
            color: '#f87171',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background: '#1e2139',
          padding: '18px',
          borderRadius: '8px',
          border: '1px solid #2a2e4a',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 'bold',
                color: liveBot?.running
                  ? '#4ade80'
                  : '#fff',
              }}
            >
              Automated Live Bot
            </div>

            <div
              style={{
                fontSize: '12px',
                color: '#aaa',
                marginTop: '4px',
              }}
            >
              Alpaca equities/ETFs + crypto.
              Requires Live Mode, completed Live
              Gate, server enable flag, and
              verified live Alpaca credentials.
            </div>
          </div>

          <div
            style={{
              fontSize: '12px',
              color: liveBot?.running
                ? '#4ade80'
                : '#888',
            }}
          >
            {liveBot?.running
              ? 'RUNNING'
              : 'STOPPED'}
          </div>
        </div>

        {liveBot?.lastError && (
          <div
            style={{
              marginTop: '8px',
              color: '#f87171',
              fontSize: '12px',
            }}
          >
            {liveBot.lastError}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '14px',
          }}
        >
          <button
            onClick={handleStartLiveBot}
            disabled={
              liveBusy || liveBot?.running
            }
            style={{
              flex: 1,
              padding: '12px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              opacity:
                liveBusy || liveBot?.running
                  ? 0.5
                  : 1,
            }}
          >
            {liveBusy
              ? 'Please wait…'
              : 'Start Live Bot'}
          </button>

          <button
            onClick={handleStopLiveBot}
            disabled={
              liveBusy || !liveBot?.running
            }
            style={{
              flex: 1,
              padding: '12px',
              background: '#111827',
              color: '#fff',
              border: '1px solid #4b5563',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              opacity:
                liveBusy || !liveBot?.running
                  ? 0.5
                  : 1,
            }}
          >
            Stop Live Bot
          </button>
        </div>

        <div
          style={{
            marginTop: '10px',
            fontSize: '11px',
            color: '#888',
          }}
        >
          Position size is controlled by Risk Per
          Trade. There is no fixed $5 entry cap.
        </div>
      </div>

      <h3
        style={{
          color: '#ccc',
          marginBottom: '15px',
          marginTop: '30px',
        }}
      >
        Live market grid
      </h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '15px',
        }}
      >
        {marketData.map((market) => (
          <div
            key={
              market.market ||
              market.symbol
            }
            style={{
              background: '#1e2139',
              padding: '15px',
              borderRadius: '8px',
              border: '1px solid #2a2e4a',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                color: '#888',
                marginBottom: '5px',
              }}
            >
              {market.market ||
                market.symbol ||
                '—'}
            </div>

            <div
              style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#fff',
                marginBottom: '5px',
              }}
            >
              {Number.isFinite(
                Number(market.price)
              )
                ? `$${Number(
                    market.price
                  ).toFixed(2)}`
                : 'N/A'}
            </div>

            <div
              style={{
                fontSize: '11px',
                color:
                  Number(market.change) >= 0
                    ? '#4ade80'
                    : '#f87171',
              }}
            >
              {Number.isFinite(
                Number(market.change)
              )
                ? `${
                    Number(market.change) >= 0
                      ? '+'
                      : ''
                  }${Number(
                    market.change
                  ).toFixed(2)}%`
                : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor = '#fff',
}) {
  return (
    <div
      style={{
        background: '#1e2139',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #2a2e4a',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: '#888',
          marginBottom: '5px',
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: valueColor,
        }}
      >
        {value}
      </div>
    </div>
  );
}
