// STRATEGY ENGINE v17 PRECISION
//
// Higher-selectivity momentum strategy for MomentumFlow.
// The goal is better setup quality, not more trades.
//
// Equities:
// - precision trading windows
// - SPY/QQQ regime must agree with trade direction
// - 5m + 15m trend must agree
// - confirmed ORB or rolling breakout (2-bar hold)
// - relative-volume confirmation
// - VWAP confirmation
// - spread filter
// - ATR-based no-chase filters
// - long + easy-to-borrow short support
//
// Crypto:
// - LONG only
// - BTC regime must be bullish
// - 5m + 15m trend must agree
// - confirmed rolling breakout
// - relative-volume + VWAP + spread confirmation
// - ATR-based no-chase filters
//
// IMPORTANT: Relative volume is relative to the bars returned by the configured
// Alpaca data feed. With IEX, it is not total consolidated U.S. market volume.
//
// No strategy guarantees profit. Validate with genuine Alpaca PAPER fills.

export const STRATEGY_DEFAULTS = {
  equityScoreThreshold: 8,
  cryptoScoreThreshold: 8,

  maxDetailedEquities: 6,
  maxDetailedCrypto: 6,

  equityPrefilterMomentumPct: 0.05,
  cryptoPrefilterMomentumPct: 0.08,

  equityMinEntryMomentumPct: 0.03,
  cryptoMinEntryMomentumPct: 0.05,

  maxEquitySpreadPct: 0.18,
  maxCryptoSpreadPct: 0.60,

  equityCooldownMinutes: 15,
  cryptoCooldownMinutes: 20,

  recentVolumeLookback: 10,
  recentVolumeStrongRatio: 1.50,
  recentVolumeOkayRatio: 1.20,

  breakoutLookbackBars: 10,
  openingRangeMinutes: 5,
  requireBreakoutConfirmation: true,

  requireDualTrendAlignment: true,
  requireVolumeConfirmation: true,
  requireVwapAlignment: true,
  requireMarketRegime: true,

  equityMaxVwapDistanceAtr: 1.75,
  cryptoMaxVwapDistanceAtr: 2.00,

  equityMaxBreakoutDistanceAtr: 0.80,
  cryptoMaxBreakoutDistanceAtr: 1.00,

  usePrecisionTimeWindows: true,

  equityMorningStartMinutesET:
    9 * 60 + 35,

  equityMorningEndMinutesET:
    11 * 60 + 30,

  equityAfternoonStartMinutesET:
    14 * 60,

  equityAfternoonEndMinutesET:
    15 * 60 + 45,

  // Keep exits close to v16 initially so we can evaluate
  // whether the new ENTRY filters improve results.
  atrLookbackBars: 14,
  atrMultiplier: 1.25,

  equityMinStopPct: 0.30,
  equityMaxStopPct: 1.25,
  equityMinTakeProfitPct: 0.60,

  cryptoMinStopPct: 0.70,
  cryptoMaxStopPct: 2.00,
  cryptoMinTakeProfitPct: 1.40,

  rewardRiskRatio: 1.80,

  trailingTriggerR: 1.00,
  trailingDistanceR: 0.65,

  equityMaxHoldMinutes: 25,
  cryptoMaxHoldMinutes: 40,

  closeMomentumStartMinutesET:
    15 * 60 + 30,
};

const ET_FORMATTER =
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

function n(
  value,
  fallback = 0
) {
  const num =
    Number(value);

  return Number.isFinite(num)
    ? num
    : fallback;
}

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function average(
  values
) {
  const good =
    (
      values ||
      []
    ).filter(
      Number.isFinite
    );

  return good.length
    ? good.reduce(
        (
          a,
          b
        ) =>
          a + b,
        0
      ) /
        good.length
    : 0;
}

function etParts(
  value
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  const parts =
    Object.fromEntries(
      ET_FORMATTER
        .formatToParts(
          date
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

function barTime(
  bar
) {
  return (
    bar?.t ||
    bar?.timestamp ||
    null
  );
}

function barOpen(
  bar
) {
  return n(
    bar?.o,
    NaN
  );
}

function barClose(
  bar
) {
  return n(
    bar?.c,
    NaN
  );
}

function barHigh(
  bar
) {
  return n(
    bar?.h,
    NaN
  );
}

function barLow(
  bar
) {
  return n(
    bar?.l,
    NaN
  );
}

function barVolume(
  bar
) {
  return n(
    bar?.v,
    0
  );
}

// Removes the still-forming current minute.
// Breakout confirmation therefore uses CLOSED bars.
function completedBars(
  bars,
  now = new Date()
) {
  const nowMinute =
    Math.floor(
      now.getTime() /
      60000
    );

  return (
    bars ||
    []
  ).filter(
    (
      bar
    ) => {
      const stamp =
        barTime(
          bar
        );

      if (!stamp) {
        return false;
      }

      const time =
        new Date(
          stamp
        ).getTime();

      if (
        !Number.isFinite(
          time
        )
      ) {
        return false;
      }

      return (
        Math.floor(
          time /
          60000
        ) <
        nowMinute
      );
    }
  );
}

function currentPriceFrom(
  snapshot,
  bars = []
) {
  return n(
    snapshot
      ?.latestTrade
      ?.p ??
    snapshot
      ?.minuteBar
      ?.c ??
    bars[
      bars.length -
      1
    ]?.c ??
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

  const currentTime =
    barTime(
      minuteBar
    );

  const existingIndex =
    currentTime
      ? output
          .findIndex(
            (
              bar
            ) =>
              barTime(
                bar
              ) ===
              currentTime
          )
      : -1;

  if (
    existingIndex >=
    0
  ) {
    output[
      existingIndex
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
        barTime(a) ||
        0
      ).getTime() -
      new Date(
        barTime(b) ||
        0
      ).getTime()
  );

  return output;
}

export function spreadPct(
  snapshot
) {
  const ask =
    n(
      snapshot
        ?.latestQuote
        ?.ap,
      NaN
    );

  const bid =
    n(
      snapshot
        ?.latestQuote
        ?.bp,
      NaN
    );

  if (
    !Number.isFinite(
      ask
    ) ||
    !Number.isFinite(
      bid
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
    n(
      snapshot
        ?.minuteBar
        ?.o,
      NaN
    );

  const close =
    n(
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
    n(
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
    barVolume(
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
    barClose(
      bars[
        bars.length -
        1
      ]
    );

  const prior =
    barClose(
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
      prior
    ) ||
    prior <= 0
  ) {
    return 0;
  }

  return (
    (
      current -
      prior
    ) /
    prior
  ) *
  100;
}

function recentVolumeRatio(
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
    barVolume(
      bars[
        bars.length -
        1
      ]
    );

  const prior =
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
        barVolume
      )
      .filter(
        (
          value
        ) =>
          value >
          0
      );

  const base =
    average(
      prior
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
      const stamp =
        barTime(
          bar
        );

      if (!stamp) {
        return false;
      }

      const part =
        etParts(
          stamp
        );

      return (
        part.dateKey ===
          today &&
        part.minutes >=
          9 *
            60 +
            30 &&
        part.minutes <=
          16 *
            60
      );
    }
  );
}

function inEquityPrecisionWindow(
  now,
  config
) {
  if (
    !config
      .usePrecisionTimeWindows
  ) {
    return true;
  }

  const minutes =
    etParts(
      now
    ).minutes;

  const morning =
    minutes >=
      Number(
        config
          .equityMorningStartMinutesET
      ) &&
    minutes <=
      Number(
        config
          .equityMorningEndMinutesET
      );

  const afternoon =
    minutes >=
      Number(
        config
          .equityAfternoonStartMinutesET
      ) &&
    minutes <=
      Number(
        config
          .equityAfternoonEndMinutesET
      );

  return (
    morning ||
    afternoon
  );
}

function vwap(
  bars
) {
  let priceVolume =
    0;

  let totalVolume =
    0;

  for (
    const bar of
    bars ||
    []
  ) {
    const high =
      barHigh(
        bar
      );

    const low =
      barLow(
        bar
      );

    const close =
      barClose(
        bar
      );

    const volume =
      barVolume(
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
      volume <=
        0
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

  const trueRanges =
    [];

  for (
    let i = 1;
    i <
    slice.length;
    i += 1
  ) {
    const high =
      barHigh(
        slice[i]
      );

    const low =
      barLow(
        slice[i]
      );

    const previousClose =
      barClose(
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

    trueRanges.push(
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

  return average(
    trueRanges
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

  const current =
    barClose(
      bars?.[
        bars.length -
        1
      ]
    );

  if (
    absolute <= 0 ||
    !Number.isFinite(
      current
    ) ||
    current <= 0
  ) {
    return 0;
  }

  return (
    absolute /
    current
  ) *
  100;
}

// Two CLOSED bars must remain past the same breakout level.
function rollingBreakoutState(
  bars,
  lookback = 10
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length <
      4
  ) {
    return {
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
  }

  const previous =
    bars[
      bars.length -
      2
    ];

  const current =
    bars[
      bars.length -
      1
    ];

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
        barHigh
      )
      .filter(
        Number.isFinite
      );

  const lows =
    history
      .map(
        barLow
      )
      .filter(
        Number.isFinite
      );

  const previousClose =
    barClose(
      previous
    );

  const currentClose =
    barClose(
      current
    );

  if (
    !highs.length ||
    !lows.length ||
    !Number.isFinite(
      previousClose
    ) ||
    !Number.isFinite(
      currentClose
    )
  ) {
    return {
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
      previousClose >
        high &&
      currentClose >
        high,

    confirmedShort:
      previousClose <
        low &&
      currentClose <
        low,

    high,
    low,
  };
}

function openingRangeState(
  bars,
  now,
  openingRangeMinutes
) {
  const session =
    sessionBarsET(
      bars,
      now
    );

  const cutoff =
    9 *
      60 +
    30 +
    Number(
      openingRangeMinutes ||
      5
    );

  const opening =
    session.filter(
      (
        bar
      ) => {
        const stamp =
          barTime(
            bar
          );

        return (
          stamp &&
          etParts(
            stamp
          ).minutes <
            cutoff
        );
      }
    );

  const afterOpening =
    session.filter(
      (
        bar
      ) => {
        const stamp =
          barTime(
            bar
          );

        return (
          stamp &&
          etParts(
            stamp
          ).minutes >=
            cutoff
        );
      }
    );

  if (
    opening.length <
    3
  ) {
    return {
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
  }

  const highs =
    opening
      .map(
        barHigh
      )
      .filter(
        Number.isFinite
      );

  const lows =
    opening
      .map(
        barLow
      )
      .filter(
        Number.isFinite
      );

  if (
    !highs.length ||
    !lows.length
  ) {
    return {
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
    barClose(
      afterOpening[
        afterOpening.length -
        1
      ]
    );

  const previousClose =
    barClose(
      afterOpening[
        afterOpening.length -
        2
      ]
    );

  const currentValid =
    Number.isFinite(
      currentClose
    );

  const previousValid =
    Number.isFinite(
      previousClose
    );

  return {
    available:
      currentValid,

    long:
      currentValid &&
      currentClose >
        high,

    short:
      currentValid &&
      currentClose <
        low,

    confirmedLong:
      currentValid &&
      previousValid &&
      previousClose >
        high &&
      currentClose >
        high,

    confirmedShort:
      currentValid &&
      previousValid &&
      previousClose <
        low &&
      currentClose <
        low,

    high,
    low,
  };
}

function dynamicExitPlan(
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

  if (
    assetClass ===
    'crypto'
  ) {
    const stopPct =
      clamp(
        Math.max(
          atr *
            Number(
              config
                .atrMultiplier ||
              1.25
            ),

          Number(
            config
              .cryptoMinStopPct
          )
        ),

        Number(
          config
            .cryptoMinStopPct
        ),

        Number(
          config
            .cryptoMaxStopPct
        )
      );

    const takeProfitPct =
      Math.max(
        Number(
          config
            .cryptoMinTakeProfitPct
        ),

        stopPct *
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
          stopPct.toFixed(
            4
          )
        ),

      takeProfitPct:
        Number(
          takeProfitPct.toFixed(
            4
          )
        ),

      trailTriggerPct:
        Number(
          (
            stopPct *
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
            stopPct *
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
          config
            .cryptoMaxHoldMinutes
        ),
    };
  }

  const stopPct =
    clamp(
      Math.max(
        atr *
          Number(
            config
              .atrMultiplier ||
            1.25
          ),

        Number(
          config
            .equityMinStopPct
        )
      ),

      Number(
        config
          .equityMinStopPct
      ),

      Number(
        config
          .equityMaxStopPct
      )
    );

  const takeProfitPct =
    Math.max(
      Number(
        config
          .equityMinTakeProfitPct
      ),

      stopPct *
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
        stopPct.toFixed(
          4
        )
      ),

    takeProfitPct:
      Number(
        takeProfitPct.toFixed(
          4
        )
      ),

    trailTriggerPct:
      Number(
        (
          stopPct *
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
          stopPct *
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
        config
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

  const longVotes =
    values.filter(
      (
        value
      ) =>
        value >
        0
    ).length;

  const shortVotes =
    values.filter(
      (
        value
      ) =>
        value <
        0
    ).length;

  return {
    direction:
      longVotes >=
      3
        ? 'LONG'
        : shortVotes >=
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
      btc5 > 0 &&
      btc15 > 0
        ? 'LONG'
        : btc5 < 0 &&
            btc15 < 0
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

function scoreDirection({
  direction,
  bars,
  snapshot,
  regime,
  assetClass,
  config,
  now,
}) {
  const currentBars =
    mergeCurrentMinuteBar(
      bars,
      snapshot
    );

  // Signal decisions are based on completed bars.
  const signalBars =
    completedBars(
      currentBars,
      now
    );

  if (
    signalBars.length <
    4
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'not enough bar history',
    };
  }

  if (
    assetClass ===
      'us_equity' &&
    !inEquityPrecisionWindow(
      now,
      config
    )
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'outside v17 precision equity windows',
    };
  }

  const long =
    direction ===
    'LONG';

  const currentPrice =
    currentPriceFrom(
      snapshot,
      currentBars
    );

  if (
    !Number.isFinite(
      currentPrice
    ) ||
    currentPrice <=
      0
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'invalid current price',
    };
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
      ? trend5 > 0
      : trend5 < 0;

  const aligned15 =
    long
      ? trend15 > 0
      : trend15 < 0;

  if (
    config
      .requireDualTrendAlignment &&
    (
      !aligned5 ||
      !aligned15
    )
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        '5m and 15m trend are not both aligned',
    };
  }

  const momentum =
    minuteMomentumPct(
      snapshot
    );

  const minMomentum =
    assetClass ===
    'crypto'
      ? Number(
          config
            .cryptoMinEntryMomentumPct
        )
      : Number(
          config
            .equityMinEntryMomentumPct
        );

  const momentumAligned =
    momentum != null &&
    (
      long
        ? momentum >=
          minMomentum
        : momentum <=
          -minMomentum
    );

  if (
    !momentumAligned
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `entry momentum below ${minMomentum}% threshold`,
    };
  }

  // v17 requires the broader market to support the trade.
  if (
    config
      .requireMarketRegime &&
    regime
      ?.direction !==
      direction
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `market regime is ${regime?.direction || 'UNKNOWN'}`,
    };
  }

  const spread =
    spreadPct(
      snapshot
    );

  const maxSpread =
    assetClass ===
    'crypto'
      ? Number(
          config
            .maxCryptoSpreadPct
        )
      : Number(
          config
            .maxEquitySpreadPct
        );

  if (
    spread != null &&
    spread >
      maxSpread
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `spread ${spread.toFixed(3)}% > ${maxSpread}%`,
    };
  }

  // Uses completed bars instead of the still-forming current minute.
  const volumeRatio =
    recentVolumeRatio(
      signalBars,

      Number(
        config
          .recentVolumeLookback
      )
    );

  if (
    config
      .requireVolumeConfirmation &&
    volumeRatio <
      Number(
        config
          .recentVolumeOkayRatio
      )
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `relative volume ${volumeRatio.toFixed(2)}x is too weak`,
    };
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
        ? currentPrice >
          sessionVwap
        : currentPrice <
          sessionVwap
    );

  if (
    config
      .requireVwapAlignment &&
    !vwapAligned
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'price is not aligned with VWAP',
    };
  }

  const rolling =
    rollingBreakoutState(
      signalBars,

      Number(
        config
          .breakoutLookbackBars
      )
    );

  let openingRange =
    null;

  let orbAligned =
    false;

  let orbConfirmed =
    false;

  if (
    assetClass ===
    'us_equity'
  ) {
    openingRange =
      openingRangeState(
        signalBars,
        now,

        Number(
          config
            .openingRangeMinutes
        )
      );

    orbAligned =
      openingRange
        .available &&
      (
        long
          ? openingRange
              .long
          : openingRange
              .short
      );

    orbConfirmed =
      openingRange
        .available &&
      (
        long
          ? openingRange
              .confirmedLong
          : openingRange
              .confirmedShort
      );
  }

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
    !breakoutAligned
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'no aligned breakout',
    };
  }

  if (
    config
      .requireBreakoutConfirmation &&
    !breakoutConfirmed
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'breakout has not held for 2 completed bars',
    };
  }

  const breakoutType =
    orbConfirmed
      ? 'ORB'
      : rollingConfirmed
        ? 'ROLLING'
        : orbAligned
          ? 'ORB_UNCONFIRMED'
          : 'ROLLING_UNCONFIRMED';

  const breakoutLevel =
    orbConfirmed
      ? long
        ? openingRange
            .high
        : openingRange
            .low
      : long
        ? rolling.high
        : rolling.low;

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
    atr <=
      0
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        'ATR unavailable for chase filter',
    };
  }

  const vwapDistanceAtr =
    Number.isFinite(
      sessionVwap
    )
      ? Math.abs(
          currentPrice -
          sessionVwap
        ) /
        atr
      : Infinity;

  const breakoutDistanceAtr =
    Number.isFinite(
      breakoutLevel
    )
      ? Math.abs(
          currentPrice -
          breakoutLevel
        ) /
        atr
      : Infinity;

  const maxVwapDistanceAtr =
    assetClass ===
    'crypto'
      ? Number(
          config
            .cryptoMaxVwapDistanceAtr
        )
      : Number(
          config
            .equityMaxVwapDistanceAtr
        );

  const maxBreakoutDistanceAtr =
    assetClass ===
    'crypto'
      ? Number(
          config
            .cryptoMaxBreakoutDistanceAtr
        )
      : Number(
          config
            .equityMaxBreakoutDistanceAtr
        );

  // Don't buy/short something that already made most of the move.
  if (
    vwapDistanceAtr >
    maxVwapDistanceAtr
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `too extended from VWAP (${vwapDistanceAtr.toFixed(2)} ATR)`,
    };
  }

  if (
    breakoutDistanceAtr >
    maxBreakoutDistanceAtr
  ) {
    return {
      eligible:
        false,

      score:
        0,

      reason:
        `late breakout chase (${breakoutDistanceAtr.toFixed(2)} ATR)`,
    };
  }

  const components = {
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
        : 0,

    volume:
      volumeRatio >=
      Number(
        config
          .recentVolumeStrongRatio
      )
        ? 2
        : volumeRatio >=
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
          0.60
        ? 1
        : 0,

    regime:
      regime
        ?.direction ===
      direction
        ? 1
        : 0,

    closeMomentum:
      0,
  };

  let score =
    components
      .trend15 +
    components
      .trend5 +
    components
      .breakout +
    components
      .volume +
    components
      .vwap +
    components
      .spread +
    components
      .regime;

  if (
    assetClass ===
    'us_equity'
  ) {
    const minutes =
      etParts(
        now
      ).minutes;

    const dailyOpen =
      n(
        snapshot
          ?.dailyBar
          ?.o,
        NaN
      );

    const dailyClose =
      n(
        snapshot
          ?.dailyBar
          ?.c ??
        currentPrice,

        NaN
      );

    const dailyAligned =
      Number.isFinite(
        dailyOpen
      ) &&
      Number.isFinite(
        dailyClose
      ) &&
      (
        long
          ? dailyClose >
            dailyOpen
          : dailyClose <
            dailyOpen
      );

    if (
      minutes >=
        Number(
          config
            .closeMomentumStartMinutesET
        ) &&
      minutes <
        16 *
          60 &&
      dailyAligned &&
      aligned15
    ) {
      components
        .closeMomentum =
        1;

      score +=
        1;
    }
  }

  score =
    Math.min(
      10,
      score
    );

  return {
    eligible:
      true,

    score,

    components,

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
        volumeRatio.toFixed(
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
      Number(
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

    openingRange,

    rollingBreakout:
      rolling,

    regime,

    exitPlan:
      dynamicExitPlan(
        assetClass,
        signalBars,
        config
      ),
  };
}

export function buildEquitySignal({
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
    return null;
  }

  const longScore =
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

  const shortScore =
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
      : {
          eligible:
            false,

          score:
            0,

          reason:
            'not easy-to-borrow shortable',
        };

  const choices =
    [];

  if (
    longScore
      .eligible
  ) {
    choices.push({
      direction:
        'LONG',

      detail:
        longScore,
    });
  }

  if (
    shortScore
      .eligible
  ) {
    choices.push({
      direction:
        'SHORT',

      detail:
        shortScore,
    });
  }

  if (
    !choices.length
  ) {
    return null;
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
    choices[0];

  if (
    chosen.detail
      .score <
    Number(
      config
        .equityScoreThreshold
    )
  ) {
    return null;
  }

  const price =
    currentPriceFrom(
      snapshot,
      bars ||
        []
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <=
      0
  ) {
    return null;
  }

  return {
    symbol:
      asset.symbol,

    name:
      asset.name ||
      asset.symbol,

    assetClass:
      'us_equity',

    fractionable:
      asset.fractionable ===
      true,

    direction:
      chosen.direction,

    score:
      chosen.detail
        .score,

    price,

    strategy:
      chosen.detail
        .breakoutType ===
      'ORB'
        ? 'EQUITY_ORB_PRECISION'
        : 'EQUITY_BREAKOUT_PRECISION',

    signal:
      chosen.detail,
  };
}

export function buildCryptoSignal({
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
    return null;
  }

  // Crypto remains LONG only.
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

  if (
    !detail
      .eligible
  ) {
    return null;
  }

  if (
    detail.score <
    Number(
      config
        .cryptoScoreThreshold
    )
  ) {
    return null;
  }

  const price =
    currentPriceFrom(
      snapshot,
      bars ||
        []
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <=
      0
  ) {
    return null;
  }

  return {
    symbol:
      asset.symbol,

    name:
      asset.name ||
      asset.symbol,

    assetClass:
      'crypto',

    fractionable:
      true,

    direction:
      'LONG',

    score:
      detail.score,

    price,

    strategy:
      'CRYPTO_BREAKOUT_PRECISION',

    signal:
      detail,
  };
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
