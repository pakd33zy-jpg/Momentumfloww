import { store } from './store.js';
import { hasCredentials, getTradableAssets, getCryptoSnapshots, getCryptoBars } from './alpacaClient.js';
import { evaluateCryptoCandidateV35 } from './cryptoStrategyV35.js';
import {
  CRYPTO_V51_SHADOW_DEFAULTS,
  buildCryptoV51Observation,
  settleCryptoV51Observation,
  shouldSampleCryptoV51,
  summarizeCryptoV51,
} from './cryptoForwardLearningV51.js';

const COLLECTION = 'cryptoV51ForwardObservations';
const state = { running: false, timer: null, lastTickAt: null, lastError: null, lastSampled: 0, lastSettled: 0 };
const cfg = () => ({ ...CRYPTO_V51_SHADOW_DEFAULTS, ...store.getConfig('cryptoV51ShadowConfig', {}) });
const strategyCfg = () => ({ ...store.getConfig('strategyConfig', {}) });

function schedule(ms = 60000) {
  if (!state.running) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(tick, Math.max(15000, ms));
}

const priceFrom = (snapshot) => Number(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? 0);
const compact = (symbol) => String(symbol || '').replace('/', '');

async function tick() {
  if (!state.running) return;
  try {
    state.lastError = null;
    state.lastTickAt = new Date().toISOString();
    if (!hasCredentials('paper')) throw new Error('Paper Alpaca credentials required for V51 shadow monitor.');

    const assets = await getTradableAssets('paper');
    const crypto = assets.crypto || [];
    const symbols = crypto.map((a) => a.symbol).filter(Boolean);
    if (!symbols.length) throw new Error('No tradable crypto assets returned.');
    const snapshots = await getCryptoSnapshots('paper', symbols);
    let rows = store.getAll(COLLECTION);
    const now = Date.now();

    let settled = 0;
    rows = rows.map((row) => {
      if (row.status !== 'pending') return row;
      const due = new Date(row.observedAt).getTime() + Number(row.horizonMinutes || 60) * 60000;
      if (now < due) return row;
      const snapshot = snapshots[row.symbol] || snapshots[compact(row.symbol)];
      const price = priceFrom(snapshot);
      if (!(price > 0)) return row;
      settled += 1;
      return settleCryptoV51Observation(row, price);
    });

    const dueAssets = crypto.filter((a) => shouldSampleCryptoV51(rows, a.symbol, now, cfg()));
    let sampled = 0;
    if (dueAssets.length) {
      const detailSymbols = [...new Set([...dueAssets.map((a) => a.symbol), 'BTC/USD'])];
      const end = new Date();
      const [bars15m, bars1h, bars1d] = await Promise.all([
        getCryptoBars('paper', detailSymbols, { timeframe: '15Min', start: new Date(now - 14 * 24 * 60 * 60000), end, limit: 10000 }),
        Promise.all(detailSymbols.map(async (symbol) => getCryptoBars('paper', [symbol], { timeframe: '1Hour', start: new Date(now - 60 * 24 * 60 * 60000), end, limit: 2000, maxPages: 2 }))).then((parts) => Object.assign({}, ...parts)),
        getCryptoBars('paper', detailSymbols, { timeframe: '1Day', start: new Date(now - 180 * 24 * 60 * 60000), end, limit: 10000 }),
      ]);
      const btcBars1h = bars1h['BTC/USD'] || [];
      for (const asset of dueAssets) {
        const snapshot = snapshots[asset.symbol] || snapshots[compact(asset.symbol)];
        const price = priceFrom(snapshot);
        if (!(price > 0)) continue;
        const v35Result = evaluateCryptoCandidateV35({
          asset,
          snapshot,
          bars15m: bars15m[asset.symbol] || [],
          bars1h: bars1h[asset.symbol] || [],
          bars1d: bars1d[asset.symbol] || [],
          btcBars1h,
          config: strategyCfg(),
        });
        const observation = buildCryptoV51Observation({ symbol: asset.symbol, price, v35Result, config: cfg() });
        if (observation) { rows.push(observation); sampled += 1; }
      }
    }

    const maxRows = Math.max(100, Number(cfg().maxRows || 5000));
    if (rows.length > maxRows) rows = rows.slice(-maxRows);
    store.saveAll(COLLECTION, rows);
    state.lastSampled = sampled;
    state.lastSettled = settled;
    const summary = summarizeCryptoV51(rows);
    console.log(`[crypto-v51-shadow] tick ok universe=${crypto.length} sampled=${sampled} settled=${settled} total=${summary.totalObservations} pending=${summary.pending}`);
  } catch (error) {
    state.lastError = error.message;
    console.error('[crypto-v51-shadow]', error);
  } finally {
    schedule(60000);
  }
}

export function startCryptoV51ShadowMonitor() {
  if (state.running) return;
  state.running = true;
  console.log('[crypto-v51-shadow] V51 forward-learning monitor active (research-only, no orders).');
  tick();
}

export function cryptoV51ShadowStatus() {
  const rows = store.getAll(COLLECTION);
  return { ...state, timer: undefined, researchOnly: true, placesOrders: false, summary: summarizeCryptoV51(rows), recent: rows.slice(-20).reverse() };
}
