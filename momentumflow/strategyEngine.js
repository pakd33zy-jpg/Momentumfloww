// STRATEGY ENGINE v18.1 BALANCED EARLY ENTRY
//
// v18.1 change:
// - 15m trend alignment is worth +2 points instead of being an absolute gate.
// - If 15m is NOT aligned, the setup must prove an early reversal/continuation
//   with aligned 5m trend + strong current momentum + supporting volume.
// - VWAP, spread, opposite-regime protection and extension filters remain.
//
// No strategy guarantees profit. Validate with genuine Alpaca PAPER fills.

export const STRATEGY_DEFAULTS = {
  equityScoreThreshold: 7,
  cryptoScoreThreshold: 7,

  maxDetailedEquities: 18,
  maxDetailedCrypto: 10,

  equityPrefilterMomentumPct: 0.025,
  cryptoPrefilterMomentumPct: 0.04,

  equityMinEntryMomentumPct: 0.015,
  cryptoMinEntryMomentumPct: 0.025,

  equityStrongMomentumPct: 0.08,
  cryptoStrongMomentumPct: 0.12,

  maxEquitySpreadPct: 0.20,
  maxCryptoSpreadPct: 0.65,

  equityCooldownMinutes: 10,
  cryptoCooldownMinutes: 15,

  recentVolumeLookback: 10,
  recentVolumeStrongRatio: 1.50,
  recentVolumeOkayRatio: 1.10,

  breakoutLookbackBars: 8,
  openingRangeMinutes: 5,

  requireVwapAlignment: true,
  rejectOppositeRegime: true,

  equityMaxVwapDistanceAtr: 2.25,
  cryptoMaxVwapDistanceAtr: 2.50,

  equityMaxBreakoutDistanceAtr: 1.50,
  cryptoMaxBreakoutDistanceAtr: 1.75,

  useEquityTimeWindow: true,

  equityStartMinutesET:
    9 * 60 + 35,

  equityEndMinutesET:
    15 * 60 + 50,

  atrLookbackBars: 14,
  atrMultiplier: 1.25,

  equityMinStopPct: 0.30,
  equityMaxStopPct: 1.25,
  equityMinTakeProfitPct: 0.55,

  cryptoMinStopPct: 0.70,
  cryptoMaxStopPct: 2.00,
  cryptoMinTakeProfitPct: 1.20,

  rewardRiskRatio: 1.60,

  trailingTriggerR: 0.90,
  trailingDistanceR: 0.60,

  equityMaxHoldMinutes: 25,
  cryptoMaxHoldMinutes: 40,

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
      1.25
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

  const takeProfit =
    Math.max(
      minTakeProfit,

      stop *
        Number(
          config
            .rewardRiskRatio
        )
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

    trailTriggerPct:
      Number(
        (
          stop *
          Number(
            config
              .trailingTriggerR
          )
        ).toFixed(
          4
        )
      ),

    trailDistancePct:
      Number(
        (
          stop *
          Number(
            config
              .trailingDistanceR
          )
        ).toFixed(
          4
        )
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
    spread != null &&
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
      spread == null ||
      spread <=
        maxSpread *
          0.6
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

export function evaluateCryptoCandidate({
  asset,
  snapshot,
  bars,
  btcRegime,
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

  const cutoff =
    Date.now() -
    Number(
      cooldownMinutes ||
      0
    ) *
      60000;

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

      return (
        Number.isFinite(
          time
        ) &&
        time >=
          cutoff
      );
    }
  );
}
