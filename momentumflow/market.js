import express from 'express';
import { store } from './store.js';
import {
  getStockSnapshots,
  getCryptoSnapshots,
  getStockBars,
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

export default router;
