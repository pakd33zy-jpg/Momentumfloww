import React, { useEffect, useMemo, useState } from 'react';

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatLabel(ts) {
  try {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function MarketVolatilityCard({
  title = 'Market Volatility (VIX)',
  endpoint = '/api/market/volatility',
  height = 220,
}) {
  const [points, setPoints] = useState([]);
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setError('');
        const res = await fetch(endpoint, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // expected shape:
        // { points: [{ time: "...", value: 18.4 }, ...], current: 18.4 }
        const rows = Array.isArray(json?.points) ? json.points : [];
        const cleaned = rows
          .map((r) => ({
            time: r.time || r.timestamp || r.t,
            value: toNumber(r.value ?? r.close ?? r.vix),
          }))
          .filter((r) => r.time && Number.isFinite(r.value));

        if (!alive) return;

        setPoints(cleaned);
        if (cleaned.length > 0) {
          const last = cleaned[cleaned.length - 1];
          setStatus(`Current: ${last.value.toFixed(2)}`);
        } else {
          setStatus('No data');
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Failed to load');
        setStatus('Using fallback sample data');

        // fallback sample line so the card still renders
        const now = Date.now();
        const sample = Array.from({ length: 30 }).map((_, i) => ({
          time: now - (29 - i) * 60 * 1000,
          value: 16 + Math.sin(i / 3) * 2 + i * 0.05,
        }));
        setPoints(sample);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [endpoint]);

  const chart = useMemo(() => {
    const width = 1000;
    const pad = 28;

    if (!points.length) {
      return {
        path: '',
        min: 0,
        max: 0,
        last: null,
        width,
        labels: [],
      };
    }

    const values = points.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);

    if (min === max) {
      min -= 1;
      max += 1;
    }

    const xStep = (width - pad * 2) / Math.max(points.length - 1, 1);
    const yScale = (height - pad * 2) / (max - min);

    const xy = points.map((p, i) => {
      const x = pad + i * xStep;
      const y = height - pad - (p.value - min) * yScale;
      return { x, y, ...p };
    });

    const path = xy
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    const last = xy[xy.length - 1];

    const labelIndexes = [
      0,
      Math.floor(points.length * 0.33),
      Math.floor(points.length * 0.66),
      points.length - 1,
    ]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((idx) => ({
        x: xy[idx].x,
        label: formatLabel(points[idx].time),
      }));

    return { path, min, max, last, width, labels: labelIndexes };
  }, [points, height]);

  return (
    <div
      style={{
        background: '#0b0f1a',
        border: '1px solid #1f2a44',
        borderRadius: 16,
        padding: 18,
        color: '#e5e7eb',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.02) inset',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            Tracks volatility in a dark theme with a red line
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, color: '#94a3b8' }}>{status}</div>
          {error ? (
            <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>{error}</div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          background: '#05070d',
          borderRadius: 12,
          border: '1px solid #182033',
          padding: 10,
        }}
      >
        <svg viewBox={`0 0 ${chart.width} ${height}`} width="100%" height={height}>
          {/* grid */}
          {[0.2, 0.4, 0.6, 0.8].map((g) => {
            const y = height * g;
            return (
              <line
                key={g}
                x1="0"
                y1={y}
                x2={chart.width}
                y2={y}
                stroke="#182033"
                strokeWidth="1"
              />
            );
          })}

          {/* chart line */}
          {chart.path ? (
            <>
              <path
                d={chart.path}
                fill="none"
                stroke="#ef4444"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chart.last ? (
                <circle cx={chart.last.x} cy={chart.last.y} r="6" fill="#ef4444" />
              ) : null}
            </>
          ) : null}

          {/* min / max labels */}
          <text x="10" y="18" fill="#94a3b8" fontSize="14">
            High: {chart.max.toFixed(2)}
          </text>
          <text x="10" y={height - 10} fill="#94a3b8" fontSize="14">
            Low: {chart.min.toFixed(2)}
          </text>

          {/* x labels */}
          {chart.labels.map((l, i) => (
            <text
              key={i}
              x={l.x}
              y={height - 8}
              textAnchor="middle"
              fill="#64748b"
              fontSize="13"
            >
              {l.label}
            </text>
          ))}
        </svg>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 13,
          color: '#cbd5e1',
        }}
      >
        <span style={{ background: '#111827', padding: '6px 10px', borderRadius: 999 }}>
          Calm: under 15
        </span>
        <span style={{ background: '#111827', padding: '6px 10px', borderRadius: 999 }}>
          Active: 15–25
        </span>
        <span style={{ background: '#111827', padding: '6px 10px', borderRadius: 999 }}>
          High Vol: above 25
        </span>
      </div>
    </div>
  );
}
