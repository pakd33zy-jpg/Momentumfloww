// momentumflow/liveBot.js - buying power error handling repair

function evaluateAndExecuteTrade(context) {
  const { mode, direction, best, equity, buyingPower, state } = context;

  if (!buyingPower || buyingPower <= 0) {
    console.warn(`[${mode}-bot] Invalid buying power (${buyingPower}). Skipping entry.`);
    state.lastDecision = `${mode.toUpperCase()} ${direction} ${best.symbol} skipped - invalid buying power ($${buyingPower})`;
    return;
  }

  const sizing = buildPositionBudget({
    equity,
    buyingPower,
    best,
  });

  if (!Number.isFinite(sizing.positionBudget) || sizing.positionBudget < 1) {
    state.lastDecision = `${mode.toUpperCase()} ${direction} ${best.symbol} skipped - risk-sized budget $${(Number(sizing.positionBudget || 0)).toFixed(2)} is below $1`;
    return;
  }

  state.lastDecision = `${mode.toUpperCase()} ${best.strategy} ${direction} ${best.symbol} score ${best.score}/10 risk budget $${sizing.riskDollars.toFixed(2)} position budget $${sizing.positionBudget.toFixed(2)}`;

  let order;
  try {
    // execute order sequence
  } catch (err) {
    console.error(`Order execution failed: ${err.message}`);
  }
}