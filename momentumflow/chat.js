import express from 'express';
import { store } from '../store.js';
import { evaluateLiveGate } from '../safetyEngine.js';
import { hasCredentials } from '../alpacaClient.js';

const router = express.Router();

/**
 * Very deliberately NOT a free-form LLM agent with tool access to live trading.
 * This is a small fixed command grammar so "go live" can never be reinterpreted
 * or jailbroken into placing an order the user didn't explicitly confirm through
 * the real endpoints. It tells the frontend which action + confirmation to show;
 * it never calls the trading endpoints itself.
 */
router.post('/command', (req, res) => {
  const text = String(req.body?.text || '').trim().toLowerCase();

  if (/^(run( the)? bot|start( paper)? session|paper session)/.test(text)) {
    return res.json({
      reply: "Starting a paper session — no real capital at risk. I'll show results as trades complete.",
      action: { type: 'RUN_PAPER_SESSION' },
    });
  }

  if (/^(go live|enable live|start live)/.test(text)) {
    const consents = store.getConfig('liveGateConsents', {});
    const gate = evaluateLiveGate({ consents, hasLiveCredentials: hasCredentials('live') });
    if (!gate.allowed) {
      return res.json({
        reply: `Live trading isn't available yet: ${gate.reason}. Complete the Live Gate checklist in Settings first.`,
        action: { type: 'NONE' },
      });
    }
    return res.json({
      reply: 'Live Gate is fully unlocked. Live trades still require you to confirm each order individually — go to Dashboard to place one.',
      action: { type: 'SHOW_LIVE_GATE_UNLOCKED' },
    });
  }

  if (/^(stop|halt|pause)/.test(text)) {
    return res.json({
      reply: 'Which session should I halt? Use the Sessions page to select one, or say "stop session <id>".',
      action: { type: 'REQUEST_SESSION_SELECTION' },
    });
  }

  const stopMatch = text.match(/^stop session (.+)$/);
  if (stopMatch) {
    const sessionId = stopMatch[1].trim();
    const session = store.getOne('sessions', sessionId);
    if (!session) {
      return res.json({ reply: `No session found with id ${sessionId}.`, action: { type: 'NONE' } });
    }
    return res.json({ reply: `Halting session ${sessionId}.`, action: { type: 'HALT_SESSION', sessionId } });
  }

  return res.json({
    reply: "I understand: \"run the bot\" (paper), \"go live\", \"stop\". Try one of those.",
    action: { type: 'NONE' },
  });
});

export default router;
