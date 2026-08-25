export function evaluateAlpacaAccountAccess(account) {
  const status = String(account?.status || '').trim().toUpperCase();

  if (status !== 'ACTIVE') {
    return {
      allowed: false,
      reason: status
        ? `Alpaca account status is ${status}.`
        : 'Alpaca account status is unavailable.',
    };
  }

  if (account?.account_blocked) {
    return {
      allowed: false,
      reason: 'Alpaca reports account_blocked=true.',
    };
  }

  if (account?.trading_blocked) {
    return {
      allowed: false,
      reason: 'Alpaca reports trading_blocked=true.',
    };
  }

  if (account?.trade_suspended_by_user) {
    return {
      allowed: false,
      reason: 'Alpaca reports trade_suspended_by_user=true.',
    };
  }

  return { allowed: true, reason: null };
}
