import React, { useState } from 'react';
import { api } from '../lib/api.js';

// API KEY CARD v15
// Inputs are always rendered and editable unless a save/remove request is active.
// Existing secret keys are never loaded back into the browser.

export default function ApiKeyCard({
  mode,
  configured = false,
  keyIdMasked = '',
  onSaved,
}) {
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const label = mode === 'live' ? 'LIVE' : 'PAPER';

  async function handleSave(event) {
    event.preventDefault();

    const cleanKeyId = keyId.trim();
    const cleanSecret = secretKey.trim();

    if (!cleanKeyId || !cleanSecret) {
      setError('Enter both the Alpaca API Key ID and Secret Key.');
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Saving and checking with Alpaca…');

    try {
      const result = await api.saveCredentials(mode, cleanKeyId, cleanSecret);

      // The backend stores the pair before verification. Keep the fields only
      // when Alpaca rejects it so the user can correct a typo without retyping
      // everything; clear them after a verified connection.
      if (result?.verified === true || result?.connected === true) {
        setKeyId('');
        setSecretKey('');
        setStatus('Saved and connected ✓');
      } else if (result?.configured === true) {
        setStatus('Saved');
        setError(
          result?.verificationError
            ? `Saved, but Alpaca did not accept the pair: ${result.verificationError}`
            : 'Saved, but Alpaca connection could not be verified yet.'
        );
      } else {
        setStatus('');
        setError('The server did not confirm that the credentials were saved.');
      }

      await onSaved?.();
    } catch (err) {
      setStatus('');
      setError(err?.message || 'Could not save credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    const confirmed = window.confirm(
      `Remove the saved ${label} Alpaca credentials?`
    );

    if (!confirmed) return;

    setBusy(true);
    setError('');
    setStatus('Removing…');

    try {
      await api.deleteCredentials(mode);
      setKeyId('');
      setSecretKey('');
      setStatus('Removed');
      await onSaved?.();
    } catch (err) {
      setStatus('');
      setError(err?.message || 'Could not remove credentials.');
    } finally {
      setBusy(false);
    }
  }

  function clearMessages() {
    setError('');
    setStatus('');
  }

  const statusIsGood = status === 'Saved and connected ✓';

  return (
    <div style={card}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>Alpaca {label} Keys</div>
          <div
            style={{
              ...subtle,
              color: configured ? '#4ade80' : 'var(--text-dim)',
            }}
          >
            {configured
              ? `Currently saved: ${keyIdMasked || 'configured'}`
              : 'No credentials saved'}
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: configured ? '#4ade80' : '#fbbf24',
          }}
        >
          {configured ? 'CONFIGURED' : 'NOT SET'}
        </div>
      </div>

      <form onSubmit={handleSave} style={formStyle}>
        <label style={fieldWrap}>
          <span style={labelStyle}>Alpaca API Key ID</span>
          <input
            id={`${mode}-alpaca-key-id`}
            name={`${mode}-alpaca-key-id`}
            type="text"
            value={keyId}
            onChange={(event) => {
              setKeyId(event.target.value);
              clearMessages();
            }}
            placeholder={
              configured
                ? 'Enter a new API Key ID to replace the saved key'
                : 'Enter Alpaca API Key ID'
            }
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            style={inputStyle}
          />
        </label>

        <label style={fieldWrap}>
          <span style={labelStyle}>Alpaca Secret Key</span>
          <div style={secretRow}>
            <input
              id={`${mode}-alpaca-secret-key`}
              name={`${mode}-alpaca-secret-key`}
              type={showSecret ? 'text' : 'password'}
              value={secretKey}
              onChange={(event) => {
                setSecretKey(event.target.value);
                clearMessages();
              }}
              placeholder={
                configured
                  ? 'Enter a new Secret Key to replace the saved key'
                  : 'Enter Alpaca Secret Key'
              }
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              style={{ ...inputStyle, flex: 1 }}
            />

            <button
              type="button"
              onClick={() => setShowSecret((value) => !value)}
              disabled={busy}
              style={showButton}
            >
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <div style={subtle}>
          Paste the Key ID and Secret Key directly from Alpaca. Spaces at the
          beginning or end are removed when saved. Existing secret keys are not
          returned to the browser.
        </div>

        {error && <div style={errorStyle}>{error}</div>}
        {status && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: statusIsGood ? '#4ade80' : '#fbbf24',
            }}
          >
            {status}
          </div>
        )}

        <div style={buttonRow}>
          <button
            type="submit"
            disabled={busy || !keyId.trim() || !secretKey.trim()}
            style={{
              ...primaryButton,
              opacity: busy || !keyId.trim() || !secretKey.trim() ? 0.55 : 1,
            }}
          >
            {busy
              ? 'Saving…'
              : configured
                ? `Replace ${label} Keys`
                : `Save ${label} Keys`}
          </button>

          {configured && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              style={dangerButton}
            >
              Remove Saved Keys
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

const card = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
};

const headerRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const titleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const formStyle = {
  marginTop: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const fieldWrap = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const labelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 600,
};

const inputStyle = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  background: '#0f172a',
  border: '1px solid #475569',
  borderRadius: 8,
  color: '#f8fafc',
  padding: '11px 12px',
  fontSize: 13,
  outline: 'none',
  pointerEvents: 'auto',
  userSelect: 'text',
};

const secretRow = {
  display: 'flex',
  gap: 8,
  alignItems: 'stretch',
};

const subtle = {
  marginTop: 3,
  color: '#7c8799',
  fontSize: 11,
  lineHeight: 1.4,
};

const buttonRow = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const primaryButton = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 13px',
  fontWeight: 700,
  cursor: 'pointer',
};

const showButton = {
  background: '#1e293b',
  color: '#cbd5e1',
  border: '1px solid #475569',
  borderRadius: 8,
  padding: '0 12px',
  cursor: 'pointer',
};

const dangerButton = {
  background: 'transparent',
  color: '#f87171',
  border: '1px solid rgba(248,113,113,0.45)',
  borderRadius: 8,
  padding: '10px 13px',
  fontWeight: 700,
  cursor: 'pointer',
};

const errorStyle = {
  color: '#f87171',
  fontSize: 12,
  lineHeight: 1.4,
};
