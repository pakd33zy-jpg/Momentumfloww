// V34 MARKET INTELLIGENCE — evidence layer, never an automatic trade trigger.
//
// Inputs are news/events already associated with a tradable symbol by a data
// provider. This module scores *materiality, direction and recency* while the
// trading engine still requires price/volume/execution evidence.

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const POSITIVE_RULES = [
  {
    type: 'GOVERNMENT_CONTRACT',
    weight: 3.0,
    re: /\b(government|federal|dod|defense|army|navy|air force|department of (?:defense|energy|transportation|homeland security))\b.{0,90}\b(contract|award|order|procurement)\b|\b(contract|award)\b.{0,90}\b(government|federal|dod|defense|army|navy|air force)\b/i,
  },
  {
    type: 'GOVERNMENT_GRANT',
    weight: 2.5,
    re: /\b(government|federal|doe|department of energy|chips act|infrastructure law)\b.{0,90}\b(grant|funding|subsidy|loan guarantee)\b|\b(grant|funding)\b.{0,90}\b(government|federal|doe)\b/i,
  },
  {
    type: 'ACQUISITION_TARGET',
    weight: 3.5,
    re: /\b(to be acquired|agrees? to be acquired|takeover offer|buyout offer|take-private|going private|acquisition offer)\b/i,
  },
  {
    type: 'MAJOR_CONTRACT_OR_CUSTOMER',
    weight: 2.5,
    re: /\b(multi[- ]year contract|major contract|purchase agreement|supply agreement|offtake agreement|exclusive agreement|selected by|awarded by|new customer|strategic customer)\b/i,
  },
  {
    type: 'STRATEGIC_PARTNERSHIP',
    weight: 1.8,
    re: /\b(strategic partnership|strategic alliance|joint venture|collaboration agreement|licensing agreement)\b/i,
  },
  {
    type: 'REGULATORY_APPROVAL',
    weight: 2.8,
    re: /\b(fda approval|fda approves|regulatory approval|wins approval|approved by regulators?|permit approved|receives? approval)\b/i,
  },
  {
    type: 'GUIDANCE_UP',
    weight: 2.0,
    re: /\b(raises? guidance|raises? outlook|boosts? outlook|increases? guidance|guidance above|forecast above)\b/i,
  },
  {
    type: 'EARNINGS_BEAT',
    weight: 1.4,
    re: /\b(beats? (?:wall street )?(?:estimates|expectations)|earnings beat|revenue beat|profit beat|record (?:revenue|sales|profit))\b/i,
  },
  {
    type: 'INSIDER_BUYING',
    weight: 1.5,
    re: /\b(insider (?:buying|purchase)|ceo (?:buys|purchases)|director (?:buys|purchases)|open-market purchase)\b/i,
  },
  {
    type: 'ACTIVIST_OR_STAKE',
    weight: 1.6,
    re: /\b(activist investor|builds? stake|takes? stake|increases? stake|13d filing|strategic stake)\b/i,
  },
  {
    type: 'PRODUCTION_MILESTONE',
    weight: 1.7,
    re: /\b(begins? production|starts? production|commercial production|factory opens?|plant opens?|mine opens?|capacity expansion|production ramp)\b/i,
  },
];

const NEGATIVE_RULES = [
  {
    type: 'BANKRUPTCY_OR_DEFAULT',
    weight: -4.0,
    re: /\b(bankruptcy|chapter 11|defaults? on|debt default|going concern warning)\b/i,
  },
  {
    type: 'DILUTION_OR_OFFERING',
    weight: -2.4,
    re: /\b(public offering|registered direct offering|secondary offering|at-the-market offering|\batm offering\b|share offering|equity offering)\b/i,
  },
  {
    type: 'GUIDANCE_DOWN',
    weight: -2.4,
    re: /\b(cuts? guidance|lowers? guidance|slashes? outlook|cuts? outlook|forecast below)\b/i,
  },
  {
    type: 'EARNINGS_MISS',
    weight: -1.8,
    re: /\b(misses? (?:wall street )?(?:estimates|expectations)|earnings miss|revenue miss|profit miss)\b/i,
  },
  {
    type: 'REGULATORY_SETBACK',
    weight: -2.8,
    re: /\b(fda rejects?|approval denied|regulatory rejection|permit denied|clinical hold|recall)\b/i,
  },
  {
    type: 'INVESTIGATION',
    weight: -1.8,
    re: /\b(sec investigation|doj investigation|federal investigation|regulatory probe|accounting investigation)\b/i,
  },
  {
    type: 'CONTRACT_LOSS',
    weight: -2.0,
    re: /\b(loses? contract|contract terminated|contract canceled|contract cancelled|customer terminates?|customer cancels?)\b/i,
  },
];

function textOf(article = {}) {
  return [
    article.headline,
    article.summary,
    article.content,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function timestampOf(article = {}) {
  const raw =
    article.updated_at ||
    article.created_at ||
    article.timestamp ||
    article.published_at ||
    null;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function recencyMultiplierV34(article, now = new Date()) {
  const stamp = timestampOf(article);
  if (stamp == null) return 0.20;
  const ageHours = Math.max(0, (new Date(now).getTime() - stamp) / 3600000);
  if (ageHours <= 1) return 1.00;
  if (ageHours <= 4) return 0.90;
  if (ageHours <= 12) return 0.75;
  if (ageHours <= 24) return 0.55;
  if (ageHours <= 72) return 0.25;
  return 0;
}

function dollarMagnitudeBonus(text) {
  const matches = String(text || '').matchAll(/\$\s?([0-9]+(?:\.[0-9]+)?)\s*(billion|million|bn|b|m)\b/gi);
  let biggestMillions = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit = String(match[2]).toLowerCase();
    const millions = /billion|bn|^b$/.test(unit) ? value * 1000 : value;
    biggestMillions = Math.max(biggestMillions, millions);
  }
  if (biggestMillions >= 5000) return 1.00;
  if (biggestMillions >= 1000) return 0.75;
  if (biggestMillions >= 250) return 0.45;
  if (biggestMillions >= 50) return 0.20;
  return 0;
}

export function classifyNewsArticleV34(article, now = new Date()) {
  const text = textOf(article);
  if (!text) return null;
  const recency = recencyMultiplierV34(article, now);
  if (recency <= 0) return null;

  const hits = [];
  for (const rule of POSITIVE_RULES) {
    if (rule.re.test(text)) hits.push({ type: rule.type, weight: rule.weight });
  }
  for (const rule of NEGATIVE_RULES) {
    if (rule.re.test(text)) hits.push({ type: rule.type, weight: rule.weight });
  }
  if (!hits.length) return null;

  const positive = hits.filter((x) => x.weight > 0).reduce((sum, x) => sum + x.weight, 0);
  const negative = hits.filter((x) => x.weight < 0).reduce((sum, x) => sum + x.weight, 0);
  const magnitude = positive > 0 ? dollarMagnitudeBonus(text) : 0;
  const rawImpact = positive + negative + magnitude;
  const impact = clamp(rawImpact * recency, -5, 5);

  return {
    id: article.id ?? null,
    headline: article.headline || null,
    createdAt: article.created_at || article.updated_at || null,
    symbols: Array.isArray(article.symbols) ? article.symbols : [],
    recency: Number(recency.toFixed(3)),
    impact: Number(impact.toFixed(3)),
    types: hits.map((x) => x.type),
    magnitudeBonus: Number(magnitude.toFixed(2)),
  };
}

export function scoreNewsIntelligenceV34({
  symbol,
  articles = [],
  now = new Date(),
} = {}) {
  const normalized = String(symbol || '').replace('/', '').toUpperCase();
  const unique = new Map();

  for (const article of articles || []) {
    const symbols = (article?.symbols || []).map((x) => String(x || '').replace('/', '').toUpperCase());
    if (normalized && symbols.length && !symbols.includes(normalized)) continue;
    const key = String(article?.id ?? article?.headline ?? JSON.stringify(article));
    if (!unique.has(key)) unique.set(key, article);
  }

  const events = [...unique.values()]
    .map((article) => classifyNewsArticleV34(article, now))
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  // Diminishing returns prevent 10 near-duplicate headlines from overpowering
  // market behavior. Largest event matters most; confirmation adds less.
  let net = 0;
  const weights = [1, 0.55, 0.30, 0.20, 0.15];
  events.slice(0, weights.length).forEach((event, index) => {
    net += event.impact * weights[index];
  });
  net = clamp(net, -10, 10);

  const bullishScore = clamp(net > 0 ? net * 2 : 0, 0, 10);
  const bearishScore = clamp(net < 0 ? -net * 2 : 0, 0, 10);

  return {
    symbol: normalized,
    netScore: Number(net.toFixed(2)),
    score: Number(bullishScore.toFixed(2)),
    bearishScore: Number(bearishScore.toFixed(2)),
    eventCount: events.length,
    reasons: events.slice(0, 5).map((event) =>
      `${event.impact >= 0 ? '+' : ''}${event.impact.toFixed(2)} ${event.types.join('+')}: ${event.headline || 'news event'}`
    ),
    events: events.slice(0, 8),
  };
}

export function buildNewsIntelligenceMapV34({ articles = [], now = new Date() } = {}) {
  const symbols = new Set();
  for (const article of articles || []) {
    for (const symbol of article?.symbols || []) {
      const normalized = String(symbol || '').replace('/', '').toUpperCase();
      if (normalized) symbols.add(normalized);
    }
  }

  return Object.fromEntries(
    [...symbols].map((symbol) => [
      symbol,
      scoreNewsIntelligenceV34({ symbol, articles, now }),
    ])
  );
}

export function mergeIntelligenceV34(...inputs) {
  const good = inputs.filter(Boolean);
  if (!good.length) return { score: 0, bearishScore: 0, netScore: 0, reasons: [] };

  let net = 0;
  const reasons = [];
  for (const item of good) {
    const itemNet = Number.isFinite(Number(item.netScore))
      ? Number(item.netScore)
      : Number(item.score || 0);
    net += itemNet;
    if (Array.isArray(item.reasons)) reasons.push(...item.reasons);
  }
  net = clamp(net, -10, 10);

  return {
    score: Number(clamp(net > 0 ? net * 2 : 0, 0, 10).toFixed(2)),
    bearishScore: Number(clamp(net < 0 ? -net * 2 : 0, 0, 10).toFixed(2)),
    netScore: Number(net.toFixed(2)),
    reasons: [...new Set(reasons)].slice(0, 8),
  };
}
