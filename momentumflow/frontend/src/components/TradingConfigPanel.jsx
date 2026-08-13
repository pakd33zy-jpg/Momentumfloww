import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  api,
} from '../lib/api.js';

function fromServer(
  cfg = {}
) {
  return {
    riskPerTradePct:
      String(
        Number(
          cfg.riskPerTrade ??
          0.02
        ) * 100
      ),

    maxTradesPerSession:
      String(
        cfg.maxTradesPerSession ??
        cfg.tradesPerSession ??
        24
      ),

    maxTradesPerMarket:
      String(
        cfg.maxTradesPerMarket ??
        cfg.tradesPerMarket ??
        12
      ),

    dailyLossLimitPct:
      String(
        Number(
          cfg.dailyLossLimit ??
          0.10
        ) * 100
      ),

    consecutiveStopLoss:
      String(
        cfg.consecutiveStopLoss ??
        3
      ),
  };
}

function toServer(
  raw
) {
  return {
    riskPerTrade:
      Number(
        raw.riskPerTradePct
      ) / 100,

    maxTradesPerSession:
      Math.trunc(
        Number(
          raw.maxTradesPerSession
        )
      ),

    maxTradesPerMarket:
      Math.trunc(
        Number(
          raw.maxTradesPerMarket
        )
      ),

    dailyLossLimit:
      Number(
        raw.dailyLossLimitPct
      ) / 100,

    consecutiveStopLoss:
      Math.trunc(
        Number(
          raw.consecutiveStopLoss
        )
      ),
  };
}

const FIELD_NAMES = [
  'riskPerTradePct',
  'maxTradesPerSession',
  'maxTradesPerMarket',
  'dailyLossLimitPct',
  'consecutiveStopLoss',
];

function readForm(
  form
) {
  if (!form) {
    return null;
  }

  const output = {};

  for (
    const name of
    FIELD_NAMES
  ) {
    output[name] =
      form.elements[name]
        ?.value ??
      '';
  }

  return output;
}

function writeForm(
  form,
  values
) {
  if (
    !form ||
    !values
  ) {
    return;
  }

  for (
    const [
      name,
      value,
    ] of
    Object.entries(
      values
    )
  ) {
    if (
      form.elements[name]
    ) {
      form.elements[
        name
      ].value =
        value ?? '';
    }
  }
}

export default function TradingConfigPanel({
  compact = false,
  onSaved,
}) {
  const formRef =
    useRef(null);

  const [
    initial,
    setInitial,
  ] = useState(null);

  const [
    status,
    setStatus,
  ] = useState(
    'Loading…'
  );

  const [
    error,
    setError,
  ] = useState('');

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const remote =
          await api.getTradingConfig();

        if (!alive) {
          return;
        }

        const values =
          fromServer(
            remote
          );

        setInitial(
          values
        );

        api.writeTradingConfigDraft(
          values
        );

        setStatus('');
      } catch (err) {
        if (!alive) {
          return;
        }

        const fallback =
          fromServer({});

        setInitial(
          fallback
        );

        setStatus(
          'Using defaults'
        );

        setError(
          `Could not load configuration: ${err.message}`
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function preserveNow() {
    const values =
      readForm(
        formRef.current
      );

    if (!values) {
      return;
    }

    api.writeTradingConfigDraft(
      values
    );

    setStatus(
      'Unsaved changes'
    );

    setError('');
  }

  async function save() {
    const raw =
      readForm(
        formRef.current
      );

    if (!raw) {
      return;
    }

    api.writeTradingConfigDraft(
      raw
    );

    setStatus(
      'Saving…'
    );

    setError('');

    try {
      const saved =
        await api.setTradingConfig(
          toServer(
            raw
          )
        );

      const canonical =
        fromServer(
          saved
        );

      api.writeTradingConfigDraft(
        canonical
      );

      setStatus(
        'Saved ✓'
      );

      onSaved?.(
        saved
      );
    } catch (err) {
      setStatus(
        'Not saved'
      );

      setError(
        `Save failed: ${err.message}`
      );
    }
  }

  async function reloadSaved() {
    try {
      const remote =
        await api.getTradingConfig();

      const values =
        fromServer(
          remote
        );

      writeForm(
        formRef.current,
        values
      );

      api.writeTradingConfigDraft(
        values
      );

      setStatus(
        'Reloaded'
      );

      setError('');
    } catch (err) {
      setError(
        `Reload failed: ${err.message}`
      );
    }
  }

  if (!initial) {
    return (
      <div
        style={{
          color:
            '#9ca3af',

          fontSize:
            13,
        }}
      >
        {error ||
          status}
      </div>
    );
  }

  return (
    <div
      style={
        compact
          ? compactCard
          : card
      }
    >
      <form
        ref={
          formRef
        }

        onSubmit={(
          event
        ) => {
          event.preventDefault();

          save();
        }}

        onInput={
          preserveNow
        }

        onChange={
          preserveNow
        }
      >
        <div
          style={{
            display:
              'grid',

            gridTemplateColumns:
              compact
                ? 'repeat(2, minmax(0, 1fr))'
                : '1fr',

            gap:
              compact
                ? 14
                : 10,
          }}
        >
          <Field
            name="riskPerTradePct"

            label="Risk Per Trade (%)"

            defaultValue={
              initial.riskPerTradePct
            }

            min="0.1"

            max="100"

            step="0.1"

            note={
              !compact
                ? 'Used the same way in Alpaca Paper and Alpaca Live.'
                : null
            }
          />

          <Field
            name="maxTradesPerSession"

            label="Max Trades Per Session"

            defaultValue={
              initial.maxTradesPerSession
            }

            min="1"

            max="1000"

            step="1"
          />

          <Field
            name="maxTradesPerMarket"

            label="Max Trades Per Market / Symbol"

            defaultValue={
              initial.maxTradesPerMarket
            }

            min="1"

            max="1000"

            step="1"
          />

          <Field
            name="dailyLossLimitPct"

            label="Daily Loss Halt (%)"

            defaultValue={
              initial.dailyLossLimitPct
            }

            min="0.1"

            max="100"

            step="0.1"
          />

          <Field
            name="consecutiveStopLoss"

            label="Consecutive Losses Before Halt"

            defaultValue={
              initial.consecutiveStopLoss
            }

            min="1"

            max="100"

            step="1"
          />
        </div>

        {error && (
          <div
            style={{
              marginTop:
                12,

              color:
                '#fca5a5',

              fontSize:
                12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display:
              'flex',

            gap:
              10,

            alignItems:
              'center',

            flexWrap:
              'wrap',

            marginTop:
              16,
          }}
        >
          <button
            type="submit"

            style={
              primaryButton
            }
          >
            Save Configuration
          </button>

          <button
            type="button"

            onClick={
              reloadSaved
            }

            style={
              secondaryButton
            }
          >
            Reload Saved Values
          </button>

          {status && (
            <span
              style={{
                fontSize:
                  12,

                color:
                  status ===
                  'Saved ✓'
                    ? '#4ade80'
                    : '#fbbf24',
              }}
            >
              {status}
            </span>
          )}
        </div>

        <div
          style={{
            marginTop:
              10,

            color:
              '#64748b',

            fontSize:
              10,
          }}
        >
          SETTINGS ENGINE v12 — REAL MARKET PAPER TRADING
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  note,
  ...props
}) {
  return (
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
        {label}
      </span>

      <input
        name={
          name
        }

        type="number"

        defaultValue={
          defaultValue
        }

        {...props}

        style={
          inputStyle
        }
      />

      {note && (
        <span
          style={
            noteStyle
          }
        >
          {note}
        </span>
      )}
    </label>
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

const compactCard = {
  background:
    'transparent',
};

const fieldWrap = {
  display:
    'flex',

  flexDirection:
    'column',

  gap:
    6,

  minWidth:
    0,
};

const labelStyle = {
  color:
    '#9ca3af',

  fontSize:
    12,
};

const noteStyle = {
  color:
    '#7c8799',

  fontSize:
    11,

  lineHeight:
    1.35,
};

const inputStyle = {
  width:
    '100%',

  boxSizing:
    'border-box',

  padding:
    '9px 10px',

  background:
    '#0f1419',

  border:
    '1px solid #2a2e4a',

  borderRadius:
    6,

  color:
    '#fff',

  fontSize:
    14,
};

const primaryButton = {
  padding:
    '10px 16px',

  background:
    '#3b82f6',

  color:
    '#fff',

  border:
    0,

  borderRadius:
    6,

  cursor:
    'pointer',

  fontWeight:
    700,
};

const secondaryButton = {
  padding:
    '10px 16px',

  background:
    'transparent',

  color:
    '#cbd5e1',

  border:
    '1px solid #334155',

  borderRadius:
    6,

  cursor:
    'pointer',
};
