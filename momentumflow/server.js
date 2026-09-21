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
import cryptoV51ShadowRouter from './cryptoV51ShadowRouter.js';
import equityV71ShadowRouter, { startEquityV71Shadow } from './equityV71ShadowRouter.js';
import { startFastScalpMonitor } from './fastScalpMonitor.js';
import { startEquityFastScalpMonitor } from './equityFastScalpMonitor.js';
import { startCryptoV51ShadowMonitor } from './cryptoV51ShadowMonitor.js';
import { store } from './store.js';
import { initPersistentCredentials } from './persistentCredentialStore.js';

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
  });

  const strategy = store.getConfig('strategyConfig', {});
  store.setConfig('strategyConfig', {
    ...strategy,
    cryptoV35Enabled: false,
    cryptoV51Enabled: true,
    equityV35Enabled: strategy.equityV35Enabled !== false,
    cryptoV51MaxConcurrentPositions: 8,
  });

  const trading = store.getConfig('tradingConfig', {});
  if (trading.equityFocusMode === true) {
    store.setConfig('tradingConfig', {
      ...trading,
      equityFocusMode: false,
    });
  }

  console.log('[boot] V51 crypto PAPER runtime active; equity remains V35 while V51 equity is developed; crypto max concurrent positions=8.');
}

const credentialPersistence = await initPersistentCredentials();

resetToPaperModeOnBoot();
migrateActiveRuntimeConfigOnBoot();
startFastScalpMonitor();
startEquityFastScalpMonitor();
startCryptoV51ShadowMonitor();
startEquityV71Shadow();

if (credentialPersistence.ready && credentialPersistence.loaded) {
  setTimeout(() => {
    startLiveBotV35()
      .then(() => console.log('[boot] V51 paper execution bot auto-started.'))
      .catch((error) => console.warn(`[boot] V51 paper execution auto-start skipped: ${error.message}`));
  }, 2500).unref?.();
} else {
  console.warn('[boot] V51 execution not auto-started: waiting for persisted PAPER credentials.');
}


app.get('/setup-paper', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MomentumFlow Paper Key Setup</title>
<style>
body{font-family:system-ui;background:#0b0f14;color:#f8fafc;margin:0;padding:24px}
main{max-width:520px;margin:auto}input,button{box-sizing:border-box;width:100%;padding:14px;margin:7px 0;border-radius:9px;border:1px solid #475569}
input{background:#0f172a;color:white}button{background:#2563eb;color:white;font-weight:700;border:0}
#status{white-space:pre-wrap;margin-top:14px;font-size:14px}.ok{color:#4ade80}.bad{color:#f87171}
</style></head><body><main>
<h2>MomentumFlow — PAPER Alpaca Keys</h2>
<p>This page talks directly to the Render backend and bypasses the cached app.</p>
<form id="f"><input id="k" autocomplete="off" placeholder="API Key ID" required>
<input id="s" type="password" autocomplete="off" placeholder="Secret Key" required>
<button type="submit">Save & Verify PAPER Keys</button></form><div id="status"></div>
<script>
const f=document.getElementById('f'), status=document.getElementById('status');
f.addEventListener('submit',async(e)=>{e.preventDefault();status.className='';status.textContent='Saving…';
try{
 const r=await fetch('/api/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'paper',keyId:document.getElementById('k').value.trim(),secretKey:document.getElementById('s').value.trim()})});
 const d=await r.json(); if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
 if(!d.configured) throw new Error('Server did not confirm save.');
 status.className=d.connected?'ok':'bad';
 status.textContent=d.connected?'SAVED AND CONNECTED ✓\nEquity: , (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
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
app.use('/api/crypto-v51-shadow', cryptoV51ShadowRouter);
app.use('/api/equity-v71-shadow', equityV71ShadowRouter);
app.use((err, req, res, next) => { console.error('[error]', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MomentumFlow backend listening on port ${PORT}`));+(d.account?.equity??'—'):'Saved, but Alpaca verification failed: '+(d.verificationError||'unknown');
 if(d.configured){document.getElementById('k').value='';document.getElementById('s').value='';}
}catch(err){status.className='bad';status.textContent='SAVE FAILED: '+err.message;}
});
</script></main></body></html>`);
});

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
app.use('/api/crypto-v51-shadow', cryptoV51ShadowRouter);
app.use('/api/equity-v71-shadow', equityV71ShadowRouter);
app.use((err, req, res, next) => { console.error('[error]', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MomentumFlow backend listening on port ${PORT}`));