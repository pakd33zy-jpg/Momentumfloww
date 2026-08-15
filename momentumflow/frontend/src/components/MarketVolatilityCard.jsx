import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  api,
} from '../lib/api.js';

function fmt(
  value,
  digits = 2
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number.toFixed(
        digits
      )
    : '-';
}

function pct(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return '-';
  }

  return `${
    number >= 0
      ? '+'
      : ''
  }${number.toFixed(
    2
  )}%`;
}

export default function MarketVolatilityCard() {
  const [
    data,
    setData,
  ] = useState(null);

  const [
    error,
    setError,
  ] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const next =
          await api
            .getMarketVolatility();

        if (active) {
          setData(
            next
          );

          setError('');
        }
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              'Unable to load SPY volatility.'
          );
        }
      }
    }

    load();

    const timer =
      setInterval(
        load,
        30000
      );

    return () => {
      active = false;

      clearInterval(
        timer
      );
    };
  }, []);

  const chart =
    useMemo(
      () => {
        const points =
          Array.isArray(
            data?.points
          )
            ? data.points
            : [];

        if (
          points.length <
          2
        ) {
          return null;
        }

        const width =
          760;

        const height =
          220;

        const padX =
          14;

        const padY =
          18;

        const closes =
          points
            .map(
              (point) =>
                Number(
                  point.c
                )
            )
            .filter(
              Number.isFinite
            );

        const min =
          Math.min(
            ...closes
          );

        const max =
          Math.max(
            ...closes
          );

        const span =
          Math.max(
            max - min,

            Math.max(
              Math.abs(
                max
              ),
              1
            ) *
              0.0005
          );

        const path =
          points
            .map(
              (
                point,
                index
              ) => {
                const x =
                  padX +
                  (
                    index /
                    Math.max(
                      points.length -
                        1,
                      1
                    )
                  ) *
                    (
                      width -
                      padX * 2
                    );

                const y =
                  padY +
                  (
                    (
                      max -
                      Number(
                        point.c
                      )
                    ) /
                    span
                  ) *
                    (
                      height -
                      padY * 2
                    );

                return `${
                  index === 0
                    ? 'M'
                    : 'L'
                } ${x.toFixed(
                  1
                )} ${y.toFixed(
                  1
                )}`;
              }
            )
            .join(' ');

        const open =
          Number(
            data
              ?.stats
              ?.open
          );

        const openY =
          Number.isFinite(
            open
          )
            ? padY +
              (
                (
                  max -
                  open
                ) /
                span
              ) *
                (
                  height -
                  padY * 2
                )
            : null;

        return {
          width,
          height,
          path,
          openY,
        };
      },
      [data]
    );

  const change =
    Number(
      data
        ?.stats
        ?.changePct ??
      0
    );

  const lineColor =
    change >= 0
      ? '#4ade80'
      : '#f87171';

  return (
    <div
      style={{
        background:
          '#1e2139',

        border:
          '1px solid #2a2e4a',

        borderRadius:
          '8px',

        padding:
          '18px',

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

          alignItems:
            'flex-start',

          flexWrap:
            'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontWeight:
                'bold',

              fontSize:
                '16px',
            }}
          >
            SPY Market Volatility
          </div>

          <div
            style={{
              color:
                '#94a3b8',

              fontSize:
                '12px',

              marginTop:
                '4px',
            }}
          >
            Live Alpaca IEX ·
            5-minute bars ·{' '}
            {data?.session ||
              'loading'}
          </div>
        </div>

        <div
          style={{
            textAlign:
              'right',
          }}
        >
          <div
            style={{
              fontSize:
                '22px',

              fontWeight:
                'bold',
            }}
          >
            $
            {fmt(
              data
                ?.stats
                ?.last
            )}
          </div>

          <div
            style={{
              color:
                lineColor,

              fontWeight:
                'bold',

              fontSize:
                '13px',
            }}
          >
            {pct(
              data
                ?.stats
                ?.changePct
            )}{' '}
            session
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            color:
              '#f87171',

            fontSize:
              '12px',

            marginTop:
              '12px',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display:
            'grid',

          gridTemplateColumns:
            'repeat(auto-fit, minmax(125px, 1fr))',

          gap:
            '10px',

          marginTop:
            '14px',

          marginBottom:
            '12px',
        }}
      >
        <Metric
          label="OPEN"
          value={`$${fmt(
            data
              ?.stats
              ?.open
          )}`}
        />

        <Metric
          label="HIGH"
          value={`$${fmt(
            data
              ?.stats
              ?.high
          )}`}
        />

        <Metric
          label="LOW"
          value={`$${fmt(
            data
              ?.stats
              ?.low
          )}`}
        />

        <Metric
          label="SESSION RANGE"
          value={`${fmt(
            data
              ?.stats
              ?.rangePct
          )}%`}
        />

        <Metric
          label="REALIZED VOL"
          value={`${fmt(
            data
              ?.stats
              ?.realizedPct
          )}%`}
        />
      </div>

      <div
        style={{
          height:
            '230px',

          background:
            '#15182a',

          border:
            '1px solid #272b46',

          borderRadius:
            '7px',

          overflow:
            'hidden',
        }}
      >
        {chart ? (
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              x2={
                chart.width
              }
              y1="55"
              y2="55"
              stroke="#252a45"
              strokeWidth="1"
            />

            <line
              x1="0"
              x2={
                chart.width
              }
              y1="110"
              y2="110"
              stroke="#252a45"
              strokeWidth="1"
            />

            <line
              x1="0"
              x2={
                chart.width
              }
              y1="165"
              y2="165"
              stroke="#252a45"
              strokeWidth="1"
            />

            {chart.openY !=
              null &&
              chart.openY >=
                0 &&
              chart.openY <=
                chart.height && (
                <line
                  x1="0"
                  x2={
                    chart.width
                  }
                  y1={
                    chart.openY
                  }
                  y2={
                    chart.openY
                  }
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="7 7"
                />
              )}

            <path
              d={
                chart.path
              }
              fill="none"
              stroke={
                lineColor
              }
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div
            style={{
              color:
                '#94a3b8',

              padding:
                '18px',

              fontSize:
                '13px',
            }}
          >
            Loading SPY
            volatility data…
          </div>
        )}
      </div>

      <div
        style={{
          color:
            '#64748b',

          fontSize:
            '11px',

          marginTop:
            '8px',
        }}
      >
        Dashed line =
        session open. Graph
        refreshes every 30
        seconds.
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}) {
  return (
    <div
      style={{
        background:
          '#171a2d',

        borderRadius:
          '6px',

        padding:
          '10px',
      }}
    >
      <div
        style={{
          color:
            '#64748b',

          fontSize:
            '10px',

          fontWeight:
            'bold',
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            '4px',

          fontWeight:
            'bold',
        }}
      >
        {value}
      </div>
    </div>
  );
}
