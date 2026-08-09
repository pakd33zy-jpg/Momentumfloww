import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import credentialsRouter from './src/routes/credentials.js';
import sessionsRouter from './src/routes/sessions.js';
import liveGateRouter from './src/routes/liveGate.js';
import marketRouter from './src/routes/market.js';
import chatRouter from './src/routes/chat.js';
import tradingModeRouter from './src/routes/tradingMode.js';
import { store } from './src/store.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// --- SAFETY RULE: every boot resets the live gate consents, forcing paper-first. ---
// A server restart (deploy, crash, reboot) never resumes in a state where live
// trading is one click away — the user must re-confirm the full checklist.
function resetToPaperModeOnBoot() {
  const REQUIRED = [
    'understands_real_capital',
    'reviewed_strategy_backtest',
    'alpaca_live_key_configured',
    'accepts_safety_halts',
    'confirms_risk_tolerance',
  ];
  store.setConfig('liveGateConsents', Object.fromEntries(REQUIRED.map((k) => [k, false])));
  // Trading mode is forced back to paper on every boot too — a restart can never
  // resume in live mode, even if it was left in live mode before the restart.
  store.setConfig('tradingMode', { mode: 'paper', updated_at: new Date().toISOString() });
  console.log('[boot] Live Gate consents reset and trading mode forced to paper. Server is paper-first by default.');

  const liveEnabled = String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true';
  console.log(`[boot] LIVE_TRADING_ENABLED=${liveEnabled}${liveEnabled ? '  ⚠️  Live orders are possible once the Live Gate is re-completed.' : ' — live trading endpoint will refuse all requests.'}`);
}
resetToPaperModeOnBoot();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/credentials', credentialsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/live-gate', liveGateRouter);
app.use('/api/market', marketRouter);
app.use('/api/chat', chatRouter);
app.use('/api/trading-mode', tradingModeRouter);

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MomentumFlow backend listening on port ${PORT}`);
});
