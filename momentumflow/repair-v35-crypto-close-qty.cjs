const fs = require('fs');

const path = 'liveBotV35.js';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `async function closeTrade(mode, trade, price, reason) {
  const qty = Math.abs(Number(trade.filled_qty ?? trade.qty ?? 0));
  if (!(qty > 0)) throw new Error(\`No close quantity for \${trade.market}.\`);
  const side = trade.direction === 'SHORT' ? 'buy' : 'sell';`;

const newBlock = `async function closeTrade(mode, trade, price, reason) {
  let qty = Math.abs(Number(trade.filled_qty ?? trade.qty ?? 0));
  if (!(qty > 0)) throw new Error(\`No close quantity for \${trade.market}.\`);
  const side = trade.direction === 'SHORT' ? 'buy' : 'sell';

  // Crypto buy fills can leave a slightly smaller sellable balance after fees.
  // Clamp the exit to the broker's actual current position instead of repeatedly
  // requesting the original pre-fee fill quantity and getting Alpaca 403 errors.
  if (trade.asset_class === 'crypto' && side === 'sell') {
    const brokerPositions = await getPositions(mode);
    const brokerPosition = brokerPositions.find((p) => normalizeSymbol(p.symbol) === normalizeSymbol(trade.market));
    const availableQty = Math.abs(Number(brokerPosition?.qty || 0));
    if (availableQty > 0 && availableQty < qty) qty = availableQty;
  }`;

if (source.includes(newBlock)) {
  console.log('[boot-patch] V35 crypto exit quantity clamp already installed.');
} else if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(path, source);
  console.log('[boot-patch] V35 crypto exit quantity clamp installed.');
} else {
  throw new Error('V35 closeTrade block not recognized; refusing to start without verified exit-quantity repair.');
}
