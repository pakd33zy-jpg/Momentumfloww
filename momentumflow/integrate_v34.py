from pathlib import Path


def replace_required(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Expected {label} not found')
    return text.replace(old, new, 1)


path = Path('momentumflow/liveBot.js')
text = path.read_text(encoding='utf-8-sig')

old_import = """import {
  CRYPTO_V33_DEFAULTS,
  evaluateCryptoCandidateV33,
  buildCryptoV33Budget,
} from './cryptoStrategyV33.js';"""
new_import = """import {
  CRYPTO_V34_DEFAULTS,
  evaluateCryptoCandidateV34,
  buildCryptoV34Budget,
} from './cryptoStrategyV34.js';"""
text = replace_required(text, old_import, new_import, 'V33 import block')

for old, new in {
    'cryptoV33Bars': 'cryptoV34Bars',
    '...CRYPTO_V33_DEFAULTS,': '...CRYPTO_V34_DEFAULTS,',
    'cryptoV33Enabled': 'cryptoV34Enabled',
    'cryptoV33Symbols': 'cryptoV34Symbols',
    'cryptoV33MaxSpreadPct': 'cryptoV34MaxSpreadPct',
    'evaluateCryptoCandidateV33': 'evaluateCryptoCandidateV34',
    'buildCryptoV33Budget': 'buildCryptoV34Budget',
    'cryptoV33RiskFraction': 'cryptoV34RiskFraction',
    'cryptoV33MaxConcurrentPositions': 'cryptoV34MaxConcurrentPositions',
    'CRYPTO_V33_TREND_PULLBACK': 'CRYPTO_V34_EVIDENCE',
    'waiting for V33 setup': 'waiting for V34 evidence setup',
    'outside V33 liquid crypto universe': 'outside V34 configured crypto universe',
    "'v33-crypto-trend-v20-equities'": "'v34-evidence-crypto-v20-equities'",
    "'v20-adaptive-equities'": "'v34-evidence-crypto-v20-adaptive-equities'",
}.items():
    text = text.replace(old, new)

text = text.replace('  maxOpenPositions: 3,', '  maxOpenPositions: 8,', 1)

old_max_fn = """function maxOpenPositions() {
  const value = Math.trunc(
    Number(
      cfg().maxOpenPositions ??
      3
    )
  );

  return Number.isFinite(value)
    ? Math.max(
        1,
        Math.min(
          10,
          value
        )
      )
    : 3;
}"""
new_max_fn = """function maxOpenPositions() {
  const value = Math.trunc(
    Number(
      cfg().maxOpenPositions ??
      8
    )
  );

  const configured = Number.isFinite(value)
    ? Math.max(1, Math.min(10, value))
    : 8;

  // V34 uses portfolio risk as the primary limiter. Do not let an old
  // maxOpenPositions=3 setting recreate the V33 one-position bottleneck.
  const v34Floor = strategyCfg().cryptoV34Enabled === true
    ? Math.max(
        1,
        Math.min(
          10,
          Number(strategyCfg().cryptoV34MaxConcurrentPositions || 6)
        )
      )
    : 1;

  return Math.max(configured, v34Floor);
}"""
text = replace_required(text, old_max_fn, new_max_fn, 'maxOpenPositions function')

marker = """function buildPositionBudget({
  equity,
  buyingPower,
  cash,
  currentCryptoExposure = 0,
  best,
}) {"""
helper = """function currentOpenPortfolioRiskDollars() {
  return getSessionOpenTrades().reduce((sum, trade) => {
    const notional = Number(
      trade.actual_entry_notional ??
      trade.planned_position_budget ??
      0
    );
    const totalRiskPct = Number(
      trade.sizing_total_risk_pct ??
      (
        Number(trade.sizing_stop_pct ?? trade.stop_loss_pct ?? 0) +
        Number(trade.estimated_round_trip_cost_pct ?? 0)
      )
    );
    const recorded = Number(trade.planned_risk_dollars ?? 0);
    const estimated =
      Number.isFinite(notional) && notional > 0 &&
      Number.isFinite(totalRiskPct) && totalRiskPct > 0
        ? notional * (totalRiskPct / 100)
        : recorded;
    return sum + (Number.isFinite(estimated) ? Math.max(0, estimated) : 0);
  }, 0);
}

function currentOpenCryptoTradeCount() {
  return getSessionOpenTrades().filter((trade) =>
    trade.asset_class === 'crypto' || String(trade.market || '').includes('/')
  ).length;
}

function buildPositionBudget({
  equity,
  buyingPower,
  cash,
  currentCryptoExposure = 0,
  currentOpenRiskDollars = 0,
  best,
}) {"""
text = replace_required(text, marker, helper, 'buildPositionBudget marker')

old_budget = """  if (
    best?.assetClass === 'crypto' &&
    best?.strategy === 'CRYPTO_V34_EVIDENCE'
  ) {
    const positionBudget = buildCryptoV34Budget({
      equity,
      cash,
      currentCryptoExposure,
      signal: best,
      config: strategyCfg(),
    });

    return {
      requestedRiskFraction: Number(strategyCfg().cryptoV34RiskFraction),
      effectiveRiskFraction: Number(strategyCfg().cryptoV34RiskFraction),
      stopPct: Number(best.signal.exitPlan.stopLossPct),
      estimatedRoundTripCostPct: Number(best.signal.exitPlan.estimatedRoundTripCostPct),
      totalRiskPct: Number(best.signal.exitPlan.stopLossPct) +
        Number(best.signal.exitPlan.estimatedRoundTripCostPct),
      riskDollars: equity * Number(strategyCfg().cryptoV34RiskFraction),
      positionBudget,
    };
  }"""
new_budget = """  if (
    best?.assetClass === 'crypto' &&
    best?.strategy === 'CRYPTO_V34_EVIDENCE'
  ) {
    const sc = strategyCfg();
    const stopPct = Number(best.signal.exitPlan.stopLossPct);
    const estimatedRoundTripCostPct = Number(
      best.signal.exitPlan.estimatedRoundTripCostPct || 0
    );
    const totalRiskPct = stopPct + estimatedRoundTripCostPct;
    const requestedRiskFraction = Number(sc.cryptoV34RiskFraction);
    const maxPortfolioRiskDollars =
      equity * Number(sc.cryptoV34MaxPortfolioRiskFraction);
    const remainingPortfolioRiskDollars = Math.max(
      0,
      maxPortfolioRiskDollars - Math.max(0, currentOpenRiskDollars)
    );
    const riskDollars = Math.min(
      equity * requestedRiskFraction,
      remainingPortfolioRiskDollars
    );
    const positionBudget = buildCryptoV34Budget({
      equity,
      cash,
      currentCryptoExposure,
      currentOpenRiskDollars,
      signal: best,
      config: sc,
    });

    return {
      requestedRiskFraction,
      effectiveRiskFraction: requestedRiskFraction,
      stopPct,
      estimatedRoundTripCostPct,
      totalRiskPct,
      riskDollars,
      positionBudget,
      qualityRiskMultiplier: 1,
      earlyEntryRiskMultiplier: 1,
      maxPositionFraction: Number(sc.cryptoV34MaxPositionFraction),
      currentOpenRiskDollars,
      maxPortfolioRiskDollars,
      remainingPortfolioRiskDollars,
    };
  }"""
text = replace_required(text, old_budget, new_budget, 'V34 budget block')

old_call = """  const sizing =
    buildPositionBudget({
      equity,
      buyingPower,
      cash,
      currentCryptoExposure,
      best,
    });"""
new_call = """  const currentOpenRiskDollars =
    currentOpenPortfolioRiskDollars();

  const sizing =
    buildPositionBudget({
      equity,
      buyingPower,
      cash,
      currentCryptoExposure,
      currentOpenRiskDollars,
      best,
    });"""
text = replace_required(text, old_call, new_call, 'buildPositionBudget call')

old_eval = """            ? evaluateCryptoCandidateV34({
                asset: item.asset,
                snapshot: item.snapshot,
                bars15m: bars15mBySymbol[item.asset.symbol] || [],
                bars1h: bars1hBySymbol[item.asset.symbol] || [],
                bars1d: bars1dBySymbol[item.asset.symbol] || [],
                config: sc,
              })"""
new_eval = """            ? evaluateCryptoCandidateV34({
                asset: item.asset,
                snapshot: item.snapshot,
                bars15m: bars15mBySymbol[item.asset.symbol] || [],
                bars1h: bars1hBySymbol[item.asset.symbol] || [],
                bars1d: bars1dBySymbol[item.asset.symbol] || [],
                intelligence: (() => {
                  const intelligence = store.getConfig('marketIntelligenceV34', {});
                  return intelligence?.[item.asset.symbol] ||
                    intelligence?.[String(item.asset.symbol || '').replace('/', '')] ||
                    null;
                })(),
                config: sc,
              })"""
text = replace_required(text, old_eval, new_eval, 'V34 evaluator call')

old_score = """  const score =
    Number(
      detail
        ?.score ||
      0
    );"""
new_score = """  const rawScore =
    detail?.score ??
    d.score ??
    null;

  const score =
    rawScore == null
      ? null
      : Number(rawScore);"""
text = replace_required(text, old_score, new_score, 'near-miss score block')

pub_anchor = """    strategyVersion:
      'v34-evidence-crypto-v20-equities',"""
pub_insert = """    v34Risk: (() => {
      const openRiskDollars = currentOpenPortfolioRiskDollars();
      const referenceEquity = Number(
        state.lastAccountEquity ||
        paperForwardSessionSummary()?.startingCapital ||
        0
      );
      const maxRiskFraction = Number(
        strategyCfg().cryptoV34MaxPortfolioRiskFraction || 0.025
      );
      const maxRiskDollars = referenceEquity > 0
        ? referenceEquity * maxRiskFraction
        : null;
      return {
        openRiskDollars: Number(openRiskDollars.toFixed(4)),
        openRiskFraction: referenceEquity > 0
          ? Number((openRiskDollars / referenceEquity).toFixed(6))
          : null,
        maxPortfolioRiskFraction: maxRiskFraction,
        maxPortfolioRiskDollars: maxRiskDollars == null
          ? null
          : Number(maxRiskDollars.toFixed(4)),
        remainingRiskDollars: maxRiskDollars == null
          ? null
          : Number(Math.max(0, maxRiskDollars - openRiskDollars).toFixed(4)),
        openCryptoPositions: currentOpenCryptoTradeCount(),
        maxCryptoPositions: Number(
          strategyCfg().cryptoV34MaxConcurrentPositions || 6
        ),
      };
    })(),

    strategyVersion:
      'v34-evidence-crypto-v20-equities',"""
text = replace_required(text, pub_anchor, pub_insert, 'V34 status anchor')

state_anchor = """  lastError: null,

  openTradeIds: [],"""
state_repl = """  lastError: null,
  lastAccountEquity: null,

  openTradeIds: [],"""
text = replace_required(text, state_anchor, state_repl, 'state account equity anchor')

equity_anchor = """  const cash =
    Number(
      account.cash ||
      0
    );"""
equity_repl = equity_anchor + """

  if (Number.isFinite(equity) && equity > 0) {
    state.lastAccountEquity = equity;
  }"""
text = replace_required(text, equity_anchor, equity_repl, 'account equity update anchor')

if 'cryptoV33' in text or 'CRYPTO_V33' in text:
    raise SystemExit('V33 references remain in liveBot.js')

path.write_text(text, encoding='utf-8')

strategy = Path('momentumflow/cryptoStrategyV34.js')
st = strategy.read_text(encoding='utf-8')
old = "  const riskSizedNotional = usableRiskDollars / (stopPct / 100);"
new = """  const totalRiskPct =
    stopPct + Math.max(0, Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || 0));
  const riskSizedNotional = usableRiskDollars / (totalRiskPct / 100);"""
st = replace_required(st, old, new, 'V34 risk sizing line')
strategy.write_text(st, encoding='utf-8')

ui = Path('momentumflow/frontend/src/components/RejectionLogPanel.jsx')
u = ui.read_text(encoding='utf-8')
u = u.replace('bestScore: 0,', 'bestScore: null,', 1)
old_ui = "      current.bestScore = Math.max(current.bestScore, Number(miss?.score || 0));"
new_ui = """      if (miss?.score != null && Number.isFinite(Number(miss.score))) {
        current.bestScore = current.bestScore == null
          ? Number(miss.score)
          : Math.max(current.bestScore, Number(miss.score));
      }"""
u = replace_required(u, old_ui, new_ui, 'rejection UI score aggregation')
u = u.replace(
    '.sort((a, b) => b.bestScore - a.bestScore || b.count - a.count)',
    '.sort((a, b) => Number(b.bestScore ?? -1) - Number(a.bestScore ?? -1) || b.count - a.count)',
    1,
)
u = u.replace(
    '<strong>{item.bestScore}/10</strong> · {item.reason}',
    "<strong>{item.bestScore == null ? 'N/A' : `${item.bestScore}/10`}</strong> · {item.reason}",
    1,
)
u = u.replace(
    'score {near.score}/10',
    "score {near.score == null ? 'N/A' : `${near.score}/10`}",
    1,
)
ui.write_text(u, encoding='utf-8')

print('V34 integration patch applied')
