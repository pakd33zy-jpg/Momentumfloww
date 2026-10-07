import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import credentialsRouter from './credentials.js';
import sessionsRouter from './sessions.js';
import liveGateRouter from './liveGate.js';
import marketRouter from './market.js';
import chatRouter from './chat.js';
import tradingModeRouter from './tradingMode.js';
import tradingConfigRouter from './tradingConfig.js';
import liveBotRouter, { startLiveBotV35 } from './liveBotV35.js';
import v50PaperRouter from './liveBotV50.js';
import v26Router from './v26.js';
import researchRouter from './research.js';
import trendPullbackResearchRouter from './trendPullbackResearch.js';
import breakoutResearchRouter from './breakoutResearch.js';
import breakoutDailyLiquidResearchRouter from './breakoutDailyLiquidResearch.js';
import breakout5520ShadowRouter, { startBreakout5520Shadow } from './breakout5520ShadowRouter.js';
import breakout5520Validation50ShadowRouter, { startBreakout5520Validation50Shadow } from './breakout5520Validation50ShadowRouter.js';
import cryptoV51ShadowRouter from './cryptoV51ShadowRouter.js';
import c62ShadowRouter, { startC62Shadow } from './c62ShadowRouter.js';
import equityV71ShadowRouter, { startEquityV71Shadow } from './equityV71ShadowRouter.js';
import { startFastScalpMonitor } from './fastScalpMonitor.js';
import { startEquityFastScalpMonitor } from './equityFastScalpMonitor.js';
import { startCryptoV51ShadowMonitor } from './cryptoV51ShadowMonitor.js';
import { store } from './store.js';
import { initPersistentCredentials, loadPersistentConfig, persistConfig } from './persistentCredentialStore.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

function resetToPaperModeOnBoot() {
  const REQUIRED = ['understands_real_capital','reviewed_strategy_backtest','alpaca_live_key_configured','accepts_safety_halts','confirms_risk_tolerance'];
  store.setConfig('liveGateConsents', Object.fromEntries(REQUIRED.map((k) => [k, false])));
  store.setConfig('tradingMode', { mode: 'paper', updated_at: new Date().toISOString() });
  console.log('[boot] Live Gate consents reset and trading mode forced to paper.');
  console.log(`[boot] LIVE_TRADING_ENABLED=${String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true'}`);
}

function migrateActiveRuntimeConfigOnBoot() {
  const bot = store.getConfig('liveBotConfig', {});
  store.setConfig('liveBotConfig', {
    ...bot,
    maxOpenPositions: 8,
    maxEquityPositions: 8,
    v51CryptoRuntimeMigrated: true,
    macdPeakCryptoRuntimeMigrated: true,
  });

  const strategy = store.getConfig('strategyConfig', {});
  store.setConfig('strategyConfig', {
    ...strategy,
    cryptoV35Enabled: false,
    cryptoV51Enabled: false,
    cryptoMacdPeakEnabled: true,
    equityV35Enabled: strategy.equityV35Enabled !== false,
    cryptoV51MaxConcurrentPositions: 8,
    cryptoMacdPeakMaxConcurrentPositions: 8,
  });

  const trading = store.getConfig('tradingConfig', {});
  if (trading.equityFocusMode === true) {
    store.setConfig('tradingConfig', {
      ...trading,
      equityFocusMode: false,
    });
  }

  console.log('[boot] Legacy MACD crypto positions remain managed; new MACD entries are paused; C62 crypto runs shadow-only.');
}

const credentialPersistence = await initPersistentCredentials();

if (credentialPersistence.ready) {
  await Promise.all([
    loadPersistentConfig('tradingConfig', {}),
    loadPersistentConfig('strategyConfig', {}),
    loadPersistentConfig('liveBotConfig', {}),
    loadPersistentConfig('sessions', []),
    loadPersistentConfig('trades', []),
    loadPersistentConfig('breakout5520ShadowState', {}),
    loadPersistentConfig('breakout5520Validation50ShadowState', {}),
    loadPersistentConfig('c62ShadowState', {}),
  ]);
}

resetToPaperModeOnBoot();
migrateActiveRuntimeConfigOnBoot();

if (credentialPersistence.ready) {
  await Promise.all([
    persistConfig('tradingConfig', store.getConfig('tradingConfig', {})),
    persistConfig('strategyConfig', store.getConfig('strategyConfig', {})),
    persistConfig('liveBotConfig', store.getConfig('liveBotConfig', {})),
  ]);
  console.log('[boot] Persistent trading settings restored and synced.');
}
startFastScalpMonitor();
startEquityFastScalpMonitor();
// V51 shadow monitor retired from automatic startup.
startEquityV71Shadow();
startBreakout5520Shadow();
startBreakout5520Validation50Shadow();
startC62Shadow();

if (credentialPersistence.ready && credentialPersistence.loaded) {
  setTimeout(() => {
    startLiveBotV35()
      .then(() => console.log('[boot] MACD valley/cross paper execution bot auto-started.'))
      .catch((error) => console.warn(`[boot] MACD peak/trough paper execution auto-start skipped: ${error.message}`));
  }, 2500).unref?.();
} else {
  console.warn('[boot] MACD peak/trough execution not auto-started: waiting for persisted PAPER credentials.');
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/credentials', credentialsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/live-gate', liveGateRouter);
app.use('/api/market', marketRouter);
app.use('/api/chat', chatRouter);
app.use('/api/trading-mode', tradingModeRouter);
app.use('/api/trading-config', tradingConfigRouter);
app.use('/api/live-bot', liveBotRouter);
app.use('/api/v50-paper', v50PaperRouter);
app.use('/api/v26', v26Router);
app.use('/api/research', researchRouter);
app.use('/api/research/trend-pullback', trendPullbackResearchRouter);
app.use('/api/research/breakout', breakoutResearchRouter);
app.use('/api/research/breakout-liquid', breakoutDailyLiquidResearchRouter);
app.use('/api/breakout-55-20-shadow', breakout5520ShadowRouter);
app.use('/api/breakout-55-20-validation50-shadow', breakout5520Validation50ShadowRouter);
app.use('/api/crypto-v51-shadow', cryptoV51ShadowRouter);
app.use('/api/c62-shadow', c62ShadowRouter);
app.use('/api/equity-v71-shadow', equityV71ShadowRouter);
app.use((err, req, res, next) => { console.error('[error]', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MomentumFlow backend listening on port ${PORT}`));