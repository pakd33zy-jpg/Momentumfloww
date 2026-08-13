import React, {
  useState,
} from 'react';

import {
  api,
} from '../lib/api.js';

// API KEY CARD v13
//
// API Key ID + Secret Key are always visible.
// Existing secrets are NEVER loaded back into the browser.
// Saving replaces the credentials for the selected mode.

export default function ApiKeyCard({
  mode,
  configured,
  keyIdMasked,
  onSaved,
}) {
  const [
    keyId,
    setKeyId,
  ] = useState('');

  const [
    secretKey,
    setSecretKey,
  ] = useState('');

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  const [
    status,
    setStatus,
  ] = useState('');

  async function handleSave(
    event
  ) {
    event?.preventDefault();

    const cleanKeyId =
      keyId.trim();

    const cleanSecret =
      secretKey.trim();

    if (
      !cleanKeyId ||
      !cleanSecret
    ) {
      setError(
        'Enter both the Alpaca API Key ID and Secret Key.'
      );

      return;
    }

    setBusy(true);
    setError('');
    setStatus(
      'Saving…'
    );

    try {
      await api.saveCredentials(
        mode,
        cleanKeyId,
        cleanSecret
      );

      setKeyId('');
      setSecretKey('');

      setStatus(
        'Saved ✓'
      );

      await onSaved?.();
    } catch (err) {
      setStatus('');

      setError(
        err.message ||
        'Could not save credentials.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    const confirmed =
      window.confirm(
        `Remove the saved ${mode.toUpperCase()} Alpaca credentials?`
      );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError('');
    setStatus(
      'Removing…'
    );

    try {
      await api.deleteCredentials(
        mode
      );

      setKeyId('');
      setSecretKey('');

      setStatus(
        'Removed'
      );

      await onSaved?.();
    } catch (err) {
      setStatus('');

      setError(
        err.message ||
        'Could not remove credentials.'
      );
    } finally {
      setBusy(false);
    }
  }

  const label =
    mode === 'live'
      ? 'LIVE'
      : 'PAPER';

  return (
    <div
      style={
        card
      }
    >
      <div
        style={{
          display:
            'flex',

          justifyContent:
            'space-between',

          alignItems:
            'center',

          gap:
            10,

          flexWrap:
            'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize:
                14,

              fontWeight:
                700,

              color:
                'var(--text-primary)',
            }}
          >
            Alpaca {label} Keys
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                11,

              color:
                configured
                  ? '#4ade80'
                  : 'var(--text-dim)',
            }}
          >
            {configured
              ? `Currently saved: ${keyIdMasked || 'configured'}`
              : 'No credentials saved'}
          </div>
        </div>

        <div
          style={{
            fontSize:
              11,

            fontWeight:
              700,

            color:
              configured
                ? '#4ade80'
                : '#fbbf24',
          }}
        >
          {configured
            ? 'CONFIGURED'
            : 'NOT SET'}
        </div>
      </div>

      <form
        onSubmit={
          handleSave
        }

        style={{
          marginTop:
            14,

          display:
            'flex',

          flexDirection:
            'column',

          gap:
            10,
        }}
      >
        <label
          style={
            fieldWrap
          }
        >
          <span
            style={
              labelStyle
            }
          >
            Alpaca API Key ID
          </span>

          <input
            value={
              keyId
            }

            onChange={(
              event
            ) => {
              setKeyId(
                event
                  .target
                  .value
              );

              setError('');
              setStatus('');
            }}

            placeholder={
              configured
                ? 'Enter new API Key ID to replace saved key'
                : 'Enter Alpaca API Key ID'
            }

            autoComplete="off"

            spellCheck={
              false
            }

            disabled={
              busy
            }

            style={
              input
            }
          />
        </label>

        <label
          style={
            fieldWrap
          }
        >
          <span
            style={
              labelStyle
            }
          >
            Alpaca Secret Key
          </span>

          <input
            value={
              secretKey
            }

            onChange={(
              event
            ) => {
              setSecretKey(
                event
                  .target
                  .value
              );

              setError('');
              setStatus('');
            }}

            placeholder={
              configured
                ? 'Enter new Secret Key to replace saved key'
                : 'Enter Alpaca Secret Key'
            }

            type="password"

            autoComplete="new-password"

            spellCheck={
              false
            }

            disabled={
              busy
            }

            style={
              input
            }
          />
        </label>

        <div
          style={{
            color:
              '#7c8799',

            fontSize:
              11,

            lineHeight:
              1.4,
          }}
        >
          Saved keys are encrypted on the backend.
          Existing secret keys are never sent back to this page.
        </div>

        {error && (
          <div
            style={{
              color:
                '#f87171',

              fontSize:
                12,

              lineHeight:
                1.4,
            }}
          >
            {error}
          </div>
        )}

        {status && (
          <div
            style={{
              color:
                status ===
                'Saved ✓'
                  ? '#4ade80'
                  : '#fbbf24',

              fontSize:
                12,

              fontWeight:
                600,
            }}
          >
            {status}
          </div>
        )}

        <div
          style={{
            display:
              'flex',

            gap:
              8,

            flexWrap:
              'wrap',
          }}
        >
          <button
            type="submit"

            disabled={
              busy ||
              !keyId.trim() ||
              !secretKey.trim()
            }

            style={{
              ...btnPrimary,

              opacity:
                busy ||
                !keyId.trim() ||
                !secretKey.trim()
                  ? 0.55
                  : 1,
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

              onClick={
                handleRemove
              }

              disabled={
                busy
              }

              style={
                btnDanger
              }
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
  background:
    'var(--bg-raised)',

  border:
    '1px solid var(--line)',

  borderRadius:
    'var(--radius)',

  padding:
    '14px 16px',
};

const fieldWrap = {
  display:
    'flex',

  flexDirection:
    'column',

  gap:
    6,
};

const labelStyle = {
  color:
    'var(--text-secondary)',

  fontSize:
    12,

  fontWeight:
    600,
};

const input = {
  width:
    '100%',

  boxSizing:
    'border-box',

  background:
    'var(--bg-inset)',

  border:
    '1px solid var(--line)',

  borderRadius:
    'var(--radius-sm)',

  padding:
    '11px 12px',

  color:
    'var(--text-primary)',

  fontSize:
    14,

  fontFamily:
    'var(--font-mono)',

  outline:
    'none',
};

const btnBase = {
  borderRadius:
    'var(--radius-sm)',

  padding:
    '10px 14px',

  fontSize:
    13,

  fontWeight:
    700,

  cursor:
    'pointer',
};

const btnPrimary = {
  ...btnBase,

  border:
    'none',

  background:
    'var(--accent)',

  color:
    '#fff',
};

const btnDanger = {
  ...btnBase,

  background:
    'transparent',

  border:
    '1px solid var(--signal-down)',

  color:
    'var(--signal-down)',
};
