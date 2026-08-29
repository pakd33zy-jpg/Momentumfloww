// V34 equity paper-shadow data preflight. Market-data/account metadata reads only.
// This file does not import or call placeOrder.
import {
  getTradableAssets,
  getStockSnapshots,
  getStockBars,
  getMarketNews,
} from './alpacaClient.js';

const now = new Date();
const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);

const assets = await getTradableAssets('live');
const watched = new Set(['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA']);
const metadata = (assets?.equities || []).filter((a) => watched.has(String(a?.symbol || '').toUpperCase()));
const snapshots = await getStockSnapshots('live', ['SPY', 'QQQ', 'NVDA'], { feed: 'iex' });
const bars = await getStockBars('live', ['SPY', 'QQQ'], {
  timeframe: '1Min',
  start,
  end: now,
  limit: 1000,
  feed: 'iex',
  maxPages: 2,
});
const news = await getMarketNews('live', {
  symbols: ['SPY', 'QQQ', 'NVDA'],
  start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  end: now,
  limit: 10,
  includeContent: false,
});

console.log('[V34 equity preflight] PASS', JSON.stringify({
  orderPlacement: false,
  equityAssetsAvailable: (assets?.equities || []).length,
  watchedMetadata: metadata.map((a) => ({
    symbol: a.symbol,
    tradable: a.tradable,
    shortable: a.shortable,
    easyToBorrow: a.easy_to_borrow,
  })),
  snapshots: Object.keys(snapshots || {}),
  barCounts: {
    SPY: (bars?.SPY || []).length,
    QQQ: (bars?.QQQ || []).length,
  },
  newsCount: Array.isArray(news?.news) ? news.news.length : Array.isArray(news?.articles) ? news.articles.length : 0,
}));
