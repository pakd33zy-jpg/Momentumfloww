// STRATEGY ENGINE v16
//
// Multi-factor signal scoring for MomentumFlow.
// Equities: opening-range / breakout + multi-timeframe trend + volume + VWAP + spread + market regime.
// Crypto: multi-timeframe trend + breakout + volume + VWAP + spread + BTC regime.
// Dynamic ATR-style exits are generated per trade.
//
// No strategy guarantees profit. Run PAPER first and evaluate genuine Alpaca fills.

export const STRATEGY_DEFAULTS = {
  equityScoreThreshold: 7,
  cryptoScoreThreshold: 7,

  maxDetailedEquities: 6,
  maxDetailedCrypto: 6,

  equityPrefilterMomentumPct: 0.03,
  cryptoPrefilterMomentumPct: 0.05,

  maxEquitySpreadPct: 0.25,
  maxCryptoSpreadPct: 0.80,

  equityCooldownMinutes: 10,
  cryptoCooldownMinutes: 15,

  recentVolumeLookback: 10,
  recentVolumeStrongRatio: 1.50,
  recentVolumeOkayRatio: 1.15,

  breakoutLookbackBars: 10,
  openingRangeMinutes: 5,

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

  closeMomentumStartMinutesET: 15 * 60 + 30,
};

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const good = values.filter(Number.isFinite);

  return good.length
    ? good.reduce((a, b) => a + b, 0) / good.length
    : 0;
}

function etParts(value) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  const parts = Object.fromEntries(
    ET_FORMATTER
      .formatToParts(date)
      .map((part) => [
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

function barTime(bar) {
  return (
    bar?.t ||
    bar?.timestamp ||
    null
  );
}

function barClose(bar) {
  return n(
    bar?.c,
    NaN
  );
}

function barOpen(bar) {
  return n(
    bar?.o,
    NaN
  );
}

function barHigh(bar) {
  return n(
    bar?.h,
    NaN
  );
}

function barLow(bar) {
  return n(
    bar?.l,
    NaN
  );
}

function barVolume(bar) {
  return n(
    bar?.v,
    0
  );
}

export function mergeCurrentMinuteBar(
  bars = [],
  snapshot = null
) {
  const output =
    Array.isArray(bars)
      ? [...bars]
      : [];

  const minuteBar =
    snapshot?.minuteBar;

  if (
    !minuteBar ||
    !Number.isFinite(
      Number(
        minuteBar?.c
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
      ? output.findIndex(
          (bar) =>
            barTime(bar) ===
            currentTime
        )
      : -1;

  if (
    existingIndex >= 0
  ) {
    output[
      existingIndex
    ] = minuteBar;
  } else {
    output.push(
      minuteBar
    );
  }

  output.sort(
    (a, b) =>
      new Date(
        barTime(a) ||
        0
      ) -
      new Date(
        barTime(b) ||
        0
      )
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
    !Number.isFinite(ask) ||
    !Number.isFinite(bid) ||
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
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
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
      snapshot?.dailyBar
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
      lookback + 1
  ) {
    return 0;
  }

  const current =
    barClose(
      bars[
        bars.length - 1
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
    bars.length < 3
  ) {
    return 0;
  }

  const current =
    barVolume(
      bars[
        bars.length - 1
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
        (v) =>
          v > 0
      );

  const base =
    average(
      prior
    );

  if (
    base <= 0
  ) {
    return 0;
  }

  return (
    current /
    base
  );
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
    (bar) => {
      const t =
        barTime(
          bar
        );

      if (!t) {
        return false;
      }

      const p =
        etParts(
          t
        );

      return (
        p.dateKey ===
          today &&
        p.minutes >=
          9 * 60 + 30 &&
        p.minutes <=
          16 * 60
      );
    }
  );
}

function vwap(
  bars
) {
  let pv = 0;
  let volume = 0;

  for (
    const bar of
    bars ||
    []
  ) {
    const h =
      barHigh(
        bar
      );

    const l =
      barLow(
        bar
      );

    const c =
      barClose(
        bar
      );

    const v =
      barVolume(
        bar
      );

    if (
      ![
        h,
        l,
        c,
      ].every(
        Number.isFinite
      ) ||
      v <= 0
    ) {
      continue;
    }

    const typical =
      (
        h +
        l +
        c
      ) /
      3;

    pv +=
      typical *
      v;

    volume +=
      v;
  }

  return volume > 0
    ? pv /
      volume
    : null;
}

function atrPct(
  bars,
  lookback = 14
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length < 3
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

  const trs =
    [];

  for (
    let i = 1;
    i <
    slice.length;
    i++
  ) {
    const high =
      barHigh(
        slice[i]
      );

    const low =
      barLow(
        slice[i]
      );

    const prevClose =
      barClose(
        slice[
          i - 1
        ]
      );

    if (
      ![
        high,
        low,
        prevClose,
      ].every(
        Number.isFinite
      )
    ) {
      continue;
    }

    trs.push(
      Math.max(
        high -
          low,

        Math.abs(
          high -
          prevClose
        ),

        Math.abs(
          low -
          prevClose
        )
      )
    );
  }

  const current =
    barClose(
      slice[
        slice.length -
        1
      ]
    );

  if (
    !trs.length ||
    !Number.isFinite(
      current
    ) ||
    current <= 0
  ) {
    return 0;
  }

  return (
    average(
      trs
    ) /
    current
  ) *
  100;
}

function breakoutState(
  bars,
  lookback = 10
) {
  if (
    !Array.isArray(
      bars
    ) ||
    bars.length < 3
  ) {
    return {
      long: false,
      short: false,
    };
  }

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
        1 -
        lookback
      ),
      -1
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

  const close =
    barClose(
      current
    );

  if (
    !highs.length ||
    !lows.length ||
    !Number.isFinite(
      close
    )
  ) {
    return {
      long: false,
      short: false,
    };
  }

  return {
    long:
      close >
      Math.max(
        ...highs
      ),

    short:
      close <
      Math.min(
        ...lows
      ),
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
    9 * 60 +
    30 +
    Number(
      openingRangeMinutes ||
      5
    );

  const opening =
    session.filter(
      (bar) => {
        const p =
          etParts(
            barTime(
              bar
            )
          );

        return (
          p.minutes <
          cutoff
        );
      }
    );

  if (
    opening.length < 3
  ) {
    return {
      available: false,
      long: false,
      short: false,
      high: null,
      low: null,
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

  const current =
    barClose(
      session[
        session.length -
        1
      ]
    );

  if (
    !highs.length ||
    !lows.length ||
    !Number.isFinite(
      current
    )
  ) {
    return {
      available: false,
      long: false,
      short: false,
      high: null,
      low: null,
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
      current >
      high,

    short:
      current <
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

          config
            .cryptoMinStopPct
        ),

        config
          .cryptoMinStopPct,

        config
          .cryptoMaxStopPct
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

        config
          .equityMinStopPct
      ),

      config
        .equityMinStopPct,

      config
        .equityMaxStopPct
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

  const longVotes =
    [
      spy5,
      spy15,
      qqq5,
      qqq15,
    ].filter(
      (v) =>
        v > 0
    ).length;

  const shortVotes =
    [
      spy5,
      spy15,
      qqq5,
      qqq15,
    ].filter(
      (v) =>
        v < 0
    ).length;

  return {
    direction:
      longVotes >= 3
        ? 'LONG'
        : shortVotes >= 3
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
  const t5 =
    trendPct(
      btcBars,
      5
    );

  const t15 =
    trendPct(
      btcBars,
      15
    );

  return {
    direction:
      t5 > 0 &&
      t15 > 0
        ? 'LONG'
        : t5 < 0 &&
            t15 < 0
          ? 'SHORT'
          : 'NEUTRAL',

    btc5:
      Number(
        t5.toFixed(
          4
        )
      ),

    btc15:
      Number(
        t15.toFixed(
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

  const session =
    assetClass ===
    'us_equity'
      ? sessionBarsET(
          currentBars,
          now
        )
      : currentBars;

  const t5 =
    trendPct(
      currentBars,
      5
    );

  const t15 =
    trendPct(
      currentBars,
      15
    );

  const volRatio =
    recentVolumeRatio(
      currentBars,
      Number(
        config
          .recentVolumeLookback
      )
    );

  const spread =
    spreadPct(
      snapshot
    );

  const recentBreakout =
    breakoutState(
      currentBars,
      Number(
        config
          .breakoutLookbackBars
      )
    );

  const currentPrice =
    n(
      snapshot
        ?.latestTrade
        ?.p ??
      snapshot
        ?.minuteBar
        ?.c ??
      currentBars[
        currentBars.length -
        1
      ]?.c,
      NaN
    );

  const sessionVwap =
    vwap(
      session
    );

  const long =
    direction ===
    'LONG';

  const aligned5 =
    long
      ? t5 > 0
      : t5 < 0;

  const aligned15 =
    long
      ? t15 > 0
      : t15 < 0;

  const vwapAligned =
    Number.isFinite(
      currentPrice
    ) &&
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
        `spread ${spread.toFixed(
          3
        )}% > ${maxSpread}%`,
    };
  }

  let score =
    0;

  const components =
    {};

  components.trend15 =
    aligned15
      ? 2
      : 0;

  score +=
    components.trend15;

  components.trend5 =
    aligned5
      ? 1
      : 0;

  score +=
    components.trend5;

  let breakoutPoints =
    0;

  let openingRange =
    null;

  if (
    assetClass ===
    'us_equity'
  ) {
    openingRange =
      openingRangeState(
        currentBars,
        now,
        Number(
          config
            .openingRangeMinutes
        )
      );

    const orbAligned =
      openingRange.available &&
      (
        long
          ? openingRange.long
          : openingRange.short
      );

    const recentAligned =
      long
        ? recentBreakout.long
        : recentBreakout.short;

    breakoutPoints =
      orbAligned
        ? 2
        : recentAligned
          ? 2
          : 0;
  } else {
    breakoutPoints =
      (
        long
          ? recentBreakout.long
          : recentBreakout.short
      )
        ? 2
        : 0;
  }

  components.breakout =
    breakoutPoints;

  score +=
    breakoutPoints;

  components.volume =
    volRatio >=
    Number(
      config
        .recentVolumeStrongRatio
    )
      ? 2
      : volRatio >=
          Number(
            config
              .recentVolumeOkayRatio
          )
        ? 1
        : 0;

  score +=
    components.volume;

  components.vwap =
    vwapAligned
      ? 1
      : 0;

  score +=
    components.vwap;

  components.spread =
    spread == null ||
    spread <=
      maxSpread *
      0.60
      ? 1
      : 0;

  score +=
    components.spread;

  components.regime =
    regime?.direction ===
    direction
      ? 1
      : 0;

  score +=
    components.regime;

  if (
    assetClass ===
    'us_equity'
  ) {
    const nowET =
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
      nowET >=
        Number(
          config
            .closeMomentumStartMinutesET
        ) &&
      nowET <
        16 * 60 &&
      dailyAligned &&
      aligned15
    ) {
      score =
        Math.min(
          10,
          score + 1
        );

      components.closeMomentum =
        1;
    } else {
      components.closeMomentum =
        0;
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
        t5.toFixed(
          4
        )
      ),

    trend15Pct:
      Number(
        t15.toFixed(
          4
        )
      ),

    recentVolumeRatio:
      Number(
        volRatio.toFixed(
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

    openingRange,

    exitPlan:
      dynamicExitPlan(
        assetClass,
        currentBars,
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

  const chosen =
    shortScore.eligible &&
    shortScore.score >
      longScore.score
      ? {
          direction:
            'SHORT',

          detail:
            shortScore,
        }
      : {
          direction:
            'LONG',

          detail:
            longScore,
        };

  if (
    !chosen.detail
      .eligible
  ) {
    return null;
  }

  if (
    chosen.detail.score <
    Number(
      config
        .equityScoreThreshold
    )
  ) {
    return null;
  }

  const currentMomentum =
    minuteMomentumPct(
      snapshot
    );

  if (
    currentMomentum != null &&
    (
      (
        chosen.direction ===
          'LONG' &&
        currentMomentum <= 0
      ) ||
      (
        chosen.direction ===
          'SHORT' &&
        currentMomentum >= 0
      )
    )
  ) {
    return null;
  }

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
      NaN
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return null;
  }

  const orbAligned =
    chosen.detail
      .openingRange
      ?.available &&
    (
      chosen.direction ===
      'LONG'
        ? chosen.detail
            .openingRange
            .long
        : chosen.detail
            .openingRange
            .short
    );

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
      chosen.detail.score,

    price,

    strategy:
      orbAligned
        ? 'EQUITY_ORB_SCORE'
        : 'EQUITY_MTF_SCORE',

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
    !detail.eligible
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
      NaN
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <= 0
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
      'CRYPTO_MTF_SCORE',

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
    (trade) => {
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
