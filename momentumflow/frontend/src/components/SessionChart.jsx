import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

/** trades: array of Trade with cumulative pnl already computable in order */
export default function SessionChart({ trades = [], startingCapital = 100 }) {
  const data = React.useMemo(() => {
    let running = startingCapital;
    const points = [{ i: 0, equity: running }];
    trades
      .filter((t) => t.pnl !== null && t.pnl !== undefined)
      .forEach((t, idx) => {
        running += t.pnl;
        points.push({ i: idx + 1, equity: Number(running.toFixed(2)) });
      });
    return points;
  }, [trades, startingCapital]);

  const isUp = data.length > 1 && data[data.length - 1].equity >= data[0].equity;

  if (data.length <= 1) {
    return (
      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
        No closed trades yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isUp ? '#3DDC84' : '#FF5C5C'} stopOpacity={0.35} />
            <stop offset="100%" stopColor={isUp ? '#3DDC84' : '#FF5C5C'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="i" hide />
        <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-inset)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
          labelFormatter={() => ''}
          formatter={(v) => [`$${v}`, 'Equity']}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={isUp ? '#3DDC84' : '#FF5C5C'}
          strokeWidth={2}
          fill="url(#equityFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
