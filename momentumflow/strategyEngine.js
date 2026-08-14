// STRATEGY ENGINE v18 BALANCED
// More opportunities than v17, while keeping trend/VWAP/spread quality gates.
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
  equityStartMinutesET: 9 * 60 + 35,
  equityEndMinutesET: 15 * 60 + 50,

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

  closeMomentumStartMinutesET: 15 * 60 + 30,
};

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const num = (v, f = 0) =>
  Number.isFinite(Number(v))
    ? Number(v)
    : f;

const clamp = (v, lo, hi) =>
  Math.max(
    lo,
    Math.min(
      hi,
      v
    )
  );

const avg = (a = []) => {
  const x =
    a.filter(
      Number.isFinite
    );

  return x.length
    ? x.reduce(
        (s, v) =>
          s + v,
        0
      ) / x.length
    : 0;
};

const t = (b) =>
  b?.t ||
  b?.timestamp ||
  null;

const c = (b) =>
  num(
    b?.c,
    NaN
  );

const h = (b) =>
  num(
    b?.h,
    NaN
  );

const l = (b) =>
  num(
    b?.l,
    NaN
  );

const v = (b) =>
  num(
    b?.v,
    0
  );

function etParts(
  value
) {
  const p =
    Object.fromEntries(
      ET
        .formatToParts(
          value instanceof Date
            ? value
            : new Date(value)
        )
        .map(
          x => [
            x.type,
            x.value,
          ]
        )
    );

  return {
    dateKey:
      `${p.year}-${p.month}-${p.day}`,

    minutes:
      Number(
        p.hour
      ) *
        60 +
      Number(
        p.minute
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
    bar => {
      const ms =
        t(bar)
          ? new Date(
              t(bar)
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
    bars.at(-1)
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
  const out =
    Array.isArray(
      bars
    )
      ? [
          ...bars,
        ]
      : [];

  const mb =
    snapshot
      ?.minuteBar;

  if (
    !mb ||
    !Number.isFinite(
      Number(
        mb?.c
      )
    )
  ) {
    return out;
  }

  const stamp =
    t(
      mb
    );

  const i =
    stamp
      ? out.findIndex(
          x =>
            t(x) ===
            stamp
        )
      : -1;

  if (
    i >= 0
  ) {
    out[i] =
      mb;
  } else {
    out.push(
      mb
    );
  }

  out.sort(
    (a, b) =>
      new Date(
        t(a) ||
        0
      ) -
      new Date(
        t(b) ||
        0
      )
  );

  return out;
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

  return (
    Number.isFinite(
      open
    ) &&
    Number.isFinite(
      close
    ) &&
    open > 0
  )
    ? (
        (
          close -
          open
        ) /
        open
      ) *
      100
    : null;
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

  const a =
    c(
      bars.at(-1)
    );

  const b =
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

  return (
    Number.isFinite(
      a
    ) &&
    Number.isFinite(
      b
    ) &&
    b > 0
  )
    ? (
        (
          a -
          b
        ) /
        b
      ) *
      100
    : 0;
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
      bars.at(-1)
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
          x =>
            x >
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
    bar => {
      if (
        !t(
          bar
        )
      ) {
        return false;
      }

      const p =
        etParts(
          t(bar)
        );

      return (
        p.dateKey ===
          today &&
        p.minutes >=
          570 &&
        p.minutes <=
          960
      );
    }
  );
}

function inEquityWindow(
  now,
  cfg
) {
  if (
    !cfg
      .useEquityTimeWindow
  ) {
    return true;
  }

  const m =
    etParts(
      now
    ).minutes;

  return (
    m >=
      Number(
        cfg
          .equityStartMinutesET
      ) &&
    m <=
      Number(
        cfg
          .equityEndMinutesET
      )
  );
}

function vwap(
  bars = []
) {
  let pv =
    0;

  let vol =
    0;

  for (
    const bar of
    bars
  ) {
    const hi =
      h(bar);

    const lo =
      l(bar);

    const cl =
      c(bar);

    const qty =
      v(bar);

    if (
      ![
        hi,
        lo,
        cl,
      ].every(
        Number.isFinite
      ) ||
      qty <= 0
    ) {
      continue;
    }

    pv +=
      (
        (
          hi +
          lo +
          cl
        ) /
        3
      ) *
      qty;

    vol +=
      qty;
  }

  return vol > 0
    ? pv /
      vol
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

  const s =
    bars.slice(
      -(
        lookback +
        1
      )
    );

  const tr =
    [];

  for (
    let i = 1;
    i <
    s.length;
    i++
  ) {
    const hi =
      h(
        s[i]
      );

    const lo =
      l(
        s[i]
      );

    const pc =
      c(
        s[
          i -
          1
        ]
      );

    if (
      ![
        hi,
        lo,
        pc,
      ].every(
        Number.isFinite
      )
    ) {
      continue;
    }

    tr.push(
      Math.max(
        hi -
          lo,

        Math.abs(
          hi -
          pc
        ),

        Math.abs(
          lo -
          pc
        )
      )
    );
  }

  return avg(
    tr
  );
}

function atrPct(
  bars,
  lookback = 14
) {
  const a =
    atrAbsolute(
      bars,
      lookback
    );

  const price =
    c(
      bars?.at(-1)
    );

  return (
    a > 0 &&
    Number.isFinite(
      price
    ) &&
    price > 0
  )
    ? (
        a /
        price
      ) *
      100
    : 0;
}

function rollingBreakout(
  bars,
  lookback = 8
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
    bars.at(-1);

  const previous =
    bars.at(-2);

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

  const cc =
    c(
      current
    );

  const pc =
    c(
      previous
    );

  if (
    !highs.length ||
    !lows.length ||
    !Number.isFinite(
      cc
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
    available: true,

    long:
      cc >
      high,

    short:
      cc <
      low,

    confirmedLong:
      Number.isFinite(
        pc
      ) &&
      pc >
        high &&
      cc >
        high,

    confirmedShort:
      Number.isFinite(
        pc
      ) &&
      pc <
        low &&
      cc <
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
    available: false,
    long: false,
    short: false,
    confirmedLong: false,
    confirmedShort: false,
    high: null,
    low: null,
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

  const open =
    session.filter(
      b =>
        t(b) &&
        etParts(
          t(b)
        ).minutes <
          cutoff
    );

  const after =
    session.filter(
      b =>
        t(b) &&
        etParts(
          t(b)
        ).minutes >=
          cutoff
    );

  if (
    open.length <
      3 ||
    !after.length
  ) {
    return none;
  }

  const highs =
    open
      .map(
        h
      )
      .filter(
        Number.isFinite
      );

  const lows =
    open
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

  const cc =
    c(
      after.at(-1)
    );

  const pc =
    c(
      after.at(-2)
    );

  return {
    available:
      Number.isFinite(
        cc
      ),

    long:
      Number.isFinite(
        cc
      ) &&
      cc >
        high,

    short:
      Number.isFinite(
        cc
      ) &&
      cc <
        low,

    confirmedLong:
      Number.isFinite(
        pc
      ) &&
      pc >
        high &&
      cc >
        high,

    confirmedShort:
      Number.isFinite(
        pc
      ) &&
      pc <
        low &&
      cc <
        low,

    high,
    low,
  };
}

function exitPlan(
  assetClass,
  bars,
  cfg
) {
  const atr =
    atrPct(
      bars,
      Number(
        cfg
          .atrLookbackBars ||
        14
      )
    );

  const mult =
    Number(
      cfg
        .atrMultiplier ||
      1.25
    );

  const crypto =
    assetClass ===
    'crypto';

  const minStop =
    Number(
      crypto
        ? cfg
            .cryptoMinStopPct
        : cfg
            .equityMinStopPct
    );

  const maxStop =
    Number(
      crypto
        ? cfg
            .cryptoMaxStopPct
        : cfg
            .equityMaxStopPct
    );

  const minTp =
    Number(
      crypto
        ? cfg
            .cryptoMinTakeProfitPct
        : cfg
            .equityMinTakeProfitPct
    );

  const stop =
    clamp(
      Math.max(
        atr *
          mult,
        minStop
      ),
      minStop,
      maxStop
    );

  const tp =
    Math.max(
      minTp,

      stop *
        Number(
          cfg
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
        tp.toFixed(
          4
        )
      ),

    trailTriggerPct:
      Number(
        (
          stop *
          Number(
            cfg
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
            cfg
              .trailingDistanceR
          )
        ).toFixed(
          4
        )
      ),

    maxHoldMinutes:
      Number(
        crypto
          ? cfg
              .cryptoMaxHoldMinutes
          : cfg
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
      x =>
        x >
        0
    ).length;

  const shorts =
    values.filter(
      x =>
        x <
        0
    ).length;

  return {
    direction:
      longs >= 3
        ? 'LONG'
        : shorts >= 3
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

const reject = (
  reason,
  extra = {}
) => ({
  eligible: false,
  score: 0,
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

  const t5 =
    trendPct(
      signalBars,
      5
    );

  const t15 =
    trendPct(
      signalBars,
      15
    );

  const a5 =
    long
      ? t5 > 0
      : t5 < 0;

  const a15 =
    long
      ? t15 > 0
      : t15 < 0;

  if (
    !a15
  ) {
    return reject(
      '15m trend is not aligned',
      {
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
      }
    );
  }

  const momentum =
    minuteMomentumPct(
      snapshot
    );

  const minMom =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoMinEntryMomentumPct
        : config
            .equityMinEntryMomentumPct
    );

  const strongMom =
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
          minMom
        : momentum >
          -minMom
    )
  ) {
    return reject(
      `entry momentum below ${minMom}% threshold`,
      {
        minuteMomentumPct:
          momentum,
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
      `market regime is ${regime.direction}`
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
      'price is not aligned with VWAP'
    );
  }

  const vr =
    volumeRatio(
      signalBars,
      Number(
        config
          .recentVolumeLookback
      )
    );

  const rb =
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
    !!orb
      ?.available &&
    (
      long
        ? orb.long
        : orb.short
    );

  const orbConfirmed =
    !!orb
      ?.available &&
    (
      long
        ? orb
            .confirmedLong
        : orb
            .confirmedShort
    );

  const rollAligned =
    long
      ? rb.long
      : rb.short;

  const rollConfirmed =
    long
      ? rb
          .confirmedLong
      : rb
          .confirmedShort;

  const breakoutAligned =
    orbAligned ||
    rollAligned;

  const breakoutConfirmed =
    orbConfirmed ||
    rollConfirmed;

  const continuation =
    a5 &&
    vr >=
      Number(
        config
          .recentVolumeOkayRatio
      ) &&
    Math.abs(
      momentum
    ) >=
      strongMom;

  if (
    !breakoutAligned &&
    !continuation
  ) {
    return reject(
      'no breakout or strong continuation trigger',
      {
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

        minuteMomentumPct:
          Number(
            momentum.toFixed(
              4
            )
          ),

        recentVolumeRatio:
          Number(
            vr.toFixed(
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
      : rollAligned
        ? rollConfirmed
          ? 'ROLLING_CONFIRMED'
          : 'ROLLING'
        : 'CONTINUATION';

  const level =
    orbAligned
      ? long
        ? orb.high
        : orb.low
      : rollAligned
        ? long
          ? rb.high
          : rb.low
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

  const vwapDist =
    Number.isFinite(
      sessionVwap
    )
      ? Math.abs(
          price -
          sessionVwap
        ) /
        atr
      : Infinity;

  const maxVwapDist =
    Number(
      assetClass ===
      'crypto'
        ? config
            .cryptoMaxVwapDistanceAtr
        : config
            .equityMaxVwapDistanceAtr
    );

  if (
    vwapDist >
    maxVwapDist
  ) {
    return reject(
      `too extended from VWAP (${vwapDist.toFixed(2)} ATR)`
    );
  }

  let breakoutDist =
    null;

  if (
    Number.isFinite(
      level
    )
  ) {
    breakoutDist =
      Math.abs(
        price -
        level
      ) /
      atr;

    const maxBreakoutDist =
      Number(
        assetClass ===
        'crypto'
          ? config
              .cryptoMaxBreakoutDistanceAtr
          : config
              .equityMaxBreakoutDistanceAtr
      );

    if (
      breakoutDist >
      maxBreakoutDist
    ) {
      return reject(
        `late breakout chase (${breakoutDist.toFixed(2)} ATR)`
      );
    }
  }

  const components = {
    trend15: 2,

    trend5:
      a5
        ? 1
        : 0,

    breakout:
      breakoutConfirmed
        ? 2
        : breakoutAligned
          ? 1
          : 0,

    volume:
      vr >=
      Number(
        config
          .recentVolumeStrongRatio
      )
        ? 2
        : vr >=
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
      Math.abs(
        momentum
      ) >=
      strongMom
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
        (s, x) =>
          s + x,
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
    eligible: true,

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

    minuteMomentumPct:
      Number(
        momentum.toFixed(
          4
        )
      ),

    recentVolumeRatio:
      Number(
        vr.toFixed(
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
        vwapDist.toFixed(
          3
        )
      ),

    breakoutDistanceAtr:
      breakoutDist == null
        ? null
        : Number(
            breakoutDist.toFixed(
              3
            )
          ),

    breakoutType,

    breakoutLevel:
      Number.isFinite(
        level
      )
        ? Number(
            level.toFixed(
              6
            )
          )
        : null,

    openingRange:
      orb,

    rollingBreakout:
      rb,

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
        ? 'CRYPTO_BREAKOUT_BALANCED'
        : 'CRYPTO_CONTINUATION_BALANCED'
      : detail
          .breakoutType
          ?.startsWith(
            'ORB'
          )
        ? 'EQUITY_ORB_BALANCED'
        : detail.trigger ===
            'breakout'
          ? 'EQUITY_BREAKOUT_BALANCED'
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
      signal: null,

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
    (a, b) =>
      b.detail
        .score -
      a.detail
        .score
  );

  const chosen =
    choices[0];

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
      signal: null,

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
      signal: null,

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
      signal: null,

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
    trade => {
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
