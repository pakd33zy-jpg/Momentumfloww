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
import liveBotRouter from './liveBotV35.js';
import v26Router from './v26.js';
import researchRouter from './research.js';
import { startFastScalpMonitor } from './fastScalpMonitor.js';
import { startEquityFastScalpMonitor } from './equityFastScalpMonitor.js';
import { store } from './store.js';

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

function migrateV35RuntimeConfigOnBoot() {
  const bot = store.getConfig('liveBotConfig', {});
  if (bot.v35RuntimeMigrated !== true) {
    store.setConfig('liveBotConfig', {
      ...bot,
      maxOpenPositions: 8,
      maxEquityPositions: 8,
      v35RuntimeMigrated: true,
    });
  }

  const strategy = store.getConfig('strategyConfig', {});
  store.setConfig('strategyConfig', {
    ...strategy,
    cryptoV35Enabled: strategy.cryptoV35Enabled !== false,
    equityV35Enabled: strategy.equityV35Enabled !== false,
    cryptoV35MaxConcurrentPositions: 8,
  });

  const trading = store.getConfig('tradingConfig', {});
  if (trading.equityFocusMode === true) {
    store.setConfig('tradingConfig', {
      ...trading,
      equityFocusMode: false,
    });
  }

  console.log('[boot] V35 runtime active: independent equity/crypto engines; crypto max concurrent positions=8.');
}

resetToPaperModeOnBoot();
migrateV35RuntimeConfigOnBoot();
startFastScalpMonitor();
startEquityFastScalpMonitor();

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/credentials', credentialsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/live-gate', liveGateRouter);
app.use('/api/market', marketRouter);
app.use('/api/chat', chatRouter);
app.use('/api/trading-mode', tradingModeRouter);
app.use('/api/trading-config', tradingConfigRouter);
app.use('/api/live-bot', liveBotRouter);
app.use('/api/v26', v26Router);
app.use('/api/research', researchRouter);
app.use((err, req, res, next) => { console.error('[error]', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MomentumFlow backend listening on port ${PORT}`));
