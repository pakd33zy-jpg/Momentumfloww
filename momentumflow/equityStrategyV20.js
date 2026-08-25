// EQUITY STRATEGY ENGINE v20 ADAPTIVE
//
// Four equity playbooks:
// 1) Opening Range Breakout
// 2) VWAP Pullback / Reclaim
// 3) Trend Continuation
// 4) Optional PAPER-only 1-minute Fast Scalp
//
// The engine evaluates each playbook independently, then chooses the
// highest-quality LONG or SHORT setup. It intentionally does not use one
// hard market-regime/VWAP rule for every setup.
//
// No strategy guarantees profit. Validate with Alpaca PAPER fills before LIVE.

export const EQUITY_V20_DEFAULTS = {
  equityV20Enabled: true,
  equityFocusMode: true,
  equityFastScalpEnabled: false,

  equityV20ScoreThreshold: 7.5,

  // Override legacy scanner defaults when v20 is active.
  maxDetailedEquities: 36,
  equityPrefilterMomentumPct: 0.005,
  maxEquitySpreadPct: 0.12,
  equityCooldownMinutes: 8,
  equityV20MaxDetailedEquities: 36,
  equityV20PrefilterMomentumPct: 0.008,
  equityV20PrefilterDayMovePct: 0.25,
  equityV20PrefilterMaxSpreadPct: 0.12,

  equityV20MaxSpreadPct: 0.08,
  equityV20EstimatedRoundTripCostPct: 0.02,

  equityV20OrbStartMinutesET: 9 * 60 + 35,
  equityV20OrbEndMinutesET: 10 * 60 + 45,
  equityV20OrbMinutes: 5,
  equityV20OrbMinMomentumPct: 0.025,
  equityV20OrbStrongMomentumPct: 0.060,
  equityV20OrbMinVolumeRatio: 1.00,
  equityV20OrbMaxBreakoutAtr: 0.75,

  equityV20VwapStartMinutesET: 9 * 60 + 45,
  equityV20VwapEndMinutesET: 15 * 60 + 30,
  equityV20VwapTouchPct: 0.18,
  equityV20VwapMaxDistancePct: 0.45,
  equityV20VwapMinMomentumPct: 0.012,
  equityV20VwapMinVolumeRatio: 0.80,

  equityV20ContinuationStartMinutesET: 10 * 60,
  equityV20ContinuationEndMinutesET: 15 * 60 + 45,
  equityV20ContinuationMinMomentumPct: 0.015,
  equityV20ContinuationStrongMomentumPct: 0.045,
  equityV20ContinuationMinVolumeRatio: 0.90,
  equityV20ContinuationMaxVwapAtr: 1.35,

  equityFastScalpStartMinutesET: 9 * 60 + 35,
  equityFastScalpEndMinutesET: 15 * 60 + 50,
  equityFastScalpScoreThreshold: 8,
  equityFastScalpEntryMomentumPct: 0.18,
  equityFastScalpMaxSpreadPct: 0.06,
  equityFastScalpEstimatedRoundTripCostPct: 0.05,
  equityFastScalpProfitBufferPct: 0.08,
  equityFastScalpMinDollarVolume: 10000000,
  equityFastScalpMinVolumeRatio: 0.90,
  equityFastScalpStopLossPct: 0.25,
  equityFastScalpTakeProfitPct: 0.55,
  equityFastScalpTrailTriggerPct: 0.32,
  equityFastScalpTrailDistancePct: 0.10,
  equityFastScalpTrailFloorPct: 0.18,
  equityFastScalpMaxHoldMinutes: 5,
  equityFastScalpReversalMomentumPct: 0.05,
  equityFastScalpFadeMomentumPct: 0.01,
  equityFastScalpCostLockPct: 0.25,
};

const ET = new Intl.DateTimeFormat(
  'en-US',
  {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
);

const num = (value, fallback = 0) =>
  Number.isFinite(Number(value))
    ? Number(value)
    : fallback;

const clamp = (value, low, high) =>
  Math.max(low, Math.min(high, value));

const avg = (values = []) => {
  const good = values.filter(Number.isFinite);
  return good.length
    ? good.reduce((sum, value) => sum + value, 0) / good.length
    : 0;
};

const t = (bar) => bar?.t || bar?.timestamp || null;
const o = (bar) => num(bar?.o, NaN);
const h = (bar) => num(bar?.h, NaN);
const l = (bar) => num(bar?.l, NaN);
const c = (bar) => num(bar?.c, NaN);
const v = (bar) => num(bar?.v, 0);

function etParts(value) {
  const parts = Object.fromEntries(
    ET.formatToParts(
      value instanceof Date
        ? value
        : new Date(value)
    ).map((part) => [
      part.type,
      part.value,
    ])
  );

  return {
    dateKey:
      `${parts.year}-${parts.month}-${parts.day}`,
    minutes:
      Number(parts.hour) * 60 +
      Number(parts.minute),
  };
}

export function equityStrategyWindowOpen({ now = new Date(), config = {} } = {}) {
  const settings = { ...EQUITY_V20_DEFAULTS, ...config };
  const minutes = etParts(now).minutes;
  const windows = [];

  if (settings.equityV20Enabled !== false) {
    windows.push(
      [settings.equityV20OrbStartMinutesET, settings.equityV20OrbEndMinutesET],
      [settings.equityV20VwapStartMinutesET, settings.equityV20VwapEndMinutesET],
      [settings.equityV20ContinuationStartMinutesET, settings.equityV20ContinuationEndMinutesET],
    );
  } else {
    windows.push([
      settings.equityStartMinutesET ?? 575,
      settings.equityEndMinutesET ?? 950,
    ]);
  }

  if (settings.equityFastScalpEnabled === true) {
    windows.push([
      settings.equityFastScalpStartMinutesET,
      settings.equityFastScalpEndMinutesET,
    ]);
  }

  return windows.some(([start, end]) =>
    minutes >= Number(start) && minutes <= Number(end)
  );
}

function mergeCurrentMinuteBar(
  bars = [],
  snapshot = null
) {
  const output = Array.isArray(bars)
    ? [...bars]
    : [];

  const minuteBar = snapshot?.minuteBar;

  if (
    !minuteBar ||
    !Number.isFinite(Number(minuteBar?.c))
  ) {
    return output;
  }

  const stamp = t(minuteBar);
  const index = stamp
    ? output.findIndex(
        (bar) => t(bar) === stamp
      )
    : -1;

  if (index >= 0) {
    output[index] = minuteBar;
  } else {
    output.push(minuteBar);
  }

  output.sort(
    (a, b) =>
      new Date(t(a) || 0).getTime() -
      new Date(t(b) || 0).getTime()
  );

  return output;
}

function completedBars(
  bars = [],
  now = new Date()
) {
  const minute = Math.floor(
    now.getTime() / 60000
  );

  return bars.filter((bar) => {
    const ms = t(bar)
      ? new Date(t(bar)).getTime()
      : NaN;

    return (
      Number.isFinite(ms) &&
      Math.floor(ms / 60000) < minute
    );
  });
}

function sessionBarsET(
  bars,
  now = new Date()
) {
  const today = etParts(now).dateKey;

  return (bars || []).filter((bar) => {
    if (!t(bar)) return false;

    const parts = etParts(t(bar));

    return (
      parts.dateKey === today &&
      parts.minutes >= 570 &&
      parts.minutes <= 960
    );
  });
}

function currentPrice(
  snapshot,
  bars = []
) {
  return num(
    snapshot?.latestTrade?.p ??
      snapshot?.minuteBar?.c ??
      bars.at(-1)?.c ??
      snapshot?.dailyBar?.c,
    NaN
  );
}

function spreadPct(snapshot) {
  const ask = num(
    snapshot?.latestQuote?.ap,
    NaN
  );
  const bid = num(
    snapshot?.latestQuote?.bp,
    NaN
  );

  if (
    ![ask, bid].every(Number.isFinite) ||
    ask <= 0 ||
    bid <= 0 ||
    ask < bid
  ) {
    return null;
  }

  const mid = (ask + bid) / 2;

  return mid > 0
    ? ((ask - bid) / mid) * 100
    : null;
}

function minuteMomentumPct(snapshot) {
  const open = num(
    snapshot?.minuteBar?.o,
    NaN
  );
  const close = num(
    snapshot?.minuteBar?.c ??
      snapshot?.latestTrade?.p,
    NaN
  );

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {
    return null;
  }

  return ((close - open) / open) * 100;
}

export function equityDayMovePct(
  snapshot
) {
  const open = num(
    snapshot?.dailyBar?.o,
    NaN
  );
  const price = num(
    snapshot?.latestTrade?.p ??
      snapshot?.minuteBar?.c ??
      snapshot?.dailyBar?.c,
    NaN
  );

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(price) ||
    open <= 0
  ) {
    return 0;
  }

  return ((price - open) / open) * 100;
}

function dailyDollarVolume(snapshot) {
  const price = num(
    snapshot?.latestTrade?.p ??
      snapshot?.minuteBar?.c ??
      snapshot?.dailyBar?.c,
    0
  );

  return (
    price *
    num(snapshot?.dailyBar?.v, 0)
  );
}

function trendPct(
  bars,
  lookback
) {
  if (
    !Array.isArray(bars) ||
    bars.length < lookback + 1
  ) {
    return 0;
  }

  const current = c(bars.at(-1));
  const previous = c(
    bars[
      Math.max(
        0,
        bars.length - 1 - lookback
      )
    ]
  );

  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous <= 0
  ) {
    return 0;
  }

  return (
    ((current - previous) / previous) *
    100
  );
}

function volumeRatio(
  bars,
  lookback = 12
) {
  if (
    !Array.isArray(bars) ||
    bars.length < 3
  ) {
    return 0;
  }

  const current = v(bars.at(-1));

  const base = avg(
    bars
      .slice(
        Math.max(
          0,
          bars.length - 1 - lookback
        ),
        -1
      )
      .map(v)
      .filter((value) => value > 0)
  );

  return base > 0
    ? current / base
    : 0;
}

function vwap(bars = []) {
  let priceVolume = 0;
  let totalVolume = 0;

  for (const bar of bars) {
    const high = h(bar);
    const low = l(bar);
    const close = c(bar);
    const volume = v(bar);

    if (
      ![high, low, close].every(
        Number.isFinite
      ) ||
      volume <= 0
    ) {
      continue;
    }

    const typical =
      (high + low + close) / 3;

    priceVolume += typical * volume;
    totalVolume += volume;
  }

  return totalVolume > 0
    ? priceVolume / totalVolume
    : null;
}

function atrAbsolute(
  bars,
  lookback = 14
) {
  if (
    !Array.isArray(bars) ||
    bars.length < 3
  ) {
    return 0;
  }

  const rows = bars.slice(
    Math.max(
      1,
      bars.length - lookback
    )
  );

  const ranges = [];

  for (const [i, bar] of rows.entries()) {
    const index =
      bars.indexOf(bar);

    const previous =
      bars[index - 1];

    const high = h(bar);
    const low = l(bar);
    const previousClose = c(previous);

    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low)
    ) {
      continue;
    }

    const values = [
      high - low,
    ];

    if (
      Number.isFinite(previousClose)
    ) {
      values.push(
        Math.abs(
          high - previousClose
        ),
        Math.abs(
          low - previousClose
        )
      );
    }

    ranges.push(
      Math.max(...values)
    );
  }

  return avg(ranges);
}

function atrPct(
  bars,
  lookback = 14
) {
  const absolute = atrAbsolute(
    bars,
    lookback
  );
  const price = c(bars.at(-1));

  return (
    Number.isFinite(price) &&
    price > 0
  )
    ? (absolute / price) * 100
    : 0;
}

function openingRange(
  bars,
  now,
  minutes = 5
) {
  const none = {
    available: false,
    long: false,
    short: false,
    confirmedLong: false,
    confirmedShort: false,
    high: null,
    low: null,
  };

  const session = sessionBarsET(
    bars,
    now
  );

  const cutoff =
    570 + Number(minutes || 5);

  const opening = session.filter(
    (bar) =>
      t(bar) &&
      etParts(t(bar)).minutes < cutoff
  );

  const after = session.filter(
    (bar) =>
      t(bar) &&
      etParts(t(bar)).minutes >= cutoff
  );

  if (
    opening.length < 3 ||
    !after.length
  ) {
    return none;
  }

  const highs = opening
    .map(h)
    .filter(Number.isFinite);

  const lows = opening
    .map(l)
    .filter(Number.isFinite);

  if (!highs.length || !lows.length) {
    return none;
  }

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const currentClose = c(
    after.at(-1)
  );
  const previousClose = c(
    after.at(-2)
  );

  return {
    available:
      Number.isFinite(currentClose),
    long:
      Number.isFinite(currentClose) &&
      currentClose > high,
    short:
      Number.isFinite(currentClose) &&
      currentClose < low,
    confirmedLong:
      Number.isFinite(previousClose) &&
      previousClose > high &&
      currentClose > high,
    confirmedShort:
      Number.isFinite(previousClose) &&
      previousClose < low &&
      currentClose < low,
    high,
    low,
  };
}

function aligned(
  direction,
  value,
  allowFlat = false
) {
  if (direction === 'LONG') {
    return allowFlat
      ? value >= 0
      : value > 0;
  }

  return allowFlat
    ? value <= 0
    : value < 0;
}

function favorableMomentum(
  direction,
  momentum
) {
  return direction === 'SHORT'
    ? -Number(momentum || 0)
    : Number(momentum || 0);
}

function regimeAligned(
  direction,
  regime
) {
  return (
    regime?.direction === direction
  );
}

function oppositeRegime(
  direction,
  regime
) {
  return (
    regime?.direction &&
    regime.direction !== 'NEUTRAL' &&
    regime.direction !== direction
  );
}

function fail(
  strategy,
  reason,
  score = 0,
  extra = {}
) {
  return {
    eligible: false,
    score,
    reason: `${strategy}: ${reason}`,
    strategy,
    ...extra,
  };
}

function pass(
  strategy,
  score,
  extra = {}
) {
  return {
    eligible: true,
    score: Math.min(
      10,
      Number(score)
    ),
    reason: null,
    strategy,
    ...extra,
  };
}

function strategyPriority(strategy) {
  switch (strategy) {
    case 'EQUITY_VWAP_PULLBACK_V20':
      return 0.65;
    case 'EQUITY_ORB_V20':
      return 0.55;
    case 'EQUITY_TREND_CONTINUATION_V20':
      return 0.45;
    case 'EQUITY_FAST_SCALP_V20':
      return 0.15;
    default:
      return 0;
  }
}

function buildContext({
  asset,
  snapshot,
  bars,
  marketRegime,
  config,
  now,
}) {
  const all = mergeCurrentMinuteBar(
    bars || [],
    snapshot
  );

  const signalBars = completedBars(
    all,
    now
  );

  const price = currentPrice(
    snapshot,
    all
  );

  const session = sessionBarsET(
    signalBars,
    now
  );

  const sessionVwap = vwap(session);

  const momentum =
    minuteMomentumPct(snapshot);

  const spread =
    spreadPct(snapshot);

  const trend3 =
    trendPct(signalBars, 3);

  const trend5 =
    trendPct(signalBars, 5);

  const trend15 =
    trendPct(signalBars, 15);

  const recentVolume =
    volumeRatio(signalBars, 12);

  const atr =
    atrAbsolute(signalBars, 14);

  const atrPercent =
    atrPct(signalBars, 14);

  const dayMove =
    equityDayMovePct(snapshot);

  const dollarVolume =
    dailyDollarVolume(snapshot);

  return {
    asset,
    snapshot,
    all,
    signalBars,
    session,
    price,
    sessionVwap,
    momentum,
    spread,
    trend3,
    trend5,
    trend15,
    recentVolume,
    atr,
    atrPct: atrPercent,
    dayMovePct: dayMove,
    dollarVolume,
    marketRegime,
    config,
    now,
    minutesET:
      etParts(now).minutes,
  };
}

function commonReady(
  ctx,
  strategy,
  minBars = 18
) {
  if (
    !ctx.asset ||
    !ctx.snapshot
  ) {
    return fail(
      strategy,
      'missing asset or snapshot'
    );
  }

  if (
    ctx.signalBars.length <
      Number(minBars)
  ) {
    return fail(
      strategy,
      'not enough completed 1-minute bars',
      1
    );
  }

  if (
    !Number.isFinite(ctx.price) ||
    ctx.price <= 0
  ) {
    return fail(
      strategy,
      'invalid current price'
    );
  }

  if (ctx.momentum == null) {
    return fail(
      strategy,
      'minute momentum unavailable',
      1
    );
  }

  if (ctx.spread == null) {
    return fail(
      strategy,
      'spread unavailable',
      1
    );
  }

  const maxSpread = Number(
    ctx.config
      .equityV20MaxSpreadPct ??
    0.08
  );

  if (ctx.spread > maxSpread) {
    return fail(
      strategy,
      `spread ${ctx.spread.toFixed(3)}% > ${maxSpread}%`,
      3,
      {
        spreadPct:
          Number(
            ctx.spread.toFixed(4)
          ),
      }
    );
  }

  return null;
}

function shortAllowed(
  direction,
  asset
) {
  return (
    direction !== 'SHORT' ||
    (
      asset?.shortable === true &&
      asset?.easy_to_borrow === true
    )
  );
}

function baseDetail(
  ctx,
  direction,
  trigger,
  components,
  extra = {}
) {
  return {
    components,
    trigger,
    earlyEntry: false,
    earlyEntryConfirmed: false,
    trend5Pct:
      Number(
        ctx.trend5.toFixed(4)
      ),
    trend15Pct:
      Number(
        ctx.trend15.toFixed(4)
      ),
    minuteMomentumPct:
      Number(
        ctx.momentum.toFixed(4)
      ),
    recentVolumeRatio:
      Number(
        ctx.recentVolume.toFixed(3)
      ),
    spreadPct:
      Number(
        ctx.spread.toFixed(4)
      ),
    vwap:
      Number.isFinite(
        ctx.sessionVwap
      )
        ? Number(
            ctx.sessionVwap
              .toFixed(6)
          )
        : null,
    dayMovePct:
      Number(
        ctx.dayMovePct.toFixed(4)
      ),
    dollarVolume:
      Math.round(
        ctx.dollarVolume
      ),
    regime:
      ctx.marketRegime,
    direction,
    ...extra,
  };
}

function makeExitPlan(
  ctx,
  {
    minStop,
    maxStop,
    atrMultiplier,
    minTakeProfit,
    rewardRisk,
    trailTriggerR,
    trailDistanceR,
    trailFloor,
    maxHoldMinutes,
    breakoutFailureWindowMinutes = 0,
    breakoutFailureAtr = 0,
  }
) {
  const cost = Math.max(
    0,
    Number(
      ctx.config
        .equityV20EstimatedRoundTripCostPct ??
      0.02
    )
  );

  const stop = clamp(
    Math.max(
      Number(minStop),
      ctx.atrPct *
        Number(atrMultiplier)
    ),
    Number(minStop),
    Number(maxStop)
  );

  const takeProfit = Math.max(
    Number(minTakeProfit),
    cost +
      Number(rewardRisk) *
        (stop + cost)
  );

  const trailDistancePct = Math.max(
    0.08,
    stop *
      Number(trailDistanceR)
  );

  const trailFloorPct = Math.max(
    Number(trailFloor),
    cost + 0.03
  );

  const trailTriggerPct = Math.max(
    stop *
      Number(trailTriggerR),
    trailFloorPct +
      trailDistancePct
  );

  return {
    atrPct:
      Number(
        ctx.atrPct.toFixed(4)
      ),
    stopLossPct:
      Number(stop.toFixed(4)),
    takeProfitPct:
      Number(
        takeProfit.toFixed(4)
      ),
    estimatedRoundTripCostPct:
      Number(cost.toFixed(4)),
    netRewardRiskRatio:
      Number(
        Number(rewardRisk)
          .toFixed(3)
      ),
    trailTriggerPct:
      Number(
        trailTriggerPct
          .toFixed(4)
      ),
    trailDistancePct:
      Number(
        trailDistancePct
          .toFixed(4)
      ),
    trailFloorPct:
      Number(
        trailFloorPct
          .toFixed(4)
      ),
    breakoutFailureWindowMinutes:
      Number(
        breakoutFailureWindowMinutes
      ),
    breakoutFailureAtr:
      Number(
        breakoutFailureAtr
      ),
    maxHoldMinutes:
      Number(
        maxHoldMinutes
      ),
  };
}

function evaluateOrb(
  ctx,
  direction
) {
  const strategy =
    'EQUITY_ORB_V20';

  const common =
    commonReady(ctx, strategy, 6);

  if (common) return common;

  if (
    !shortAllowed(
      direction,
      ctx.asset
    )
  ) {
    return fail(
      strategy,
      'stock is not easy-to-borrow shortable',
      1
    );
  }

  const start = Number(
    ctx.config
      .equityV20OrbStartMinutesET ??
    575
  );
  const end = Number(
    ctx.config
      .equityV20OrbEndMinutesET ??
    645
  );

  if (
    ctx.minutesET < start ||
    ctx.minutesET > end
  ) {
    return fail(
      strategy,
      'outside ORB time window',
      1
    );
  }

  const orb = openingRange(
    ctx.signalBars,
    ctx.now,
    Number(
      ctx.config
        .equityV20OrbMinutes ??
      5
    )
  );

  if (!orb.available) {
    return fail(
      strategy,
      'opening range not available yet',
      2
    );
  }

  const breakout =
    direction === 'LONG'
      ? orb.long
      : orb.short;

  const confirmed =
    direction === 'LONG'
      ? orb.confirmedLong
      : orb.confirmedShort;

  if (!breakout) {
    return fail(
      strategy,
      'price has not broken the opening range',
      3,
      {
        openingRange: orb,
      }
    );
  }

  const momentum =
    favorableMomentum(
      direction,
      ctx.momentum
    );

  const minMomentum =
    Number(
      ctx.config
        .equityV20OrbMinMomentumPct ??
      0.025
    );

  if (
    momentum < minMomentum
  ) {
    return fail(
      strategy,
      `breakout momentum ${momentum.toFixed(3)}% below ${minMomentum}%`,
      5,
      baseDetail(
        ctx,
        direction,
        'orb',
        {},
        {
          openingRange: orb,
        }
      )
    );
  }

  const minVolume =
    Number(
      ctx.config
        .equityV20OrbMinVolumeRatio ??
      1.0
    );

  if (
    ctx.recentVolume <
    minVolume
  ) {
    return fail(
      strategy,
      `relative volume ${ctx.recentVolume.toFixed(2)}x below ${minVolume.toFixed(2)}x`,
      5.5,
      baseDetail(
        ctx,
        direction,
        'orb',
        {},
        {
          openingRange: orb,
        }
      )
    );
  }

  const level =
    direction === 'LONG'
      ? orb.high
      : orb.low;

  const breakoutDistanceAtr =
    (
      Number.isFinite(ctx.atr) &&
      ctx.atr > 0
    )
      ? Math.abs(
          ctx.price - level
        ) /
        ctx.atr
      : Infinity;

  const maxBreakoutAtr =
    Number(
      ctx.config
        .equityV20OrbMaxBreakoutAtr ??
      0.75
    );

  if (
    breakoutDistanceAtr >
    maxBreakoutAtr
  ) {
    return fail(
      strategy,
      `late ORB chase ${breakoutDistanceAtr.toFixed(2)} ATR`,
      5,
      baseDetail(
        ctx,
        direction,
        'orb',
        {},
        {
          openingRange: orb,
          breakoutLevel: level,
          breakoutDistanceAtr:
            Number(
              breakoutDistanceAtr
                .toFixed(3)
            ),
        }
      )
    );
  }

  const strongMomentum =
    Number(
      ctx.config
        .equityV20OrbStrongMomentumPct ??
      0.060
    );

  if (
    oppositeRegime(
      direction,
      ctx.marketRegime
    ) &&
    (
      momentum <
        strongMomentum ||
      ctx.recentVolume < 1.25
    )
  ) {
    return fail(
      strategy,
      'counter-regime ORB lacks strong momentum/volume',
      6,
      baseDetail(
        ctx,
        direction,
        'orb',
        {},
        {
          openingRange: orb,
        }
      )
    );
  }

  const components = {
    breakout:
      confirmed ? 2 : 1,
    momentum:
      momentum >=
        strongMomentum
        ? 1.5
        : 1,
    volume:
      ctx.recentVolume >=
        1.40
        ? 1.5
        : 1,
    trend:
      aligned(
        direction,
        ctx.trend5
      )
        ? 1
        : 0,
    regime:
      regimeAligned(
        direction,
        ctx.marketRegime
      )
        ? 1
        : 0.25,
    spread:
      ctx.spread <= 0.04
        ? 1
        : 0.5,
  };

  const score =
    3 +
    Object.values(
      components
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const exitPlan = makeExitPlan(
    ctx,
    {
      minStop: 0.28,
      maxStop: 0.80,
      atrMultiplier: 0.95,
      minTakeProfit: 0.62,
      rewardRisk: 1.55,
      trailTriggerR: 0.85,
      trailDistanceR: 0.38,
      trailFloor: 0.14,
      maxHoldMinutes: 25,
      breakoutFailureWindowMinutes: 7,
      breakoutFailureAtr: 0.12,
    }
  );

  return pass(
    strategy,
    score,
    baseDetail(
      ctx,
      direction,
      'orb',
      components,
      {
        openingRange: orb,
        breakoutType:
          confirmed
            ? 'ORB_CONFIRMED_V20'
            : 'ORB_V20',
        breakoutLevel: level,
        breakoutDistanceAtr:
          Number(
            breakoutDistanceAtr
              .toFixed(3)
          ),
        exitPlan,
      }
    )
  );
}

function evaluateVwapPullback(
  ctx,
  direction
) {
  const strategy =
    'EQUITY_VWAP_PULLBACK_V20';

  const common =
    commonReady(ctx, strategy, 12);

  if (common) return common;

  if (
    !shortAllowed(
      direction,
      ctx.asset
    )
  ) {
    return fail(
      strategy,
      'stock is not easy-to-borrow shortable',
      1
    );
  }

  const start = Number(
    ctx.config
      .equityV20VwapStartMinutesET ??
    585
  );
  const end = Number(
    ctx.config
      .equityV20VwapEndMinutesET ??
    930
  );

  if (
    ctx.minutesET < start ||
    ctx.minutesET > end
  ) {
    return fail(
      strategy,
      'outside VWAP pullback time window',
      1
    );
  }

  if (
    !Number.isFinite(
      ctx.sessionVwap
    ) ||
    ctx.sessionVwap <= 0
  ) {
    return fail(
      strategy,
      'session VWAP unavailable',
      2
    );
  }

  const trend15Aligned =
    aligned(
      direction,
      ctx.trend15
    );

  const trend5Support =
    aligned(
      direction,
      ctx.trend5,
      true
    );

  if (
    !trend15Aligned ||
    !trend5Support
  ) {
    return fail(
      strategy,
      '5m/15m trend does not support the pullback',
      4,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const priceAligned =
    direction === 'LONG'
      ? ctx.price >
        ctx.sessionVwap
      : ctx.price <
        ctx.sessionVwap;

  if (!priceAligned) {
    return fail(
      strategy,
      'price has not reclaimed the favorable side of VWAP',
      5,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const touchPct = Number(
    ctx.config
      .equityV20VwapTouchPct ??
    0.18
  );

  const recentBars =
    ctx.signalBars.slice(-4);

  const touched = recentBars.some(
    (bar) => {
      if (
        direction === 'LONG'
      ) {
        const low = l(bar);

        return (
          Number.isFinite(low) &&
          low <=
            ctx.sessionVwap *
              (
                1 +
                touchPct / 100
              )
        );
      }

      const high = h(bar);

      return (
        Number.isFinite(high) &&
        high >=
          ctx.sessionVwap *
            (
              1 -
              touchPct / 100
            )
      );
    }
  );

  if (!touched) {
    return fail(
      strategy,
      `no recent VWAP touch within ${touchPct}%`,
      5.5,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const distancePct =
    Math.abs(
      (
        ctx.price -
        ctx.sessionVwap
      ) /
      ctx.sessionVwap
    ) *
    100;

  const maxDistance =
    Number(
      ctx.config
        .equityV20VwapMaxDistancePct ??
      0.45
    );

  if (
    distancePct >
    maxDistance
  ) {
    return fail(
      strategy,
      `VWAP reclaim already ${distancePct.toFixed(3)}% extended`,
      5,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const momentum =
    favorableMomentum(
      direction,
      ctx.momentum
    );

  const minMomentum =
    Number(
      ctx.config
        .equityV20VwapMinMomentumPct ??
      0.012
    );

  if (
    momentum < minMomentum
  ) {
    return fail(
      strategy,
      `reclaim momentum ${momentum.toFixed(3)}% below ${minMomentum}%`,
      6,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const minVolume =
    Number(
      ctx.config
        .equityV20VwapMinVolumeRatio ??
      0.80
    );

  if (
    ctx.recentVolume <
    minVolume
  ) {
    return fail(
      strategy,
      `relative volume ${ctx.recentVolume.toFixed(2)}x below ${minVolume.toFixed(2)}x`,
      6,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  if (
    oppositeRegime(
      direction,
      ctx.marketRegime
    ) &&
    (
      Math.abs(
        ctx.trend15
      ) < 0.15 ||
      momentum < 0.035
    )
  ) {
    return fail(
      strategy,
      'counter-regime VWAP reclaim is not strong enough',
      6.5,
      baseDetail(
        ctx,
        direction,
        'vwap_pullback',
        {}
      )
    );
  }

  const components = {
    trend15: 1.5,
    trend5:
      aligned(
        direction,
        ctx.trend5
      )
        ? 1
        : 0.5,
    touch: 1.5,
    reclaim: 1.5,
    momentum:
      momentum >= 0.04
        ? 1
        : 0.5,
    volume:
      ctx.recentVolume >= 1.2
        ? 1
        : 0.5,
    regime:
      regimeAligned(
        direction,
        ctx.marketRegime
      )
        ? 1
        : 0.25,
    spread:
      ctx.spread <= 0.04
        ? 1
        : 0.5,
  };

  const score =
    2 +
    Object.values(
      components
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const exitPlan = makeExitPlan(
    ctx,
    {
      minStop: 0.25,
      maxStop: 0.72,
      atrMultiplier: 0.90,
      minTakeProfit: 0.55,
      rewardRisk: 1.50,
      trailTriggerR: 0.85,
      trailDistanceR: 0.38,
      trailFloor: 0.12,
      maxHoldMinutes: 30,
    }
  );

  return pass(
    strategy,
    score,
    baseDetail(
      ctx,
      direction,
      'vwap_pullback',
      components,
      {
        vwapDistancePct:
          Number(
            distancePct
              .toFixed(4)
          ),
        breakoutType:
          'VWAP_RECLAIM_V20',
        breakoutLevel:
          Number(
            ctx.sessionVwap
              .toFixed(6)
          ),
        breakoutDistanceAtr:
          null,
        openingRange: null,
        exitPlan,
      }
    )
  );
}

function evaluateContinuation(
  ctx,
  direction
) {
  const strategy =
    'EQUITY_TREND_CONTINUATION_V20';

  const common =
    commonReady(ctx, strategy, 18);

  if (common) return common;

  if (
    !shortAllowed(
      direction,
      ctx.asset
    )
  ) {
    return fail(
      strategy,
      'stock is not easy-to-borrow shortable',
      1
    );
  }

  const start = Number(
    ctx.config
      .equityV20ContinuationStartMinutesET ??
    600
  );
  const end = Number(
    ctx.config
      .equityV20ContinuationEndMinutesET ??
    945
  );

  if (
    ctx.minutesET < start ||
    ctx.minutesET > end
  ) {
    return fail(
      strategy,
      'outside continuation time window',
      1
    );
  }

  if (
    !aligned(
      direction,
      ctx.trend5
    ) ||
    !aligned(
      direction,
      ctx.trend15
    )
  ) {
    return fail(
      strategy,
      '5m and 15m trends are not aligned',
      4,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  if (
    !Number.isFinite(
      ctx.sessionVwap
    ) ||
    ctx.sessionVwap <= 0
  ) {
    return fail(
      strategy,
      'session VWAP unavailable',
      2
    );
  }

  const vwapAligned =
    direction === 'LONG'
      ? ctx.price >
        ctx.sessionVwap
      : ctx.price <
        ctx.sessionVwap;

  if (!vwapAligned) {
    return fail(
      strategy,
      'price is on the wrong side of VWAP for continuation',
      5,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  const momentum =
    favorableMomentum(
      direction,
      ctx.momentum
    );

  const minMomentum =
    Number(
      ctx.config
        .equityV20ContinuationMinMomentumPct ??
      0.015
    );

  if (
    momentum < minMomentum
  ) {
    return fail(
      strategy,
      `continuation momentum ${momentum.toFixed(3)}% below ${minMomentum}%`,
      5.5,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  const minVolume =
    Number(
      ctx.config
        .equityV20ContinuationMinVolumeRatio ??
      0.90
    );

  if (
    ctx.recentVolume <
    minVolume
  ) {
    return fail(
      strategy,
      `relative volume ${ctx.recentVolume.toFixed(2)}x below ${minVolume.toFixed(2)}x`,
      5.5,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  const vwapDistanceAtr =
    (
      Number.isFinite(ctx.atr) &&
      ctx.atr > 0
    )
      ? Math.abs(
          ctx.price -
          ctx.sessionVwap
        ) /
        ctx.atr
      : Infinity;

  const maxVwapAtr =
    Number(
      ctx.config
        .equityV20ContinuationMaxVwapAtr ??
      1.35
    );

  if (
    vwapDistanceAtr >
    maxVwapAtr
  ) {
    return fail(
      strategy,
      `continuation is ${vwapDistanceAtr.toFixed(2)} ATR from VWAP`,
      5,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  const last = ctx.signalBars.at(-1);
  const previous =
    ctx.signalBars.at(-2);

  const lastMove =
    (
      Number.isFinite(o(last)) &&
      Number.isFinite(c(last)) &&
      o(last) > 0
    )
      ? (
          (
            c(last) -
            o(last)
          ) /
          o(last)
        ) *
        100
      : 0;

  const previousMove =
    (
      Number.isFinite(o(previous)) &&
      Number.isFinite(c(previous)) &&
      o(previous) > 0
    )
      ? (
          (
            c(previous) -
            o(previous)
          ) /
          o(previous)
        ) *
        100
      : 0;

  const previousPulledBack =
    direction === 'LONG'
      ? previousMove < 0
      : previousMove > 0;

  const resumed =
    direction === 'LONG'
      ? lastMove > 0
      : lastMove < 0;

  const strongMomentum =
    Number(
      ctx.config
        .equityV20ContinuationStrongMomentumPct ??
      0.045
    );

  if (
    !(
      previousPulledBack &&
      resumed
    ) &&
    momentum <
      strongMomentum
  ) {
    return fail(
      strategy,
      'no pullback/resumption and live momentum is not strong',
      6,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  if (
    oppositeRegime(
      direction,
      ctx.marketRegime
    ) &&
    (
      momentum <
        strongMomentum ||
      ctx.recentVolume < 1.20
    )
  ) {
    return fail(
      strategy,
      'counter-regime continuation lacks strong momentum/volume',
      6.5,
      baseDetail(
        ctx,
        direction,
        'trend_continuation',
        {}
      )
    );
  }

  const components = {
    trend15: 1.5,
    trend5: 1.5,
    vwap: 1,
    momentum:
      momentum >=
        strongMomentum
        ? 1.5
        : 1,
    volume:
      ctx.recentVolume >= 1.30
        ? 1.5
        : 1,
    resumption:
      previousPulledBack &&
      resumed
        ? 1
        : 0.5,
    regime:
      regimeAligned(
        direction,
        ctx.marketRegime
      )
        ? 1
        : 0.25,
    spread:
      ctx.spread <= 0.04
        ? 1
        : 0.5,
  };

  const score =
    1.5 +
    Object.values(
      components
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const exitPlan = makeExitPlan(
    ctx,
    {
      minStop: 0.30,
      maxStop: 0.85,
      atrMultiplier: 1.00,
      minTakeProfit: 0.62,
      rewardRisk: 1.55,
      trailTriggerR: 0.90,
      trailDistanceR: 0.40,
      trailFloor: 0.14,
      maxHoldMinutes: 35,
    }
  );

  return pass(
    strategy,
    score,
    baseDetail(
      ctx,
      direction,
      'trend_continuation',
      components,
      {
        breakoutType:
          'TREND_CONTINUATION_V20',
        breakoutLevel: null,
        breakoutDistanceAtr: null,
        vwapDistanceAtr:
          Number(
            vwapDistanceAtr
              .toFixed(3)
          ),
        openingRange: null,
        exitPlan,
      }
    )
  );
}

function evaluateFastScalp(
  ctx,
  direction,
  mode
) {
  const strategy =
    'EQUITY_FAST_SCALP_V20';

  if (
    ctx.config
      .equityFastScalpEnabled !==
      true
  ) {
    return null;
  }

  if (mode !== 'paper') {
    return fail(
      strategy,
      'PAPER-only fast scalp is disabled in LIVE',
      0
    );
  }

  const common =
    commonReady(ctx, strategy, 6);

  if (common) return common;

  if (
    !shortAllowed(
      direction,
      ctx.asset
    )
  ) {
    return fail(
      strategy,
      'stock is not easy-to-borrow shortable',
      1
    );
  }

  const start = Number(
    ctx.config
      .equityFastScalpStartMinutesET ??
    575
  );
  const end = Number(
    ctx.config
      .equityFastScalpEndMinutesET ??
    950
  );

  if (
    ctx.minutesET < start ||
    ctx.minutesET > end
  ) {
    return fail(
      strategy,
      'outside Fast Scalp time window',
      1
    );
  }

  const maxSpread = Number(
    ctx.config
      .equityFastScalpMaxSpreadPct ??
    0.06
  );

  if (
    ctx.spread >
    maxSpread
  ) {
    return fail(
      strategy,
      `spread ${ctx.spread.toFixed(3)}% > ${maxSpread}%`,
      4,
      baseDetail(
        ctx,
        direction,
        'fast_equity_scalp',
        {}
      )
    );
  }

  const minDollarVolume =
    Number(
      ctx.config
        .equityFastScalpMinDollarVolume ??
      10000000
    );

  if (
    ctx.dollarVolume <
    minDollarVolume
  ) {
    return fail(
      strategy,
      `daily dollar volume below $${Math.round(minDollarVolume).toLocaleString()}`,
      4,
      baseDetail(
        ctx,
        direction,
        'fast_equity_scalp',
        {}
      )
    );
  }

  const minVolume =
    Number(
      ctx.config
        .equityFastScalpMinVolumeRatio ??
      0.90
    );

  if (
    ctx.recentVolume <
    minVolume
  ) {
    return fail(
      strategy,
      `relative volume ${ctx.recentVolume.toFixed(2)}x below ${minVolume.toFixed(2)}x`,
      5,
      baseDetail(
        ctx,
        direction,
        'fast_equity_scalp',
        {}
      )
    );
  }

  const estimatedCost =
    Math.max(
      0,
      Number(
        ctx.config
          .equityFastScalpEstimatedRoundTripCostPct ??
        0.05
      )
    );

  const profitBuffer =
    Math.max(
      0,
      Number(
        ctx.config
          .equityFastScalpProfitBufferPct ??
        0.08
      )
    );

  const entryFloor =
    Math.max(
      0.01,
      Number(
        ctx.config
          .equityFastScalpEntryMomentumPct ??
        0.18
      )
    );

  const requiredImpulse =
    Math.max(
      entryFloor,
      estimatedCost +
        ctx.spread +
        profitBuffer
    );

  const momentum =
    favorableMomentum(
      direction,
      ctx.momentum
    );

  if (
    momentum <
    requiredImpulse
  ) {
    return fail(
      strategy,
      `impulse ${momentum.toFixed(3)}% below cost-aware ${requiredImpulse.toFixed(3)}%`,
      6,
      baseDetail(
        ctx,
        direction,
        'fast_equity_scalp',
        {},
        {
          requiredImpulsePct:
            Number(
              requiredImpulse
                .toFixed(4)
            ),
        }
      )
    );
  }

  const components = {
    impulse:
      momentum >=
        requiredImpulse +
          0.12
        ? 2
        : 1.5,
    spread:
      ctx.spread <= 0.03
        ? 1.5
        : 1,
    volume:
      ctx.recentVolume >= 1.2
        ? 1.5
        : 1,
    localTrend:
      aligned(
        direction,
        ctx.trend3
      )
        ? 1.5
        : 0.5,
    regime:
      regimeAligned(
        direction,
        ctx.marketRegime
      )
        ? 1
        : 0.25,
  };

  const score =
    3.5 +
    Object.values(
      components
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const exitPlan = {
    atrPct:
      Number(
        ctx.atrPct.toFixed(4)
      ),
    stopLossPct:
      Number(
        Number(
          ctx.config
            .equityFastScalpStopLossPct ??
          0.25
        ).toFixed(4)
      ),
    takeProfitPct:
      Number(
        Number(
          ctx.config
            .equityFastScalpTakeProfitPct ??
          0.55
        ).toFixed(4)
      ),
    estimatedRoundTripCostPct:
      Number(
        estimatedCost.toFixed(4)
      ),
    netRewardRiskRatio: null,
    trailTriggerPct:
      Number(
        Number(
          ctx.config
            .equityFastScalpTrailTriggerPct ??
          0.32
        ).toFixed(4)
      ),
    trailDistancePct:
      Number(
        Number(
          ctx.config
            .equityFastScalpTrailDistancePct ??
          0.10
        ).toFixed(4)
      ),
    trailFloorPct:
      Number(
        Number(
          ctx.config
            .equityFastScalpTrailFloorPct ??
          0.18
        ).toFixed(4)
      ),
    breakoutFailureWindowMinutes:
      0,
    breakoutFailureAtr:
      0,
    maxHoldMinutes:
      Number(
        ctx.config
          .equityFastScalpMaxHoldMinutes ??
        5
      ),
  };

  return pass(
    strategy,
    score,
    {
      ...baseDetail(
        ctx,
        direction,
        'fast_equity_scalp',
        components,
        {
          requiredImpulsePct:
            Number(
              requiredImpulse
                .toFixed(4)
            ),
          breakoutType:
            'FAST_EQUITY_SCALP_1M',
          breakoutLevel: null,
          breakoutDistanceAtr: null,
          openingRange: null,
          exitPlan,
        }
      ),
      earlyEntry: true,
      earlyEntryConfirmed: true,
    }
  );
}

function bestDiagnostic(
  details
) {
  const good = details
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.score || 0) -
        Number(a.score || 0)
    );

  return good[0] || null;
}

function makeSignal(
  asset,
  direction,
  detail,
  price
) {
  return {
    symbol: asset.symbol,
    name:
      asset.name ||
      asset.symbol,
    assetClass:
      'us_equity',
    fractionable:
      asset.fractionable === true,
    direction,
    score:
      detail.score,
    price,
    strategy:
      detail.strategy,
    signal: detail,
  };
}

export function equityPrefilterQuality({
  snapshot,
  momentum,
  dollarVolume,
  spread,
  config = EQUITY_V20_DEFAULTS,
}) {
  const merged = {
    ...EQUITY_V20_DEFAULTS,
    ...config,
  };

  const move =
    equityDayMovePct(snapshot);

  const m =
    Math.abs(
      Number(momentum || 0)
    );

  const dv = Math.max(
    0,
    Number(dollarVolume || 0)
  );

  const s =
    spread == null
      ? Number(
          merged
            .equityV20PrefilterMaxSpreadPct
        )
      : Number(spread);

  const liquidity =
    Math.log10(
      Math.max(
        1,
        dv / 1000000
      ) +
      1
    );

  const momentumScore =
    Math.min(
      3,
      m / 0.04
    );

  const dayMoveScore =
    Math.min(
      2,
      Math.abs(move) / 0.75
    );

  const liquidityScore =
    Math.min(
      2,
      liquidity
    );

  const spreadLimit =
    Number(
      merged
        .equityV20PrefilterMaxSpreadPct ??
      0.12
    );

  const spreadScore =
    Math.max(
      0,
      2 *
        (
          1 -
          s /
            Math.max(
              0.001,
              spreadLimit
            )
        )
    );

  return {
    quality:
      Number(
        (
          momentumScore +
          dayMoveScore +
          liquidityScore +
          spreadScore
        ).toFixed(4)
      ),
    dayMovePct:
      Number(
        move.toFixed(4)
      ),
  };
}

export function evaluateEquityCandidateV20({
  asset,
  snapshot,
  bars,
  marketRegime,
  config = {},
  now = new Date(),
  mode = 'paper',
}) {
  const merged = {
    ...EQUITY_V20_DEFAULTS,
    ...config,
  };

  const ctx = buildContext({
    asset,
    snapshot,
    bars,
    marketRegime,
    config: merged,
    now,
  });

  if (
    !asset ||
    !snapshot
  ) {
    const detail = fail(
      'EQUITY_V20',
      'missing asset or snapshot'
    );

    return {
      signal: null,
      diagnostics: {
        long: detail,
        short: detail,
        threshold:
          Number(
            merged
              .equityV20ScoreThreshold
          ),
      },
    };
  }

  const threshold = Number(
    merged
      .equityV20ScoreThreshold ??
    7.5
  );

  const byDirection = {
    LONG: [],
    SHORT: [],
  };

  for (const direction of [
    'LONG',
    'SHORT',
  ]) {
    byDirection[
      direction
    ].push(
      evaluateOrb(
        ctx,
        direction
      ),
      evaluateVwapPullback(
        ctx,
        direction
      ),
      evaluateContinuation(
        ctx,
        direction
      )
    );

    const scalp =
      evaluateFastScalp(
        ctx,
        direction,
        mode
      );

    if (scalp) {
      byDirection[
        direction
      ].push(
        scalp
      );
    }
  }

  const eligible = [];

  for (const direction of [
    'LONG',
    'SHORT',
  ]) {
    for (
      const detail of
      byDirection[
        direction
      ]
    ) {
      if (
        detail?.eligible &&
        Number(detail.score) >=
          threshold
      ) {
        eligible.push({
          direction,
          detail,
          selectionScore:
            Number(
              detail.score
            ) +
            strategyPriority(
              detail.strategy
            ),
        });
      }
    }
  }

  eligible.sort(
    (a, b) =>
      b.selectionScore -
      a.selectionScore
  );

  const chosen =
    eligible[0] ||
    null;

  const longDiagnostic =
    bestDiagnostic(
      byDirection.LONG
    );

  const shortDiagnostic =
    bestDiagnostic(
      byDirection.SHORT
    );

  if (
    !chosen ||
    !Number.isFinite(
      ctx.price
    ) ||
    ctx.price <= 0
  ) {
    return {
      signal: null,
      diagnostics: {
        long:
          longDiagnostic,
        short:
          shortDiagnostic,
        threshold,
        alternatives: {
          long:
            byDirection.LONG,
          short:
            byDirection.SHORT,
        },
      },
    };
  }

  return {
    signal:
      makeSignal(
        asset,
        chosen.direction,
        chosen.detail,
        ctx.price
      ),
    diagnostics: {
      long:
        longDiagnostic,
      short:
        shortDiagnostic,
      threshold,
      alternatives: {
        long:
          byDirection.LONG,
        short:
          byDirection.SHORT,
      },
    },
  };
}
