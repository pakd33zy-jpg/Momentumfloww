import {
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import {
  api,
} from '../lib/api.js';

import TradingConfigPanel
  from '../components/TradingConfigPanel.jsx';

import MarketVolatilityCard
  from '../components/MarketVolatilityCard.jsx';

export default function Dashboard() {
  const navigate = useNavigate();
  const [symbolSearch, setSymbolSearch] = useState('');
  const [
    sessions,
    setSessions,
  ] = useState([]);

  const [
    marketData,
    setMarketData,
  ] = useState([]);

  const [
    bot,
    setBot,
  ] = useState(null);

  const [
    brokerAccounts,
    setBrokerAccounts,
  ] = useState({
    paper: null,
    live: null,
  });

  const [
    tradingMode,
    setTradingMode,
  ] = useState(
    'paper'
  );

  const [
    showSettings,
    setShowSettings,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  useEffect(() => {
    refreshDashboard();

    const interval =
      setInterval(
        refreshDashboard,
        5000
      );

    return () =>
      clearInterval(
        interval
      );
  }, []);

  async function refreshDashboard() {
    const results =
      await Promise.allSettled([
        api.listSessions(),

        api.getMarketGrid(),

        api.getLiveBotStatus(),

        api.getBrokerAccounts(),

        api.getTradingMode(),
      ]);

    if (
      results[0].status ===
      'fulfilled'
    ) {
      setSessions(
        Array.isArray(
          results[0].value
        )
          ? results[0].value
          : []
      );
    }

    if (
      results[1].status ===
      'fulfilled'
    ) {
      setMarketData(
        Array.isArray(
          results[1].value
        )
          ? results[1].value
          : []
      );
    }

    if (
      results[2].status ===
      'fulfilled'
    ) {
      setBot(
        results[2].value
      );
    }

    if (
      results[3].status ===
      'fulfilled'
    ) {
      setBrokerAccounts(
        results[3].value ||
        {
          paper: null,
          live: null,
        }
      );
    }

    if (
      results[4].status ===
      'fulfilled'
    ) {
      setTradingMode(
        results[4].value
          ?.mode ||
        'paper'
      );
    }
  }

  async function startBot() {
    try {
      setBusy(true);

      setError('');

      const result =
        await api.startLiveBot();

      setBot(
        result
      );

      await refreshDashboard();
    } catch (err) {
      setError(
        `Bot not started: ${err.message}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function stopBot() {
    try {
      setBusy(true);

      setError('');

      const result =
        await api.stopLiveBot();

      setBot(
        result
      );

      await refreshDashboard();
    } catch (err) {
      setError(
        `Failed to stop bot: ${err.message}`
      );
    } finally {
      setBusy(false);
    }
  }

  const paperConnected =
    brokerAccounts
      ?.paper
      ?.connected ===
    true;

  const liveConnected =
    brokerAccounts
      ?.live
      ?.connected ===
    true;

  const activeAccount =
    tradingMode ===
    'live'
      ? brokerAccounts?.live
      : brokerAccounts?.paper;

  const activeConnected =
    activeAccount
      ?.connected ===
    true;

  const modeSessions =
    sessions.filter(
      (session) =>
        session.mode ===
        tradingMode
    );

  const lastSession =
    modeSessions[0];

  const lastPnl =
    Number(
      lastSession
        ?.total_pnl ??
      0
    );

  const wins =
    Number(
      lastSession
        ?.wins ??
      0
    );

  const losses =
    Number(
      lastSession
        ?.losses ??
      0
    );

  const winRate =
    wins + losses > 0
      ? (
          (
            wins /
            (wins +
              losses)
          ) *
          100
        ).toFixed(1)
      : '-';

  const totalAssets =
    Number(
      activeAccount
        ?.equity ??
      activeAccount
        ?.portfolioValue ??
      0
    );

  const botMode =
    bot?.mode ||
    tradingMode;

  const running =
    bot?.running ===
    true;

  const moverRows =
    Array.isArray(bot?.moverLeaderboard)
      ? bot.moverLeaderboard.slice(0, 15)
      : [];

  const rejectionLearning =
    bot?.rejectionOutcomeLearning || null;

  return (
    <div
      style={{
        padding:
          '20px',

        maxWidth:
          '1200px',

        margin:
          '0 auto',
      }}
    >
      <div
        style={{
          display:
            'flex',

          alignItems:
            'center',

          justifyContent:
            'space-between',

          marginBottom:
            '20px',
        }}
      >
        <h1
          style={{
            margin: 0,
          }}
        >
          MomentumFlow
        </h1>

        <span
          style={{
            color:
              '#60a5fa',

            fontSize:
              '11px',

            fontWeight:
              'bold',
          }}
        >
          UNIFIED BOT UI v13
        </span>
      </div>

      <div
        style={{
          display:
            'grid',

          gridTemplateColumns:
            'repeat(auto-fit, minmax(190px, 1fr))',

          gap:
            '15px',

          marginBottom:
            '25px',
        }}
      >
        <StatCard
          label={
            tradingMode ===
            'live'
              ? 'LIVE ALPACA EQUITY'
              : 'ALPACA PAPER EQUITY'
          }

          value={`$${totalAssets.toFixed(
            2
          )}`}
        />

        <StatCard
          label="LAST SESSION P&L"

          value={
            lastSession
              ? `${
                  lastPnl >= 0
                    ? '+'
                    : ''
                }$${lastPnl.toFixed(
                  2
                )}`
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
          label={`${tradingMode.toUpperCase()} SESSIONS`}

          value={String(
            modeSessions.length
          )}
        />
      </div>

      <div
        style={{
          background:
            '#1e2139',

          padding:
            '15px',

          borderRadius:
            '8px',

          border:
            '1px solid #2a2e4a',

          marginBottom:
            '25px',
        }}
      >
        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            gap:
              '10px',
          }}
        >
          <div
            style={{
              width:
                '10px',

              height:
                '10px',

              borderRadius:
                '50%',

              background:
                activeConnected
                  ? '#4ade80'
                  : '#f87171',
            }}
          />

          <div>
            <div
              style={{
                color:
                  activeConnected
                    ? '#4ade80'
                    : '#f87171',

                fontWeight:
                  'bold',
              }}
            >
              {activeConnected
                ? `ALPACA ${tradingMode.toUpperCase()} CONNECTED`
                : `ALPACA ${tradingMode.toUpperCase()} NOT CONNECTED`}
            </div>

            <div
              style={{
                fontSize:
                  '12px',

                color:
                  '#aaa',

                marginTop:
                  '4px',
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

              Active mode:{' '}
              {tradingMode}
            </div>
          </div>
        </div>
      </div>

      <MarketVolatilityCard />

      <button
        onClick={() =>
          setShowSettings(
            (value) =>
              !value
          )
        }

        style={{
          padding:
            '10px 15px',

          background:
            '#1e2139',

          color:
            '#3b82f6',

          border:
            '1px solid #2a2e4a',

          borderRadius:
            '4px',

          cursor:
            'pointer',

          marginBottom:
            '20px',
        }}
      >
        {showSettings
          ? '▼ Hide Settings'
          : '▶ Show Settings'}
      </button>

      {showSettings && (
        <div
          style={{
            background:
              '#1e2139',

            padding:
              '20px',

            borderRadius:
              '8px',

            border:
              '1px solid #2a2e4a',

            marginBottom:
              '25px',
          }}
        >
          <h3>
            Trading Configuration
          </h3>

          <TradingConfigPanel
            compact
          />
        </div>
      )}

      <div
        style={{
          background:
            '#1e2139',

          padding:
            '20px',

          borderRadius:
            '8px',

          border:
            '1px solid #2a2e4a',

          marginBottom:
            '25px',
        }}
      >
        <h3
          style={{
            margin:
              '0 0 10px',

            color:
              '#4ade80',
          }}
        >
          SAME STRATEGY — PAPER & LIVE
        </h3>

        <div
          style={{
            color:
              '#aaa',

            fontSize:
              '13px',

            lineHeight:
              1.6,
          }}
        >
          <div>
            PAPER = real Alpaca
            market data + real
            strategy + Alpaca paper
            orders.
          </div>

          <div>
            LIVE = the same scanner,
            signals, entries, exits and
            risk rules using the Alpaca
            live account.
          </div>

          <div>
            Equities can trade LONG or
            SHORT. Crypto is LONG only.
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            color:
              '#f87171',

            marginBottom:
              '20px',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background:
            '#1e2139',

          padding:
            '18px',

          borderRadius:
            '8px',

          border:
            '1px solid #2a2e4a',

          marginBottom:
            '24px',
        }}
      >
        <div
          style={{
            display:
              'flex',

            justifyContent:
              'space-between',

            gap:
              '12px',
          }}
        >
          <div>
            <div
              style={{
                fontWeight:
                  'bold',

                color:
                  running
                    ? '#4ade80'
                    : '#fff',
              }}
            >
              {tradingMode ===
              'live'
                ? 'Automated LIVE Bot'
                : 'Automated PAPER Bot'}
            </div>

            <div
              style={{
                color:
                  '#aaa',

                fontSize:
                  '12px',

                marginTop:
                  '4px',
              }}
            >
              {tradingMode ===
              'paper'
                ? 'Trades the real market through your Alpaca PAPER account. No real capital.'
                : 'Trades the real market through your Alpaca LIVE account. Real capital.'}
            </div>
          </div>

          <div
            style={{
              color:
                running
                  ? '#4ade80'
                  : '#888',

              fontSize:
                '12px',
            }}
          >
            {running
              ? `${String(
                  botMode
                ).toUpperCase()} RUNNING`
              : 'STOPPED'}
          </div>
        </div>

        <div style={{marginTop:'10px',fontSize:'12px',color:'#94a3b8'}}>
          <b>ACTIVE SCAN NOW:</b>{' '}
          {Number(bot?.activeScanCounts?.equities || 0)} equities /{' '}
          {Number(bot?.activeScanCounts?.crypto || 0)} crypto
          {' · '}
          <b>STORED UNIVERSE:</b>{' '}
          {Number(bot?.universe?.total || bot?.universeSize || 0)} assets
        </div>

        {bot?.lastDecision && (
          <div
            style={{
              marginTop:
                '12px',

              fontSize:
                '12px',

              color:
                '#cbd5e1',
            }}
          >
            {bot.lastDecision}
          </div>
        )}

        {bot?.lastError && (
          <div
            style={{
              marginTop:
                '8px',

              color:
                '#f87171',

              fontSize:
                '12px',
            }}
          >
            {bot.lastError}
          </div>
        )}

        <div
          style={{
            display:
              'flex',

            gap:
              '10px',

            marginTop:
              '14px',
          }}
        >
          <button
            onClick={
              startBot
            }

            disabled={
              busy ||
              running ||
              !activeConnected
            }

            style={{
              flex: 1,

              padding:
                '13px',

              background:
                tradingMode ===
                'live'
                  ? '#dc2626'
                  : '#2563eb',

              color:
                '#fff',

              border:
                'none',

              borderRadius:
                '6px',

              fontWeight:
                'bold',

              cursor:
                'pointer',

              opacity:
                busy ||
                running ||
                !activeConnected
                  ? 0.5
                  : 1,
            }}
          >
            {busy
              ? 'Please wait…'
              : tradingMode ===
                  'live'
                ? 'Start LIVE Bot'
                : 'Start PAPER Bot'}
          </button>

          <button
            onClick={
              stopBot
            }

            disabled={
              busy ||
              !running
            }

            style={{
              flex: 1,

              padding:
                '13px',

              background:
                '#111827',

              color:
                '#fff',

              border:
                '1px solid #4b5563',

              borderRadius:
                '6px',

              fontWeight:
                'bold',

              cursor:
                'pointer',

              opacity:
                busy ||
                !running
                  ? 0.5
                  : 1,
            }}
          >
            Stop Bot
          </button>
        </div>

        <div
          style={{
            marginTop:
              '10px',

            fontSize:
              '11px',

            color:
              '#888',
          }}
        >
          Position size = stop-based
          risk sizing × setup quality,
          capped by account equity.
        </div>
      </div>


      <div style={{ background:'#1e2139', padding:15, borderRadius:8, border:'1px solid #2a2e4a', marginBottom:18 }}>
        <div style={{fontWeight:'bold',marginBottom:8}}>Symbol Search</div>
        <div style={{display:'flex',gap:8}}>
          <input
            value={symbolSearch}
            onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && symbolSearch.trim()) {
                const raw = symbolSearch.trim();
                const normalized = raw.includes('/') ? raw : raw;
                navigate(`/symbol/${encodeURIComponent(normalized)}`);
              }
            }}
            placeholder="AAPL, NVDA, SPY, BTC/USD..."
            style={{flex:1,background:'#0f172a',color:'#fff',border:'1px solid #475569',borderRadius:6,padding:11}}
          />
          <button
            onClick={() => symbolSearch.trim() && navigate(`/symbol/${encodeURIComponent(symbolSearch.trim())}`)}
            style={{background:'#2563eb',color:'#fff',border:0,borderRadius:6,padding:'0 15px',fontWeight:'bold'}}
          >
            View
          </button>
        </div>
      </div>

      <div style={{background:'#1e2139',padding:15,borderRadius:8,border:'1px solid #2a2e4a',marginBottom:18}}>
        <div style={{fontWeight:'bold',marginBottom:4,color:'#4ade80'}}>LIVE OPPORTUNITY LEADERBOARD</div>
        <div style={{fontSize:11,color:'#888',marginBottom:10}}>
          Scanner ranking only. Entry and risk rules still decide whether anything trades.
        </div>
        {moverRows.length ? (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{color:'#94a3b8',textAlign:'left'}}>
                  <th style={{padding:6}}>#</th>
                  <th style={{padding:6}}>Symbol</th>
                  <th style={{padding:6}}>Market</th>
                  <th style={{padding:6}}>Score</th>
                  <th style={{padding:6}}>Momentum</th>
                  <th style={{padding:6}}>Spread</th>
                  <th style={{padding:6}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {moverRows.map((row,index)=>(
                  <tr key={`${row.market}-${row.symbol}`} onClick={()=>navigate(`/symbol/${encodeURIComponent(row.symbol)}`)}
                    style={{borderTop:'1px solid #2a2e4a',cursor:'pointer'}}>
                    <td style={{padding:6,color:'#888'}}>{index+1}</td>
                    <td style={{padding:6,fontWeight:'bold'}}>{row.symbol}</td>
                    <td style={{padding:6}}>{row.market || row.assetClass || '—'}</td>
                    <td style={{padding:6}}>{Number(row.score || 0).toFixed(2)}</td>
                    <td style={{padding:6}}>{Number.isFinite(Number(row.momentumPct)) ? `${Number(row.momentumPct).toFixed(3)}%` : '—'}</td>
                    <td style={{padding:6}}>{Number.isFinite(Number(row.spreadPct)) ? `${Number(row.spreadPct).toFixed(3)}%` : '—'}</td>
                    <td style={{padding:6}}>{row.status || 'watching'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{fontSize:12,color:'#888'}}>Waiting for scanner opportunity samples…</div>}
      </div>

      <div style={{background:'#1e2139',padding:15,borderRadius:8,border:'1px solid #2a2e4a',marginBottom:18}}>
        <div style={{fontWeight:'bold',marginBottom:4}}>REJECTION OUTCOME LEARNING</div>
        <div style={{fontSize:11,color:'#888',marginBottom:10}}>
          Forward performance of rejected setups at 5 / 15 / 30 / 60 minutes.
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}>
          {[5,15,30,60].map((minutes)=>{
            const row=rejectionLearning?.horizons?.[`m${minutes}`] || {};
            return (
              <div key={minutes} style={{background:'#0f172a',padding:10,borderRadius:6}}>
                <div style={{fontSize:11,color:'#94a3b8'}}>{minutes} MIN</div>
                <div style={{fontWeight:'bold',marginTop:3}}>
                  {Number.isFinite(Number(row.avgDirectionReturnPct))
                    ? `${Number(row.avgDirectionReturnPct)>=0?'+':''}${Number(row.avgDirectionReturnPct).toFixed(3)}%`
                    : '—'}
                </div>
                <div style={{fontSize:10,color:'#888',marginTop:3}}>
                  {Number(row.samples || 0)} samples · {row.positivePct == null ? '—' : `${row.positivePct}%`} favorable
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <h3
        style={{
          color:
            '#ccc',

          marginTop:
            '30px',

          marginBottom:
            '15px',
        }}
      >
        Market Grid
      </h3>

      <div
        style={{
          display:
            'grid',

          gridTemplateColumns:
            'repeat(auto-fit, minmax(150px, 1fr))',

          gap:
            '15px',
        }}
      >
        {marketData.map(
          (market) => (
            <div
              key={
                market.market ||
                market.symbol
              }
              onClick={() => navigate(`/symbol/${encodeURIComponent(market.symbol || market.market)}`)}
              style={{
                background:
                  '#1e2139',

                padding:
                  '15px',

                borderRadius:
                  '8px',

                border:
                  '1px solid #2a2e4a',

                cursor:
                  'pointer',
              }}
            >
              <div
                style={{
                  fontSize:
                    '12px',

                  color:
                    '#888',

                  marginBottom:
                    '5px',
                }}
              >
                {market.market ||
                  market.symbol ||
                  '—'}
              </div>

              <div
                style={{
                  fontSize:
                    '18px',

                  fontWeight:
                    'bold',

                  color:
                    '#fff',
                }}
              >
                {Number.isFinite(
                  Number(
                    market.price
                  )
                )
                  ? `$${Number(
                      market.price
                    ).toFixed(
                      2
                    )}`
                  : 'N/A'}
              </div>
            </div>
          )
        )}
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
        background:
          '#1e2139',

        padding:
          '20px',

        borderRadius:
          '8px',

        border:
          '1px solid #2a2e4a',
      }}
    >
      <div
        style={{
          fontSize:
            '12px',

          color:
            '#888',

          marginBottom:
            '5px',
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize:
            '24px',

          fontWeight:
            'bold',

          color:
            valueColor,
        }}
      >
        {value}
      </div>
    </div>
  );
}
