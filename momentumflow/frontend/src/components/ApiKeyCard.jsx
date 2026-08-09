import React, { useState } from 'react';
import { api } from '../lib/api.js';

export default function ApiKeyCard({ mode, configured, keyIdMasked, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await api.saveCredentials(mode, keyId, secretKey);
      setKeyId('');
      setSecretKey('');
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await api.deleteCredentials(mode);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{mode} keys</span>
        <span className="mono" style={{ fontSize: 11, color: configured ? 'var(--signal-up)' : 'var(--text-dim)' }}>
          {configured ? keyIdMasked : 'not set'}
        </span>
      </div>

      {editing ? (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            placeholder="Alpaca Key ID"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            style={input}
            autoComplete="off"
          />
          <input
            placeholder="Alpaca Secret Key"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            style={input}
            autoComplete="off"
          />
          {error && <div style={{ color: 'var(--signal-down)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={busy || !keyId || !secretKey} style={btnPrimary}>
              {busy ? 'Saving…' : 'Save (encrypted)'}
            </button>
            <button onClick={() => setEditing(false)} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => setEditing(true)} style={btnGhost}>
            {configured ? 'Replace keys' : 'Add keys'}
          </button>
          {configured && (
            <button onClick={handleRemove} disabled={busy} style={btnDanger}>Remove</button>
          )}
        </div>
      )}
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px',
};

const input = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  color: 'var(--text-primary)',
  fontSize: 14,
  fontFamily: 'var(--font-mono)',
};

const btnBase = {
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnPrimary = { ...btnBase, background: 'var(--accent)', color: '#fff' };
const btnGhost = { ...btnBase, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text-primary)' };
const btnDanger = { ...btnBase, background: 'transparent', border: '1px solid var(--signal-down)', color: 'var(--signal-down)' };
