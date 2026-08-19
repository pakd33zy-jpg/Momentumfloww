import express from 'express';
import { store } from './store.js';
import {
  getStockSnapshots,
  getCryptoSnapshots,
  getStockBars,
  getCryptoBars,
  placeOrder,
} from './alpacaClient.js';
import { MARKETS } from './models.js';

const router = express.Router();

function selectedMode() {
  const configured =
    store.getConfig(
      'tradingMode',
      { mode: 'paper' }
    ).mode;

  return configured === 'live'
    ? 'live'
    : 'paper';
}

function snapshotPrice(snapshot) {
  const price = Number(
    snapshot?.latestTrade?.p ??
    snapshot?.minuteBar?.c ??
    snapshot?.dailyBar?.c ??
    snapshot?.prevDailyBar?.c
  );

  return (
    Number.isFinite(price) &&
    price > 0
  )
    ? price
    : null;
}

router.get(
  '/grid',
  async (req, res) => {
    try {
      const mode =
        selectedMode();

      const cryptoMarkets =
        [...MARKETS.crypto];

      const equityMarkets =
        [...MARKETS.equity];

      const cryptoSymbols =
        cryptoMarkets.map(
          (market) =>
            `${market}/USD`
        );

      const [
        cryptoSnapshots,
        stockSnapshots,
      ] =
        await Promise.all([
          cryptoSymbols.length
            ? getCryptoSnapshots(
                mode,
                cryptoSymbols
              )
            : Promise.resolve({}),

          equityMarkets.length
            ? getStockSnapshots(
                mode,
                equityMarkets,
                {
                  feed: 'iex',
                }
              )
            : Promise.resolve({}),
        ]);

      const cryptoGrid =
        cryptoMarkets.map(
          (market) => {
            const symbol =
              `${market}/USD`;

            const snapshot =
              cryptoSnapshots[
                symbol
              ] ||
              cryptoSnapshots[
                symbol.replace(
                  '/',
                  ''
                )
              ] ||
              null;

            return {
              market,

              symbol,

              price:
                snapshotPrice(
                  snapshot
                ),

              change:
                null,

              source:
                `alpaca_${mode}`,

              assetClass:
                'crypto',
            };
          }
        );

      const equityGrid =
        equityMarkets.map(
          (market) => {
            const snapshot =
              stockSnapshots[
                market
              ] ||
              null;

            return {
              market,

              symbol:
                market,

              price:
                snapshotPrice(
                  snapshot
                ),

              change:
                null,

              source:
                `alpaca_${mode}_iex`,

              assetClass:
                'us_equity',
            };
          }
        );

      res.json([
        ...cryptoGrid,
        ...equityGrid,
      ]);
    } catch (err) {
      res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);

function marketSessionDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const pick = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

router.get(
  '/volatility',
  async (req, res) => {
    try {
      const mode = selectedMode();

      const end = new Date();

      const start = new Date(
        end.getTime() -
        5 * 24 * 60 * 60 * 1000
      );

      const result =
        await getStockBars(
          mode,
          ['SPY'],
          {
            timeframe: '5Min',
            start,
            end,
            limit: 2000,
            feed: 'iex',
            sort: 'asc',
            maxPages: 3,
          }
        );

      const rows =
        (
          result?.SPY ||
          []
        )
          .filter(
            (bar) =>
              Number.isFinite(
                Number(bar?.c)
              ) &&
              bar?.t
          )
          .sort(
            (a, b) =>
              new Date(a.t) -
              new Date(b.t)
          );

      if (!rows.length) {
        return res
          .status(503)
          .json({
            error:
              'No SPY bars returned by Alpaca.',
          });
      }

      const session =
        marketSessionDate(
          rows[
            rows.length - 1
          ].t
        );

      const sessionRows =
        rows
          .filter(
            (bar) =>
              marketSessionDate(
                bar.t
              ) ===
              session
          )
          .slice(-78);

      const bars =
        sessionRows.length
          ? sessionRows
          : rows.slice(-78);

      const first =
        bars[0];

      const lastBar =
        bars[
          bars.length - 1
        ];

      const open =
        Number(
          first.o ??
          first.c
        );

      const last =
        Number(
          lastBar.c
        );

      const high =
        Math.max(
          ...bars.map(
            (bar) =>
              Number(
                bar.h ??
                bar.c
              )
          )
        );

      const low =
        Math.min(
          ...bars.map(
            (bar) =>
              Number(
                bar.l ??
                bar.c
              )
          )
        );

      let sumSquares = 0;

      for (
        let i = 1;
        i < bars.length;
        i += 1
      ) {
        const previous =
          Number(
            bars[
              i - 1
            ].c
          );

        const current =
          Number(
            bars[i].c
          );

        if (
          previous > 0 &&
          current > 0
        ) {
          const r =
            Math.log(
              current /
              previous
            );

          sumSquares +=
            r * r;
        }
      }

      const changePct =
        open > 0
          ? (
              (
                last -
                open
              ) /
              open
            ) *
            100
          : 0;

      const rangePct =
        open > 0
          ? (
              (
                high -
                low
              ) /
              open
            ) *
            100
          : 0;

      const realizedPct =
        Math.sqrt(
          sumSquares
        ) *
        100;

      res.json({
        symbol: 'SPY',

        timeframe:
          '5Min',

        source:
          `alpaca_${mode}_iex`,

        mode,

        session,

        updatedAt:
          new Date()
            .toISOString(),

        stats: {
          open,
          last,
          high,
          low,
          changePct,
          rangePct,
          realizedPct,
        },

        points:
          bars.map(
            (bar) => ({
              t: bar.t,

              o:
                Number(
                  bar.o ??
                  bar.c
                ),

              h:
                Number(
                  bar.h ??
                  bar.c
                ),

              l:
                Number(
                  bar.l ??
                  bar.c
                ),

              c:
                Number(
                  bar.c
                ),

              v:
                Number(
                  bar.v ??
                  0
                ),
            })
          ),
      });
    } catch (err) {
      res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  }
);


router.get(
  '/symbol/:symbol',
  async (req, res) => {
    try {
      const mode = selectedMode();
      const requested = decodeURIComponent(String(req.params.symbol || '')).trim().toUpperCase();
      const crypto = requested.includes('/');
      const symbol = crypto ? requested : requested.replace(/[^A-Z0-9.-]/g, '');

      if (!symbol) {
        return res.status(400).json({ error: 'Symbol required.' });
      }

      let snapshot = null;
      let rows = [];

      if (crypto) {
        const snaps = await getCryptoSnapshots(mode, [symbol]);
        snapshot = snaps[symbol] || snaps[symbol.replace('/', '')] || null;

        const end = new Date();
        const start = new Date(
          end.getTime() - 2 * 24 * 60 * 60 * 1000
        );

        const bars = await getCryptoBars(
          mode,
          [symbol],
          {
            timeframe: '5Min',
            start,
            end,
            limit: 1000,
            sort: 'asc',
            maxPages: 3,
          }
        );

        rows = (
          bars?.[symbol] ||
          bars?.[symbol.replace('/', '')] ||
          []
        ).slice(-180);
      } else {
        const snaps = await getStockSnapshots(mode, [symbol], { feed: 'iex' });
        snapshot = snaps[symbol] || null;

        const end = new Date();
        const start = new Date(end.getTime() - 5 * 24 * 60 * 60 * 1000);
        const bars = await getStockBars(mode, [symbol], {
          timeframe: '5Min',
          start,
          end,
          limit: 1000,
          feed: 'iex',
          sort: 'asc',
          maxPages: 3,
        });
        rows = (bars?.[symbol] || []).slice(-180);
      }

      const price = snapshotPrice(snapshot);
      const closes = rows.map(x => Number(x.c)).filter(Number.isFinite);
      const open = rows.length ? Number(rows[0].o ?? rows[0].c) : null;
      const high = rows.length ? Math.max(...rows.map(x => Number(x.h ?? x.c)).filter(Number.isFinite)) : null;
      const low = rows.length ? Math.min(...rows.map(x => Number(x.l ?? x.c)).filter(Number.isFinite)) : null;
      const last = closes.length ? closes[closes.length - 1] : price;
      const volume = rows.reduce((sum, x) => sum + Number(x.v || 0), 0);
      const changePct = open > 0 && last > 0 ? ((last - open) / open) * 100 : null;

      res.json({
        symbol,
        assetClass: crypto ? 'crypto' : 'us_equity',
        source: crypto ? `alpaca_${mode}` : `alpaca_${mode}_iex`,
        price,
        stats: { open, high, low, last, volume, changePct },
        points: rows.map(x => ({
          t: x.t, o: Number(x.o ?? x.c), h: Number(x.h ?? x.c),
          l: Number(x.l ?? x.c), c: Number(x.c), v: Number(x.v || 0),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/manual-order',
  async (req, res) => {
    try {
      const mode = req.body?.mode === 'live' ? 'live' : 'paper';
      const symbol = String(req.body?.symbol || '').trim().toUpperCase();
      const side = req.body?.side === 'sell' ? 'sell' : 'buy';
      const qty = Number(req.body?.qty);
      const crypto = symbol.includes('/');

      if (!symbol || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Valid symbol and quantity are required.' });
      }
      if (mode === 'live' && req.body?.liveConfirmation !== 'LIVE') {
        return res.status(400).json({ error: 'LIVE confirmation required for real-money order.' });
      }

      const order = await placeOrder({
        mode,
        symbol,
        qty: String(qty),
        side,
        type: 'market',
        timeInForce: crypto ? 'gtc' : 'day',
      });

      res.json(order);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
