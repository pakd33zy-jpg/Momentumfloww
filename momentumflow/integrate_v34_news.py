from pathlib import Path


def replace_required(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Expected {label} not found')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Alpaca market-news client
# ---------------------------------------------------------------------------
alpaca_path = Path('momentumflow/alpacaClient.js')
alpaca = alpaca_path.read_text(encoding='utf-8-sig')

anchor = """const CASH_LIKE_CRYPTO_BASES =
  new Set(["""
news_fn = """export async function getMarketNews(
  mode,
  {
    symbols = [],
    start,
    end,
    limit = 50,
    includeContent = false,
  } = {}
) {
  const params = new URLSearchParams();
  const normalizedSymbols = (symbols || [])
    .map((symbol) => String(symbol || '').replace('/', '').trim())
    .filter(Boolean);

  if (normalizedSymbols.length) {
    params.set('symbols', normalizedSymbols.join(','));
  }
  if (start) {
    params.set(
      'start',
      start instanceof Date ? start.toISOString() : String(start)
    );
  }
  if (end) {
    params.set(
      'end',
      end instanceof Date ? end.toISOString() : String(end)
    );
  }
  params.set('sort', 'desc');
  params.set('limit', String(Math.max(1, Math.min(50, Number(limit) || 50))));
  params.set('include_content', includeContent ? 'true' : 'false');

  return alpacaDataRequest(
    mode,
    `/v1beta1/news?${params.toString()}`
  );
}

const CASH_LIKE_CRYPTO_BASES =
  new Set(["""
alpaca = replace_required(alpaca, anchor, news_fn, 'alpaca news insertion anchor')
alpaca_path.write_text(alpaca, encoding='utf-8')


# ---------------------------------------------------------------------------
# Live bot: refresh news once per minute; use it as evidence + prefilter rescue
# ---------------------------------------------------------------------------
live_path = Path('momentumflow/liveBot.js')
live = live_path.read_text(encoding='utf-8-sig')

old_import_piece = """  getCryptoBars,
  getLatestTradablePrice,
  hasCredentials,"""
new_import_piece = """  getCryptoBars,
  getMarketNews,
  getLatestTradablePrice,
  hasCredentials,"""
live = replace_required(live, old_import_piece, new_import_piece, 'getMarketNews import')

crypto_import = """import {
  CRYPTO_V34_DEFAULTS,
  evaluateCryptoCandidateV34,
  buildCryptoV34Budget,
} from './cryptoStrategyV34.js';"""
crypto_plus_intelligence = crypto_import + """

import {
  buildNewsIntelligenceMapV34,
  mergeIntelligenceV34,
} from './marketIntelligenceV34.js';"""
live = replace_required(live, crypto_import, crypto_plus_intelligence, 'market intelligence import')

state_anchor = """  cryptoV34Bars: {
    fetchedAt: 0,
    symbolsKey: '',
    bars15m: {},
    bars1h: {},
    bars1d: {},
  },

  universe:"""
state_repl = """  cryptoV34Bars: {
    fetchedAt: 0,
    symbolsKey: '',
    bars15m: {},
    bars1h: {},
    bars1d: {},
  },

  marketIntelligenceV34: {
    fetchedAt: 0,
    articleCount: 0,
    map: {},
    lastError: null,
  },

  universe:"""
live = replace_required(live, state_anchor, state_repl, 'market intelligence state')

config_anchor = """  rejectionOutcomeSeedLimit: 5,

  minEquityPrice: 1,"""
config_repl = """  rejectionOutcomeSeedLimit: 5,

  // V34 catalyst/news evidence. News cannot force an entry; a strong fresh
  // catalyst may rescue an otherwise liquid equity from the momentum prefilter
  // so the full strategy gets a chance to evaluate it.
  v34NewsRefreshMs: 60000,
  v34NewsLookbackHours: 24,
  v34CatalystPrefilterNetScore: 3.0,
  v34CatalystRankWeight: 0.15,

  minEquityPrice: 1,"""
live = replace_required(live, config_anchor, config_repl, 'V34 news config defaults')

scan_anchor = """async function scan(
  mode
) {"""
helpers = """function v34IntelligenceForSymbol(symbol) {
  const compact = String(symbol || '').replace('/', '').toUpperCase();
  const liveNews = state.marketIntelligenceV34.map?.[compact] || null;
  const configured = store.getConfig('marketIntelligenceV34', {});
  const external = configured?.[symbol] || configured?.[compact] || null;
  return mergeIntelligenceV34(liveNews, external);
}

async function refreshMarketIntelligenceV34(mode, now = new Date()) {
  const refreshMs = Math.max(30000, Number(cfg().v34NewsRefreshMs || 60000));
  if (
    state.marketIntelligenceV34.fetchedAt > 0 &&
    Date.now() - state.marketIntelligenceV34.fetchedAt < refreshMs
  ) {
    return state.marketIntelligenceV34.map;
  }

  try {
    const lookbackHours = Math.max(1, Math.min(72, Number(cfg().v34NewsLookbackHours || 24)));
    const response = await getMarketNews(mode, {
      start: new Date(new Date(now).getTime() - lookbackHours * 3600000),
      end: now,
      limit: 50,
      includeContent: false,
    });
    const articles = Array.isArray(response?.news)
      ? response.news
      : Array.isArray(response?.articles)
        ? response.articles
        : [];
    const map = buildNewsIntelligenceMapV34({ articles, now });

    state.marketIntelligenceV34 = {
      fetchedAt: Date.now(),
      articleCount: articles.length,
      map,
      lastError: null,
    };
    return map;
  } catch (error) {
    // News is supporting evidence, never a dependency that can stop trading.
    state.marketIntelligenceV34 = {
      ...state.marketIntelligenceV34,
      fetchedAt: Date.now(),
      lastError: String(error?.message || error),
    };
    return state.marketIntelligenceV34.map || {};
  }
}

async function scan(
  mode
) {"""
live = replace_required(live, scan_anchor, helpers, 'scan intelligence helpers')

now_anchor = """  const now =
    new Date();

  const finalCandidates ="""
now_repl = """  const now =
    new Date();

  await refreshMarketIntelligenceV34(mode, now);

  const finalCandidates ="""
live = replace_required(live, now_anchor, now_repl, 'news refresh before scan')

old_crypto_intel = """                intelligence: (() => {
                  const intelligence = store.getConfig('marketIntelligenceV34', {});
                  return intelligence?.[item.asset.symbol] ||
                    intelligence?.[String(item.asset.symbol || '').replace('/', '')] ||
                    null;
                })(),"""
new_crypto_intel = """                intelligence: v34IntelligenceForSymbol(item.asset.symbol),"""
live = replace_required(live, old_crypto_intel, new_crypto_intel, 'crypto live intelligence lookup')

old_prefilter = """      const longPrefilter =
        momentum >=
        threshold;

      const shortPrefilter =
        momentum <=
          -threshold &&
        asset.shortable ===
          true &&
        asset.easy_to_borrow ===
          true;

      if (
        !longPrefilter &&
        !shortPrefilter
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'below equity prefilter momentum'
        );

        continue;
      }"""
new_prefilter = """      const longPrefilter =
        momentum >=
        threshold;

      const shortPrefilter =
        momentum <=
          -threshold &&
        asset.shortable ===
          true &&
        asset.easy_to_borrow ===
          true;

      const intelligence =
        v34IntelligenceForSymbol(asset.symbol);
      const catalystRescue =
        Number(intelligence?.netScore || 0) >=
        Number(c.v34CatalystPrefilterNetScore || 3.0);

      if (
        !longPrefilter &&
        !shortPrefilter &&
        !catalystRescue
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'below equity prefilter momentum'
        );

        continue;
      }

      if (catalystRescue && !longPrefilter && !shortPrefilter) {
        bump(
          diag
            .prefilter
            .equities,
          'rescued by fresh material catalyst'
        );
      }"""
live = replace_required(live, old_prefilter, new_prefilter, 'equity catalyst prefilter rescue')

old_pre_push = """    pre.push({
      asset,
      snapshot,
      momentum,
      prefilterQuality:
        preQuality.quality,
      dayMovePct:
        preQuality.dayMovePct,
    });"""
new_pre_push = """    pre.push({
      asset,
      snapshot,
      momentum,
      prefilterQuality:
        preQuality.quality,
      dayMovePct:
        preQuality.dayMovePct,
      intelligence,
      catalystRescue,
    });"""
live = replace_required(live, old_pre_push, new_pre_push, 'equity intelligence shortlist fields')

old_sort = """        Number(
          b.prefilterQuality ||
          0
        ) -
        Number(
          a.prefilterQuality ||
          0
        ) ||
        Math.abs(
          b.momentum
        ) -
        Math.abs(
          a.momentum
        )"""
new_sort = """        (
          Number(b.prefilterQuality || 0) +
          Math.max(-2, Math.min(2, Number(b.intelligence?.netScore || 0) * 0.20))
        ) -
        (
          Number(a.prefilterQuality || 0) +
          Math.max(-2, Math.min(2, Number(a.intelligence?.netScore || 0) * 0.20))
        ) ||
        Math.abs(
          b.momentum
        ) -
        Math.abs(
          a.momentum
        )"""
live = replace_required(live, old_sort, new_sort, 'equity catalyst-aware shortlist sort')

old_preferred = """        const preferredDirection =
          item.momentum >= 0
            ? 'LONG'
            : 'SHORT';"""
new_preferred = """        const preferredDirection =
          item.catalystRescue === true
            ? 'LONG'
            : item.momentum >= 0
              ? 'LONG'
              : 'SHORT';"""
live = replace_required(live, old_preferred, new_preferred, 'catalyst preferred direction')

old_rank = """        signal.rank =
          rankSignal(
            signal,
            item.momentum,
            item.prefilterQuality
          );

        finalCandidates.push("""
new_rank = """        signal.intelligence = item.intelligence;
        signal.rank =
          rankSignal(
            signal,
            item.momentum,
            item.prefilterQuality
          ) +
          Math.max(
            -1.5,
            Math.min(
              1.5,
              Number(item.intelligence?.netScore || 0) *
                Number(c.v34CatalystRankWeight || 0.15)
            )
          );

        finalCandidates.push("""
live = replace_required(live, old_rank, new_rank, 'equity catalyst rank')

status_anchor = """          breakoutDistanceAtr:
            candidate
              .signal
              ?.breakoutDistanceAtr ??
            null,
        })"""
status_repl = """          breakoutDistanceAtr:
            candidate
              .signal
              ?.breakoutDistanceAtr ??
            null,

          intelligenceNetScore:
            candidate.intelligence?.netScore ??
            candidate.signal?.intelligenceNetScore ??
            null,

          intelligenceReasons:
            candidate.intelligence?.reasons ??
            candidate.signal?.intelligenceReasons ??
            [],
        })"""
live = replace_required(live, status_anchor, status_repl, 'top-candidate intelligence status')

scan_diag_anchor = """    topStrategyRejections: {
      crypto:
        topReasons(
          diag
            .strategy
            .crypto
        ),

      equities:
        topReasons(
          diag
            .strategy
            .equities
        ),
    },
  };"""
scan_diag_repl = """    topStrategyRejections: {
      crypto:
        topReasons(
          diag
            .strategy
            .crypto
        ),

      equities:
        topReasons(
          diag
            .strategy
            .equities
        ),
    },

    marketIntelligenceV34: {
      fetchedAt: state.marketIntelligenceV34.fetchedAt
        ? new Date(state.marketIntelligenceV34.fetchedAt).toISOString()
        : null,
      articleCount: state.marketIntelligenceV34.articleCount,
      symbolsWithMaterialNews: Object.values(state.marketIntelligenceV34.map || {})
        .filter((item) => Math.abs(Number(item?.netScore || 0)) >= 1)
        .length,
      lastError: state.marketIntelligenceV34.lastError,
    },
  };"""
live = replace_required(live, scan_diag_anchor, scan_diag_repl, 'scan intelligence diagnostics')

live_path.write_text(live, encoding='utf-8')


# ---------------------------------------------------------------------------
# Crypto intelligence must be directional: bad catalysts subtract confidence.
# ---------------------------------------------------------------------------
strategy_path = Path('momentumflow/cryptoStrategyV34.js')
strategy = strategy_path.read_text(encoding='utf-8')
old_intel = """  const intelligenceRaw = clamp(number(intelligence?.score, 0), 0, 10);
  const intelligenceScore = intelligenceRaw * c.cryptoV34IntelligenceWeight;"""
new_intel = """  const intelligenceRaw = Number.isFinite(Number(intelligence?.netScore))
    ? clamp(Number(intelligence.netScore), -10, 10)
    : clamp(number(intelligence?.score, 0), 0, 10);
  const intelligenceScore = intelligenceRaw * c.cryptoV34IntelligenceWeight;"""
strategy = replace_required(strategy, old_intel, new_intel, 'directional crypto intelligence')
strategy_path.write_text(strategy, encoding='utf-8')

print('V34 live-news integration patch applied')
