// STRATEGY ENGINE v19 EXPECTANCY
//
// v19 profitability-focused changes (must still be validated in PAPER):
// - Crypto requires score 8+; low-confidence 7/10 crypto probes are blocked.
// - Tighter spreads and minimum relative-volume quality reduce weak/expensive entries.
// - Missing spread data is rejected instead of receiving a free score point.
// - 5m counter-trend entries require a confirmed breakout.
// - Neutral BTC regime requires a confirmed crypto breakout.
// - Crypto exits are cost-aware for Alpaca's maker/taker fee environment.
// - Trailing floors are designed not to lock a gross gain smaller than estimated costs.
// - Failed breakouts can be invalidated early instead of always waiting for the full stop.
//
// No strategy guarantees profit. Validate with real Alpaca PAPER fills before LIVE.

export const STRATEGY_DEFAULTS = {
  equityScoreThreshold: 7,
  cryptoScoreThreshold: 8,

  // PAPER-only 1-minute crypto Fast Scalp.
  // It buys strong upward impulses, never opens a crypto short, and
  // uses a separate reversal monitor to exit back to cash quickly.
  fastScalpEnabled: false,
  fastScalpScoreThreshold: 8,
  fastScalpEntryMomentumPct: 0.65,
  fastScalpMaxSpreadPct: 0.12,
  fastScalpEstimatedRoundTripCostPct: 0.50,
  fastScalpProfitBufferPct: 0.12,
  fastScalpStopLossPct: 0.45,
  fastScalpTakeProfitPct: 1.10,
  fastScalpTrailTriggerPct: 0.70,
  fastScalpTrailDistancePct: 0.18,
  fastScalpTrailFloorPct: 0.55,
  fastScalpMaxHoldMinutes: 6,
  fastScalpReversalMomentumPct: -0.08,
  fastScalpFadeMomentumPct: 0.02,
  fastScalpCostLockPct: 0.60,

  maxDetailedEquities: 24,
  maxDetailedCrypto: 12,

  equityPrefilterMomentumPct: 0.020,
  cryptoPrefilterMomentumPct: 0.035,

  equityMinEntryMomentumPct: 0.015,
  cryptoMinEntryMomentumPct: 0.030,

  equityStrongMomentumPct: 0.060,
  cryptoStrongMomentumPct: 0.100,

  maxEquitySpreadPct: 0.10,
  maxCryptoSpreadPct: 0.25,

  equityCooldownMinutes: 15,
  cryptoCooldownMinutes: 30,

  recentVolumeLookback: 12,
  recentVolumeStrongRatio: 1.40,
  recentVolumeOkayRatio: 1.05,
  equityMinVolumeRatio: 0.95,
  cryptoMinVolumeRatio: 1.05,

  breakoutLookbackBars: 8,
  openingRangeMinutes: 5,

  requireVwapAlignment: true,
  rejectOppositeRegime: true,

  equityMaxVwapDistanceAtr: 1.75,
  cryptoMaxVwapDistanceAtr: 1.75,

  equityMaxBreakoutDistanceAtr: 1.10,
  cryptoMaxBreakoutDistanceAtr: 1.20,

  useEquityTimeWindow: true,

  equityStartMinutesET:
    9 * 60 + 35,

  equityEndMinutesET:
    15 * 60 + 50,

  atrLookbackBars: 14,
  atrMultiplier: 1.20,

  equityMinStopPct: 0.35,
  equityMaxStopPct: 1.00,
  equityMinTakeProfitPct: 0.65,

  cryptoMinStopPct: 0.90,
  cryptoMaxStopPct: 1.60,
  cryptoMinTakeProfitPct: 2.10,

  // Approximate round-trip transaction cost used for sizing and target math.
  // Crypto assumes two Tier-1 taker fills (about 0.25% each).
  equityEstimatedRoundTripCostPct: 0.02,
  cryptoEstimatedRoundTripCostPct: 0.50,

  // Target reward/risk AFTER the estimated round-trip cost.
  equityNetRewardRiskRatio: 1.50,
  cryptoNetRewardRiskRatio: 1.25,

  equityTrailingTriggerR: 0.90,
  equityTrailingDistanceR: 0.45,
  cryptoTrailingTriggerR: 1.20,
  cryptoTrailingDistanceR: 0.45,

  equityTrailFloorPct: 0.05,
  cryptoTrailFloorPct: 0.65,

  breakoutFailureWindowMinutes: 10,
  equityBreakoutFailureAtr: 0.20,
  cryptoBreakoutFailureAtr: 0.25,

  equityMaxHoldMinutes: 35,
  cryptoMaxHoldMinutes: 60,

  closeMomentumStartMinutesET:
    15 * 60 + 30,
};

const ET =
  new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone:
        'America/New_York',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',

      hour:
        '2-digit',

      minute:
        '2-digit',

      hourCycle:
        'h23',
    }
  );

const num = (
  value,
  fallback = 0
) =>
  Number.isFinite(
    Number(
      value
    )
  )
    ? Number(
        value
      )
    : fallback;

const clamp = (
  value,
  low,
  high
) =>
  Math.max(
    low,
    Math.min(
      high,
      value
    )
  );

const avg = (
  values = []
) => {
  const good =
    values.filter(
      Number.isFinite
    );

  return good.length
    ? good.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      ) /
      good.length
    : 0;
};

const t = (
  bar
) =>
  bar?.t ||
  bar?.timestamp ||
  null;

const c = (
  bar
) =>
  num(
    bar?.c,
    NaN
  );

const h = (
  bar
) =>
  num(
    bar?.h,
    NaN
  );

const l = (
  bar
) =>
  num(
    bar?.l,
    NaN
  );

const v = (
  bar
) =>
  num(
    bar?.v,
    0
  );

function etParts(
  value
) {
  const parts =
    Object.fromEntries(
      ET
        .formatToParts(
          value instanceof Date
            ? value
            : new Date(
                value
              )
        )
        .map(
          (
            part
          ) => [
            part.type,
            part.value,
          ]
        )
    );

  return {
    dateKey:
      `${parts.year}-${parts.month}-${parts.day}`,

    minutes:
      Number(
        parts.hour
      ) *
        60 +
      Number(
        parts.minute
      ),
  };
}

function completedBars(
  bars = [],
  now = new Date()
) {
  const minute =
    Math.floor(
      now.getTime() /
      60000
    );

  return bars.filter(
    (
      bar
    ) => {
      const ms =
        t(
          bar
        )
          ? new Date(
              t(
                bar
              )
            ).getTime()
          : NaN;

      return (
        Number.isFinite(
          ms
        ) &&
        Math.floor(
          ms /
          60000
        ) <
          minute
      );
    }
  );
}

function currentPrice(
  snapshot,
  bars = []
) {
  return num(
    snapshot
      ?.latestTrade
      ?.p ??
    snapshot
      ?.minuteBar
      ?.c ??
    bars.at(
      -1
    )
      ?.c ??
    snapshot
      ?.dailyBar
      ?.c,

    NaN
  );
}

export function mergeCurrentMinuteBar(
  bars = [],
  snapshot = null
) {
  const output =
    Array.isArray(
      bars
    )
      ? [
          ...bars,
        ]
      : [];

  const minuteBar =
    snapshot
      ?.minuteBar;

  if (
    !minuteBar ||
    !Number.isFinite(
      Number(
        minuteBar
          ?.c
      )
    )
  ) {
    return output;
  }

  const stamp =
    t(
      minuteBar
    );

  const index =
    stamp
      ? output.findIndex(
          (
            bar
          ) =>
            t(
              bar
            ) ===
            stamp
        )
      : -1;

  if (
    index >= 0
  ) {
    output[
      index
    ] =
      minuteBar;
  } else {
    output.push(
      minuteBar
    );
  }

  output.sort(
    (
      a,
      b
    ) =>
      new Date(
        t(
          a
        ) ||
        0
      ).getTime() -
      new Date(
        t(
          b
        ) ||
        0
      ).getTime()
  );

  return output;
}

export function spreadPct(
  snapshot
) {
  const ask =
    num(
      snapshot
        ?.latestQuote
        ?.ap,
      NaN
    );

  const bid =
    num(
      snapshot
        ?.latestQuote
        ?.bp,
      NaN
    );

  if (
    ![
      ask,
      bid,
    ].every(
      Number.isFinite
    ) ||
    ask <= 0 ||
    bid <= 0 ||
    ask < bid
  ) {
    return null;
  }

  const mid =
    (
      ask +
      bid
    ) /
    2;

  return mid > 0
    ? (
        (
          ask -
          bid
        ) /
        mid
      ) *
        100
    : null;
}

export function minuteMomentumPct(
  snapshot
) {
  const open =
    num(
      snapshot
        ?.minuteBar
        ?.o,
      NaN
    );

  const close =
    num(
      snapshot
        ?.minuteBar
        ?.c ??
      snapshot
        ?.latestTrade
        ?.p,

      NaN
    );

  if (
    !Number.isFinite(
      open
    ) ||
    !Number.isFinite(
      close
    ) ||
    open <= 0
  ) {
    return null;
  }

  return (
    (
      close -
      open
    ) /
    open
  ) *
    100;
}

export function dailyDollarVolume(
  snapshot
) {
  const price =
    num(
      snapshot
        ?.latestTrade
        ?.p ??
      snapshot
        ?.minuteBar
        ?.c ??
      snapshot
        ?.dailyBar
        ?.c,

      0
    );

  return (
    price *
    v(
      snapshot
        ?.dailyBar
    )
  );
}

function trendPct(
  bars,
  lookback
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length <
      lookback +
      1
  ) {
    return 0;
  }

  const current =
    c(
      bars.at(
        -1
      )
    );

  const previous =
    c(
      bars[
        Math.max(
          0,
          bars.length -
            1 -
            lookback
        )
      ]
    );

  if (
    !Number.isFinite(
      current
    ) ||
    !Number.isFinite(
      previous
    ) ||
    previous <= 0
  ) {
    return 0;
  }

  return (
    (
      current -
      previous
    ) /
    previous
  ) *
    100;
}

function volumeRatio(
  bars,
  lookback
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length <
      3
  ) {
    return 0;
  }

  const current =
    v(
      bars.at(
        -1
      )
    );

  const base =
    avg(
      bars
        .slice(
          Math.max(
            0,
            bars.length -
              1 -
              lookback
          ),
          -1
        )
        .map(
          v
        )
        .filter(
          (
            value
          ) =>
            value >
            0
        )
    );

  return base > 0
    ? current /
      base
    : 0;
}

function sessionBarsET(
  bars,
  now = new Date()
) {
  const today =
    etParts(
      now
    ).dateKey;

  return (
    bars ||
    []
  ).filter(
    (
      bar
    ) => {
      if (
        !t(
          bar
        )
      ) {
        return false;
      }

      const parts =
        etParts(
          t(
            bar
          )
        );

      return (
        parts.dateKey ===
          today &&
        parts.minutes >=
          570 &&
        parts.minutes <=
          960
      );
    }
  );
}

function inEquityWindow(
  now,
  config
) {
  if (
    !config
      .useEquityTimeWindow
  ) {
    return true;
  }

  const minutes =
    etParts(
      now
    ).minutes;

  return (
    minutes >=
      Number(
        config
          .equityStartMinutesET
      ) &&
    minutes <=
      Number(
        config
          .equityEndMinutesET
      )
  );
}

function vwap(
  bars = []
) {
  let priceVolume =
    0;

  let totalVolume =
    0;

  for (
    const bar of
    bars
  ) {
    const high =
      h(
        bar
      );

    const low =
      l(
        bar
      );

    const close =
      c(
        bar
      );

    const volume =
      v(
        bar
      );

    if (
      ![
        high,
        low,
        close,
      ].every(
        Number.isFinite
      ) ||
      volume <= 0
    ) {
      continue;
    }

    const typical =
      (
        high +
        low +
        close
      ) /
      3;

    priceVolume +=
      typical *
      volume;

    totalVolume +=
      volume;
  }

  return totalVolume >
    0
    ? priceVolume /
      totalVolume
    : null;
}

function atrAbsolute(
  bars,
  lookback = 14
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length <
      3
  ) {
    return 0;
  }

  const slice =
    bars.slice(
      -(
        lookback +
        1
      )
    );

  const ranges =
    [];

  for (
    let i = 1;
    i <
      slice.length;
    i += 1
  ) {
    const high =
      h(
        slice[
          i
        ]
      );

    const low =
      l(
        slice[
          i
        ]
      );

    const previousClose =
      c(
        slice[
          i -
          1
        ]
      );

    if (
      ![
        high,
        low,
        previousClose,
      ].every(
        Number.isFinite
      )
    ) {
      continue;
    }

    ranges.push(
      Math.max(
        high -
          low,

        Math.abs(
          high -
          previousClose
        ),

        Math.abs(
          low -
          previousClose
        )
      )
    );
  }

  return avg(
    ranges
  );
}

function atrPct(
  bars,
  lookback = 14
) {
  const absolute =
    atrAbsolute(
      bars,
      lookback
    );

  const price =
    c(
      bars?.at(
        -1
      )
    );

  if (
    absolute <= 0 ||
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return 0;
  }

  return (
    absolute /
    price
  ) *
    100;
}

function rollingBreakout(
  bars,
  lookback = 8
) {
  const none = {
    available:
      false,

    long:
      false,

    short:
      false,

    confirmedLong:
      false,

    confirmedShort:
      false,

    high:
      null,

    low:
      null,
  };

  if (
    !Array.isArray(
      bars
    ) ||
    bars.length <
      lookback +
      2
  ) {
    return none;
  }

  const current =
    bars.at(
      -1
    );

  const previous =
    bars.at(
      -2
    );

  const history =
    bars.slice(
      Math.max(
        0,
        bars.length -
          2 -
          lookback
      ),
      -2
    );

  const highs =
    history
      .map(
        h
      )
      .filter(
        Number.isFinite
      );

  const lows =
    history
      .map(
        l
      )
      .filter(
        Number.isFinite
      );

  const currentClose =
    c(
      current
    );

  const previousClose =
    c(
      previous
    );

  if (
    !highs.length ||
    !lows.length ||
    !Number.isFinite(
      currentClose
    )
  ) {
    return none;
  }

  const high =
    Math.max(
      ...highs
    );

  const low =
    Math.min(
      ...lows
    );

  return {
    available:
      true,

    long:
      currentClose >
      high,

    short:
      currentClose <
      low,

    confirmedLong:
      Number.isFinite(
        previousClose
      ) &&
      previousClose >
        high &&
      currentClose >
        high,

    confirmedShort:
      Number.isFinite(
        previousClose
      ) &&
      previousClose <
        low &&
      currentClose <
        low,

    high,
    low,
  };
}

function openingRange(
  bars,
  now,
  minutes = 5
) {
  const none = {
    available:
      false,

    long:
      false,

    short:
      false,

    confirmedLong:
      false,

    confirmedShort:
      false,

    high:
      null,

    low:
      null,
  };

  const session =
    sessionBarsET(
      bars,
      now
    );

  const cutoff =
    570 +
    Number(
      minutes ||
      5
    );

  const opening =
    session.filter(
      (
        bar
      ) =>
        t(
          bar
        ) &&
        etParts(
          t(
            bar
          )
        ).minutes <
          cutoff
    );

  const after =
    session.filter(
      (
        bar
      ) =>
        t(
          bar
        ) &&
        etParts(
          t(
            bar
          )
        ).minutes >=
          cutoff
    );

  if (
    opening.length <
      3 ||
    !after.length
  ) {
    return none;
  }

  const highs =
    opening
      .map(
        h
      )
      .filter(
        Number.isFinite
      );

  const lows =
    opening
      .map(
        l
      )
      .filter(
        Number.isFinite
      );

  if (
    !highs.length ||
    !lows.length
  ) {
    return none;
  }

  const high =
    Math.max(
      ...highs
    );

  const low =
    Math.min(
      ...lows
    );

  const currentClose =
    c(
      after.at(
        -1
      )
    );

  const previousClose =
    c(
      after.at(
        -2
      )
    );

  return {
    available:
      Number.isFinite(
        currentClose
      ),

    long:
      Number.isFinite(
        currentClose
      ) &&
      currentClose >
        high,

    short:
      Number.isFinite(
        currentClose
      ) &&
      currentClose <
        low,

    confirmedLong:
      Number.isFinite(
        previousClose
      ) &&
      previousClose >
        high &&
      currentClose >
        high,

    confirmedShort:
      Number.isFinite(
        previousClose
      ) &&
      previousClose <
        low &&
      currentClose <
        low,

    high,
    low,
  };
}

function exitPlan(
  assetClass,
  bars,
  config
) {
  const atr =
    atrPct(
      bars,
      Number(
        config
          .atrLookbackBars ||
        14
      )
    );

  const multiplier =
    Number(
      config
        .atrMultiplier ||
      1.20
    );

  const crypto =
    assetClass ===
    'crypto';

  const minStop =
    Number(
      crypto
        ? config
            .cryptoMinStopPct
        : config
            .equityMinStopPct
    );

  const maxStop =
    Number(
      crypto
        ? config
            .cryptoMaxStopPct
        : config
            .equityMaxStopPct
    );

  const minTakeProfit =
    Number(
      crypto
        ? config
            .cryptoMinTakeProfitPct
        : config
            .equityMinTakeProfitPct
    );

  const estimatedRoundTripCostPct =
    Math.max(
      0,
      Number(
        crypto
          ? config
              .cryptoEstimatedRoundTripCostPct
          : config
              .equityEstimatedRoundTripCostPct
      ) ||
      0
    );

  const netRewardRiskRatio =
    Math.max(
      0.5,
      Number(
        crypto
          ? config
              .cryptoNetRewardRiskRatio
          : config
              .equityNetRewardRiskRatio
      ) ||
      1.25
    );

  const stop =
    clamp(
      Math.max(
        atr *
          multiplier,

        minStop
      ),

      minStop,
      maxStop
    );

  // Net target math:
  // net win  ~= takeProfit - roundTripCost
  // net loss ~= stop + roundTripCost
  // Require net win / net loss >= configured ratio.
  const costAdjustedTakeProfit =
    estimatedRoundTripCostPct +
    netRewardRiskRatio *
      (
        stop +
        estimatedRoundTripCostPct
      );

  const takeProfit =
    Math.max(
      minTakeProfit,
      costAdjustedTakeProfit
    );

  const trailingTriggerR =
    Number(
      crypto
        ? config
            .cryptoTrailingTriggerR
        : config
            .equityTrailingTriggerR
    );

  const trailingDistanceR =
    Number(
      crypto
        ? config
            .cryptoTrailingDistanceR
        : config
            .equityTrailingDistanceR
    );

  const trailFloorPct =
    Math.max(
      0,
      Number(
        crypto
          ? config
              .cryptoTrailFloorPct
          : config
              .equityTrailFloorPct
      ) ||
      0
    );

  const trailDistancePct =
    stop *
    trailingDistanceR;

  const trailTriggerPct =
    Math.max(
      stop *
        trailingTriggerR,

      trailFloorPct +
        trailDistancePct
    );

  return {
    atrPct:
      Number(
        atr.toFixed(
          4
        )
      ),

    stopLossPct:
      Number(
        stop.toFixed(
          4
        )
      ),

    takeProfitPct:
      Number(
        takeProfit.toFixed(
          4
        )
      ),

    estimatedRoundTripCostPct:
      Number(
        estimatedRoundTripCostPct.toFixed(
          4
        )
      ),

    netRewardRiskRatio:
      Number(
        netRewardRiskRatio.toFixed(
          3
        )
      ),

    trailTriggerPct:
      Number(
        trailTriggerPct.toFixed(
          4
        )
      ),

    trailDistancePct:
      Number(
        trailDistancePct.toFixed(
          4
        )
      ),

    trailFloorPct:
      Number(
        trailFloorPct.toFixed(
          4
        )
      ),

    breakoutFailureWindowMinutes:
      Number(
        config
          .breakoutFailureWindowMinutes ||
        10
      ),

    breakoutFailureAtr:
      Number(
        crypto
          ? config
              .cryptoBreakoutFailureAtr
          : config
              .equityBreakoutFailureAtr
      ),

    maxHoldMinutes:
      Number(
        crypto
          ? config
              .cryptoMaxHoldMinutes
          : config
              .equityMaxHoldMinutes
      ),
  };
}

export function buildEquityMarketRegime(
  spyBars = [],
  qqqBars = []
) {
  const spy5 =
    trendPct(
      spyBars,
      5
    );

  const spy15 =
    trendPct(
      spyBars,
      15
    );

  const qqq5 =
    trendPct(
      qqqBars,
      5
    );

  const qqq15 =
    trendPct(
      qqqBars,
      15
    );

  const values = [
    spy5,
    spy15,
    qqq5,
    qqq15,
  ];

  const longs =
    values.filter(
      (
        value
      ) =>
        value >
        0
    ).length;

  const shorts =
    values.filter(
      (
        value
      ) =>
        value <
        0
    ).length;

  return {
    direction:
      longs >=
      3
        ? 'LONG'
        : shorts >=
            3
          ? 'SHORT'
          : 'NEUTRAL',

    spy5:
      Number(
        spy5.toFixed(
          4
        )
      ),

    spy15:
      Number(
        spy15.toFixed(
          4
        )
      ),

    qqq5:
      Number(
        qqq5.toFixed(
          4
        )
      ),

    qqq15:
      Number(
        qqq15.toFixed(
          4
        )
      ),
  };
}

export function buildCryptoMarketRegime(
  btcBars = []
) {
  const btc5 =
    trendPct(
      btcBars,
      5
    );

  const btc15 =
    trendPct(
      btcBars,
      15
    );

  return {
    direction:
      btc5 >
        0 &&
      btc15 >
        0
        ? 'LONG'
        : btc5 <
            0 &&
          btc15 <
            0
          ? 'SHORT'
          : 'NEUTRAL',

    btc5:
      Number(
        btc5.toFixed(
          4
        )
      ),

    btc15:
      Number(
        btc15.toFixed(
          4
        )
      ),
  };
}

const reject = (
  reason,
  extra = {}
) => ({
  eligible:
    false,

  score:
    0,

  reason,

  ...extra,
});

function scoreDirection({
  direction,
  bars,
  snapshot,
  regime,
  assetClass,
  config,
  now,
}) {
  const all =
    mergeCurrentMinuteBar(
      bars,
      snapshot
    );

  const signalBars =
    completedBars(
      all,
      now
    );

  if (
    signalBars.length <
    18
  ) {
    return reject(
      'not enough completed bar history'
    );
  }

  if (
    assetClass ===
      'us_equity' &&
    !inEquityWindow(
      now,
      config
    )
  ) {
    return reject(
      'outside v18 equity entry window'
    );
  }

  const long =
    direction ===
    'LONG';

  const price =
    currentPrice(
      snapshot,
      all
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return reject(
      'invalid current price'
    );
  }

  const trend5 =
    trendPct(
      signalBars,
      5
    );

  const trend15 =
    trendPct(
      signalBars,
      15
    );

  const aligned5 =
    long
      ? trend5 >
        0
      : trend5 <
        0;

  const aligned15 =
    long
      ? trend15 >
        0
      : trend15 <
        0;

  const momentum =
    minuteMomentumPct(
      snapshot
    );

  const minMomentum =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoMinEntryMomentumPct
        : config
            .equityMinEntryMomentumPct
    );

  const strongMomentum =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoStrongMomentumPct
        : config
            .equityStrongMomentumPct
    );

  if (
    momentum == null ||
    (
      long
        ? momentum <
          minMomentum
        : momentum >
          -minMomentum
    )
  ) {
    return reject(
      `entry momentum below ${minMomentum}% threshold`,
      {
        minuteMomentumPct:
          momentum,

        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),
      }
    );
  }

  const spread =
    spreadPct(
      snapshot
    );

  const maxSpread =
    Number(
      assetClass ===
      'crypto'
        ? config
            .maxCryptoSpreadPct
        : config
            .maxEquitySpreadPct
    );

  if (
    spread == null
  ) {
    return reject(
      'spread unavailable'
    );
  }

  if (
    spread >
      maxSpread
  ) {
    return reject(
      `spread ${spread.toFixed(3)}% > ${maxSpread}%`,
      {
        spreadPct:
          Number(
            spread.toFixed(
              4
            )
          ),
      }
    );
  }

  if (
    config
      .rejectOppositeRegime &&
    regime
      ?.direction &&
    regime.direction !==
      'NEUTRAL' &&
    regime.direction !==
      direction
  ) {
    return reject(
      `market regime is ${regime.direction}`,
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),
      }
    );
  }

  const session =
    assetClass ===
    'us_equity'
      ? sessionBarsET(
          signalBars,
          now
        )
      : signalBars;

  const sessionVwap =
    vwap(
      session
    );

  const vwapAligned =
    Number.isFinite(
      sessionVwap
    ) &&
    (
      long
        ? price >
          sessionVwap
        : price <
          sessionVwap
    );

  if (
    config
      .requireVwapAlignment &&
    !vwapAligned
  ) {
    return reject(
      'price is not aligned with VWAP',
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),
      }
    );
  }

  const recentVolume =
    volumeRatio(
      signalBars,
      Number(
        config
          .recentVolumeLookback
      )
    );

  const minVolumeRatio =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoMinVolumeRatio
        : config
            .equityMinVolumeRatio
    );

  if (
    recentVolume <
    minVolumeRatio
  ) {
    return reject(
      `relative volume ${recentVolume.toFixed(2)}x below ${minVolumeRatio.toFixed(2)}x`,
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),

        recentVolumeRatio:
          Number(
            recentVolume.toFixed(
              3
            )
          ),
      }
    );
  }

  // ========================================
  // v18.1 EARLY ENTRY CONFIRMATION
  // ========================================
  //
  // 15m is no longer an automatic rejection.
  //
  // If the slower 15m trend has NOT aligned yet,
  // require:
  // - 5m trend aligned
  // - strong current momentum
  // - at least acceptable relative volume
  //
  // This allows earlier entries while requiring
  // extra evidence before trading against the
  // slower trend measurement.

  const strongMomentumAligned =
    Math.abs(
      momentum
    ) >=
      strongMomentum;

  const volumeSupport =
    recentVolume >=
    Number(
      config
        .recentVolumeOkayRatio
    );

  const earlyEntryConfirmed =
    aligned5 &&
    strongMomentumAligned &&
    volumeSupport;

  if (
    !aligned15 &&
    !earlyEntryConfirmed
  ) {
    return reject(
      '15m trend not aligned and early-entry confirmation is weak',
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),

        recentVolumeRatio:
          Number(
            recentVolume.toFixed(
              3
            )
          ),
      }
    );
  }

  const rolling =
    rollingBreakout(
      signalBars,
      Number(
        config
          .breakoutLookbackBars
      )
    );

  const orb =
    assetClass ===
    'us_equity'
      ? openingRange(
          signalBars,
          now,
          Number(
            config
              .openingRangeMinutes
          )
        )
      : null;

  const orbAligned =
    Boolean(
      orb
        ?.available
    ) &&
    (
      long
        ? orb.long
        : orb.short
    );

  const orbConfirmed =
    Boolean(
      orb
        ?.available
    ) &&
    (
      long
        ? orb
            .confirmedLong
        : orb
            .confirmedShort
    );

  const rollingAligned =
    long
      ? rolling.long
      : rolling.short;

  const rollingConfirmed =
    long
      ? rolling
          .confirmedLong
      : rolling
          .confirmedShort;

  const breakoutAligned =
    orbAligned ||
    rollingAligned;

  const breakoutConfirmed =
    orbConfirmed ||
    rollingConfirmed;

  if (
    !aligned5 &&
    !breakoutConfirmed
  ) {
    return reject(
      '5m trend not aligned and breakout is not confirmed',
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),

        recentVolumeRatio:
          Number(
            recentVolume.toFixed(
              3
            )
          ),
      }
    );
  }

  if (
    assetClass ===
      'crypto' &&
    regime
      ?.direction ===
      'NEUTRAL' &&
    !breakoutConfirmed
  ) {
    return reject(
      'BTC regime neutral without confirmed breakout'
    );
  }

  const continuation =
    aligned5 &&
    volumeSupport &&
    strongMomentumAligned;

  if (
    !breakoutAligned &&
    !continuation
  ) {
    return reject(
      'no breakout or strong continuation trigger',
      {
        trend5Pct:
          Number(
            trend5.toFixed(
              4
            )
          ),

        trend15Pct:
          Number(
            trend15.toFixed(
              4
            )
          ),

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),

        recentVolumeRatio:
          Number(
            recentVolume.toFixed(
              3
            )
          ),
      }
    );
  }

  const breakoutType =
    orbAligned
      ? orbConfirmed
        ? 'ORB_CONFIRMED'
        : 'ORB'
      : rollingAligned
        ? rollingConfirmed
          ? 'ROLLING_CONFIRMED'
          : 'ROLLING'
        : 'CONTINUATION';

  const breakoutLevel =
    orbAligned
      ? long
        ? orb.high
        : orb.low
      : rollingAligned
        ? long
          ? rolling.high
          : rolling.low
        : null;

  const atr =
    atrAbsolute(
      signalBars,
      Number(
        config
          .atrLookbackBars ||
        14
      )
    );

  if (
    !Number.isFinite(
      atr
    ) ||
    atr <= 0
  ) {
    return reject(
      'ATR unavailable for extension filter'
    );
  }

  const vwapDistanceAtr =
    Number.isFinite(
      sessionVwap
    )
      ? Math.abs(
          price -
          sessionVwap
        ) /
        atr
      : Infinity;

  const maxVwapDistanceAtr =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoMaxVwapDistanceAtr
        : config
            .equityMaxVwapDistanceAtr
    );

  if (
    vwapDistanceAtr >
    maxVwapDistanceAtr
  ) {
    return reject(
      `too extended from VWAP (${vwapDistanceAtr.toFixed(2)} ATR)`
    );
  }

  let breakoutDistanceAtr =
    null;

  if (
    Number.isFinite(
      breakoutLevel
    )
  ) {
    breakoutDistanceAtr =
      Math.abs(
        price -
        breakoutLevel
      ) /
      atr;

    const maxBreakoutDistanceAtr =
      Number(
        assetClass ===
        'crypto'
          ? config
              .cryptoMaxBreakoutDistanceAtr
          : config
              .equityMaxBreakoutDistanceAtr
      );

    if (
      breakoutDistanceAtr >
      maxBreakoutDistanceAtr
    ) {
      return reject(
        `late breakout chase (${breakoutDistanceAtr.toFixed(2)} ATR)`
      );
    }
  }

  const components = {
    // v18.1:
    // aligned 15m earns +2.
    // non-aligned 15m can still qualify,
    // but only after the early-entry hard confirmation above.
    trend15:
      aligned15
        ? 2
        : 0,

    trend5:
      aligned5
        ? 1
        : 0,

    breakout:
      breakoutConfirmed
        ? 2
        : breakoutAligned
          ? 1
          : 0,

    volume:
      recentVolume >=
      Number(
        config
          .recentVolumeStrongRatio
      )
        ? 2
        : recentVolume >=
            Number(
              config
                .recentVolumeOkayRatio
            )
          ? 1
          : 0,

    vwap:
      vwapAligned
        ? 1
        : 0,

    spread:
      spread <=
        maxSpread *
          0.5
        ? 1
        : 0,

    regime:
      regime
        ?.direction ===
      direction
        ? 1
        : 0,

    momentum:
      strongMomentumAligned
        ? 1
        : 0,

    closeMomentum:
      0,
  };

  let score =
    Object
      .values(
        components
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      );

  if (
    assetClass ===
    'us_equity'
  ) {
    const minutes =
      etParts(
        now
      ).minutes;

    const dayOpen =
      num(
        snapshot
          ?.dailyBar
          ?.o,
        NaN
      );

    const dayClose =
      num(
        snapshot
          ?.dailyBar
          ?.c ??
        price,
        NaN
      );

    const dayAligned =
      Number.isFinite(
        dayOpen
      ) &&
      Number.isFinite(
        dayClose
      ) &&
      (
        long
          ? dayClose >
            dayOpen
          : dayClose <
            dayOpen
      );

    if (
      minutes >=
        Number(
          config
            .closeMomentumStartMinutesET
        ) &&
      minutes <
        960 &&
      dayAligned
    ) {
      components
        .closeMomentum =
        1;

      score +=
        1;
    }
  }

  return {
    eligible:
      true,

    score:
      Math.min(
        10,
        score
      ),

    reason:
      null,

    components,

    trigger:
      breakoutAligned
        ? 'breakout'
        : 'continuation',

    earlyEntry:
      !aligned15,

    earlyEntryConfirmed:
      !aligned15
        ? earlyEntryConfirmed
        : false,

    trend5Pct:
      Number(
        trend5.toFixed(
          4
        )
      ),

    trend15Pct:
      Number(
        trend15.toFixed(
          4
        )
      ),

    minuteMomentumPct:
      Number(
        momentum.toFixed(
          4
        )
      ),

    recentVolumeRatio:
      Number(
        recentVolume.toFixed(
          3
        )
      ),

    spreadPct:
      spread == null
        ? null
        : Number(
            spread.toFixed(
              4
            )
          ),

    vwap:
      Number.isFinite(
        sessionVwap
      )
        ? Number(
            sessionVwap.toFixed(
              6
            )
          )
        : null,

    vwapDistanceAtr:
      Number(
        vwapDistanceAtr.toFixed(
          3
        )
      ),

    breakoutDistanceAtr:
      breakoutDistanceAtr ==
      null
        ? null
        : Number(
            breakoutDistanceAtr.toFixed(
              3
            )
          ),

    breakoutType,

    breakoutLevel:
      Number.isFinite(
        breakoutLevel
      )
        ? Number(
            breakoutLevel.toFixed(
              6
            )
          )
        : null,

    openingRange:
      orb,

    rollingBreakout:
      rolling,

    regime,

    exitPlan:
      exitPlan(
        assetClass,
        signalBars,
        config
      ),
  };
}

function makeSignal(
  asset,
  assetClass,
  direction,
  detail,
  price
) {
  const strategy =
    assetClass ===
    'crypto'
      ? detail.trigger ===
        'breakout'
        ? detail.earlyEntry
          ? 'CRYPTO_BREAKOUT_EARLY'
          : 'CRYPTO_BREAKOUT_BALANCED'
        : detail.earlyEntry
          ? 'CRYPTO_CONTINUATION_EARLY'
          : 'CRYPTO_CONTINUATION_BALANCED'
      : detail
          .breakoutType
          ?.startsWith(
            'ORB'
          )
        ? detail.earlyEntry
          ? 'EQUITY_ORB_EARLY'
          : 'EQUITY_ORB_BALANCED'
        : detail.trigger ===
            'breakout'
          ? detail.earlyEntry
            ? 'EQUITY_BREAKOUT_EARLY'
            : 'EQUITY_BREAKOUT_BALANCED'
          : detail.earlyEntry
            ? 'EQUITY_CONTINUATION_EARLY'
            : 'EQUITY_CONTINUATION_BALANCED';

  return {
    symbol:
      asset.symbol,

    name:
      asset.name ||
      asset.symbol,

    assetClass,

    fractionable:
      assetClass ===
      'crypto'
        ? true
        : asset
            .fractionable ===
          true,

    direction,

    score:
      detail.score,

    price,

    strategy,

    signal:
      detail,
  };
}

export function evaluateEquityCandidate({
  asset,
  snapshot,
  bars,
  marketRegime,
  config = STRATEGY_DEFAULTS,
  now = new Date(),
}) {
  if (
    !asset ||
    !snapshot
  ) {
    return {
      signal:
        null,

      diagnostics: {
        long:
          reject(
            'missing asset or snapshot'
          ),

        short:
          reject(
            'missing asset or snapshot'
          ),
      },
    };
  }

  const long =
    scoreDirection({
      direction:
        'LONG',

      bars,
      snapshot,

      regime:
        marketRegime,

      assetClass:
        'us_equity',

      config,
      now,
    });

  const short =
    asset.shortable ===
      true &&
    asset.easy_to_borrow ===
      true
      ? scoreDirection({
          direction:
            'SHORT',

          bars,
          snapshot,

          regime:
            marketRegime,

          assetClass:
            'us_equity',

          config,
          now,
        })
      : reject(
          'not easy-to-borrow shortable'
        );

  const choices =
    [];

  if (
    long.eligible
  ) {
    choices.push({
      direction:
        'LONG',

      detail:
        long,
    });
  }

  if (
    short.eligible
  ) {
    choices.push({
      direction:
        'SHORT',

      detail:
        short,
    });
  }

  choices.sort(
    (
      a,
      b
    ) =>
      b.detail
        .score -
      a.detail
        .score
  );

  const chosen =
    choices[
      0
    ];

  const price =
    currentPrice(
      snapshot,
      bars ||
      []
    );

  const threshold =
    Number(
      config
        .equityScoreThreshold
    );

  if (
    !chosen ||
    chosen.detail
      .score <
      threshold ||
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return {
      signal:
        null,

      diagnostics: {
        long,
        short,
        threshold,
      },
    };
  }

  return {
    signal:
      makeSignal(
        asset,
        'us_equity',
        chosen.direction,
        chosen.detail,
        price
      ),

    diagnostics: {
      long,
      short,
      threshold,
    },
  };
}

export function buildEquitySignal(
  args
) {
  return evaluateEquityCandidate(
    args
  ).signal;
}

function evaluateCryptoFastScalpCandidate({
  asset,
  snapshot,
  bars,
  btcRegime,
  config,
  now,
}) {
  if (!asset || !snapshot) {
    const detail = reject('FAST SCALP: missing asset or snapshot');
    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const all = mergeCurrentMinuteBar(
    bars || [],
    snapshot
  );

  const signalBars = completedBars(
    all,
    now
  );

  if (signalBars.length < 6) {
    const detail = reject(
      'FAST SCALP: not enough completed 1-minute bars'
    );

    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const price = currentPrice(
    snapshot,
    all
  );

  if (!Number.isFinite(price) || price <= 0) {
    const detail = reject('FAST SCALP: invalid current price');
    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const momentum = minuteMomentumPct(snapshot);
  const spread = spreadPct(snapshot);

  if (spread == null) {
    const detail = reject('FAST SCALP: spread unavailable');
    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const maxSpread = Math.max(
    0.01,
    Number(config.fastScalpMaxSpreadPct ?? 0.12)
  );

  if (spread > maxSpread) {
    const detail = reject(
      `FAST SCALP: spread ${spread.toFixed(3)}% > ${maxSpread}%`,
      {
        spreadPct: Number(spread.toFixed(4)),
        minuteMomentumPct: momentum,
      }
    );

    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const estimatedCost = Math.max(
    0,
    Number(config.fastScalpEstimatedRoundTripCostPct ?? 0.50)
  );

  const profitBuffer = Math.max(
    0,
    Number(config.fastScalpProfitBufferPct ?? 0.12)
  );

  const entryFloor = Math.max(
    0.01,
    Number(config.fastScalpEntryMomentumPct ?? 0.65)
  );

  // Require the current 1-minute impulse to be large enough to clear
  // estimated round-trip fees, the current spread, and a profit buffer.
  const requiredImpulse = Math.max(
    entryFloor,
    estimatedCost + spread + profitBuffer
  );

  const trend3 = trendPct(signalBars, 3);
  const trend5 = trendPct(signalBars, 5);
  const trend15 = trendPct(signalBars, 15);

  const previousClose = c(signalBars.at(-2));
  const latestClose = c(signalBars.at(-1));

  const completedMove =
    Number.isFinite(previousClose) &&
    Number.isFinite(latestClose) &&
    previousClose > 0
      ? ((latestClose - previousClose) / previousClose) * 100
      : 0;

  if (
    momentum == null ||
    momentum < requiredImpulse
  ) {
    const shown =
      momentum == null
        ? 'unavailable'
        : `${momentum.toFixed(3)}%`;

    const detail = reject(
      `FAST SCALP: impulse ${shown} below cost-aware ${requiredImpulse.toFixed(3)}%`,
      {
        minuteMomentumPct: momentum,
        trend5Pct: Number(trend5.toFixed(4)),
        trend15Pct: Number(trend15.toFixed(4)),
        spreadPct: Number(spread.toFixed(4)),
      }
    );

    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  // A very strong live impulse may reverse a weak prior sell candle,
  // but don't buy directly into a large completed dump unless the new
  // impulse is clearly stronger than the normal entry requirement.
  if (
    completedMove < -0.30 &&
    momentum < requiredImpulse + 0.25
  ) {
    const detail = reject(
      'FAST SCALP: impulse not strong enough to reverse last completed selloff',
      {
        minuteMomentumPct: Number(momentum.toFixed(4)),
        trend5Pct: Number(trend5.toFixed(4)),
        trend15Pct: Number(trend15.toFixed(4)),
        spreadPct: Number(spread.toFixed(4)),
      }
    );

    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold: Number(config.fastScalpScoreThreshold ?? 8),
      },
    };
  }

  const recentVolume = volumeRatio(signalBars, 6);

  const components = {
    costCoverage: 4,
    impulse: 2,
    tightSpread: spread <= maxSpread * 0.5 ? 1 : 0,
    localTurn: trend3 > 0 || completedMove > 0 ? 1 : 0,
    acceleration: momentum >= requiredImpulse + 0.20 ? 1 : 0,
    volume: recentVolume >= 1.05 ? 1 : 0,
  };

  const score = Math.min(
    10,
    8 +
      (components.acceleration ? 1 : 0) +
      (components.localTurn ? 1 : 0)
  );

  const threshold = Number(
    config.fastScalpScoreThreshold ?? 8
  );

  const detail = {
    eligible: true,
    score,
    reason: null,
    components,
    trigger: 'fast_scalp',
    earlyEntry: true,
    earlyEntryConfirmed: true,
    trend5Pct: Number(trend5.toFixed(4)),
    trend15Pct: Number(trend15.toFixed(4)),
    minuteMomentumPct: Number(momentum.toFixed(4)),
    recentVolumeRatio: Number(recentVolume.toFixed(3)),
    spreadPct: Number(spread.toFixed(4)),
    vwap: null,
    vwapDistanceAtr: null,
    breakoutDistanceAtr: null,
    breakoutType: 'FAST_SCALP_1M',
    breakoutLevel: null,
    openingRange: null,
    rollingBreakout: null,
    regime: btcRegime,
    requiredImpulsePct: Number(requiredImpulse.toFixed(4)),
    completedBarMovePct: Number(completedMove.toFixed(4)),
    exitPlan: {
      atrPct: null,
      stopLossPct: Number(
        config.fastScalpStopLossPct ?? 0.45
      ),
      takeProfitPct: Number(
        config.fastScalpTakeProfitPct ?? 1.10
      ),
      estimatedRoundTripCostPct: estimatedCost,
      netRewardRiskRatio: null,
      trailTriggerPct: Number(
        config.fastScalpTrailTriggerPct ?? 0.70
      ),
      trailDistancePct: Number(
        config.fastScalpTrailDistancePct ?? 0.18
      ),
      trailFloorPct: Number(
        config.fastScalpTrailFloorPct ?? 0.55
      ),
      breakoutFailureWindowMinutes: 0,
      breakoutFailureAtr: 0,
      maxHoldMinutes: Number(
        config.fastScalpMaxHoldMinutes ?? 6
      ),
    },
  };

  if (score < threshold) {
    return {
      signal: null,
      diagnostics: {
        long: detail,
        threshold,
      },
    };
  }

  return {
    signal: {
      symbol: asset.symbol,
      name: asset.name || asset.symbol,
      assetClass: 'crypto',
      fractionable: true,
      direction: 'LONG',
      score,
      price,
      strategy: 'CRYPTO_FAST_SCALP',
      signal: detail,
    },
    diagnostics: {
      long: detail,
      threshold,
    },
  };
}

export function evaluateCryptoCandidate({
  asset,
  snapshot,
  bars,
  btcRegime,
  config = STRATEGY_DEFAULTS,
  now = new Date(),
}) {
  if (config.fastScalpEnabled === true) {
  return evaluateCryptoFastScalpCandidate({
    asset,
    snapshot,
    bars,
    btcRegime,
    config,
    now,
  });
}

  if (
    !asset ||
    !snapshot
  ) {
    return {
      signal:
        null,

      diagnostics: {
        long:
          reject(
            'missing asset or snapshot'
          ),
      },
    };
  }

  const detail =
    scoreDirection({
      direction:
        'LONG',

      bars,
      snapshot,

      regime:
        btcRegime,

      assetClass:
        'crypto',

      config,
      now,
    });

  const price =
    currentPrice(
      snapshot,
      bars ||
      []
    );

  const threshold =
    Number(
      config
        .cryptoScoreThreshold
    );

  if (
    !detail.eligible ||
    detail.score <
      threshold ||
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return {
      signal:
        null,

      diagnostics: {
        long:
          detail,

        threshold,
      },
    };
  }

  return {
    signal:
      makeSignal(
        asset,
        'crypto',
        'LONG',
        detail,
        price
      ),

    diagnostics: {
      long:
        detail,

      threshold,
    },
  };
}

export function buildCryptoSignal(
  args
) {
  return evaluateCryptoCandidate(
    args
  ).signal;
}

export function isCoolingDown(
  trades,
  symbol,
  cooldownMinutes
) {
  const wanted =
    String(
      symbol ||
      ''
    ).toUpperCase();

  return (
    trades ||
    []
  ).some(
    (
      trade
    ) => {
      if (
        String(
          trade.market ||
          ''
        ).toUpperCase() !==
        wanted
      ) {
        return false;
      }

      if (
        trade.result ===
        null
      ) {
        return true;
      }

      const stamp =
        trade.closed_at ||
        trade.timestamp ||
        trade.created_at;

      const time =
        stamp
          ? new Date(
              stamp
            ).getTime()
          : 0;

      const lossMultiplier =
        trade.result ===
        'loss'
          ? 2
          : 1;

      const tradeCutoff =
        Date.now() -
        Number(
          cooldownMinutes ||
          0
        ) *
          lossMultiplier *
          60000;

      return (
        Number.isFinite(
          time
        ) &&
        time >=
          tradeCutoff
      );
    }
  );
}
