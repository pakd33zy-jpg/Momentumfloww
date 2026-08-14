import express from 'express';
import { store } from './store.js';
import {
  getStockSnapshots,
  getCryptoSnapshots,
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

export default router;
