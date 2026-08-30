const fs = require('fs');

const path = 'liveBotV35.js';
let s = fs.readFileSync(path, 'utf8');

const oldBlock = `  if (!(positionBudget > 1)) {\n    state.lastDecision = \`${'${mode.toUpperCase()} ${best.symbol}'} skipped - V35 risk/exposure budget has no room\`;\n    return false;\n  }`;

const newBlock = `  const minOrderNotional = best.assetClass === 'crypto' ? 10 : 1;\n  if (!(positionBudget >= minOrderNotional)) {\n    const amount = Number.isFinite(Number(positionBudget)) ? Number(positionBudget).toFixed(2) : '0.00';\n    state.lastDecision = \`${'${mode.toUpperCase()} ${best.symbol}'} skipped - V35 available risk/exposure budget $\${amount} is below Alpaca $\${minOrderNotional} minimum\`;\n    return false;\n  }`;

if (s.includes(newBlock)) {
  console.log('[boot-patch] V35 Alpaca minimum-order guard already present.');
  process.exit(0);
}

if (!s.includes(oldBlock)) {
  console.error('[boot-patch] V35 minimum-order target block not found; refusing blind edit.');
  process.exit(2);
}

s = s.replace(oldBlock, newBlock);
fs.writeFileSync(path, s);
console.log('[boot-patch] V35 Alpaca minimum-order guard installed.');
