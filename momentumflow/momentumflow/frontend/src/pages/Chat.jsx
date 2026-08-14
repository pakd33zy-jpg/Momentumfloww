import React, { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api.js';

const SUGGESTIONS = ['run the bot', 'go live', 'stop'];

export default function Chat() {
  const [messages, setMessages] = useState([
    { from: 'bot', text: 'Try "run the bot" to start a paper session, "go live" to check Live Gate status, or "stop" to halt a session.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setMessages((prev) => [...prev, { from: 'user', text: trimmed }]);
    setInput('');
    setBusy(true);
    try {
      const res = await api.sendCommand(trimmed);
      setMessages((prev) => [...prev, { from: 'bot', text: res.reply }]);
      if (res.action?.type === 'RUN_PAPER_SESSION') {
        const runResult = await api.runPaperSession(100);
        setMessages((prev) => [...prev, {
          from: 'bot',
          text: `Session complete: ${runResult.session.trades} trades, ${runResult.session.win_rate}% win rate, P&L $${runResult.session.total_pnl}.`,
        }]);
      }
      if (res.action?.type === 'HALT_SESSION') {
        await api.haltSession(res.action.sessionId, 'Halted via chat');
        setMessages((prev) => [...prev, { from: 'bot', text: `Session ${res.action.sessionId} halted.` }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { from: 'bot', text: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={m.from === 'user' ? bubbleUser : bubbleBot}>{m.text}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} style={chip}>{s}</button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command…"
          style={inputStyle}
        />
        <button type="submit" disabled={busy} style={sendBtn}>Send</button>
      </form>
    </div>
  );
}

const bubbleBot = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: '12px 12px 12px 4px',
  padding: '10px 12px',
  fontSize: 13.5,
  lineHeight: 1.4,
};

const bubbleUser = {
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: '12px 12px 4px 12px',
  padding: '10px 12px',
  fontSize: 13.5,
  lineHeight: 1.4,
};

const chip = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const inputStyle = {
  flex: 1,
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
  color: 'var(--text-primary)',
  fontSize: 14,
};

const sendBtn = {
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius)',
  padding: '0 18px',
  fontWeight: 600,
  cursor: 'pointer',
};
