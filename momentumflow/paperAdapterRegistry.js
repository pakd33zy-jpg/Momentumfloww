/**
 * Paper-only adapter contract and registry.
 * These adapters intentionally do not connect to brokers or submit orders.
 * Real provider adapters must implement separate authentication, sandbox tests,
 * idempotency, reconciliation, and explicit live-mode controls before registration.
 */
const REQUIRED_METHODS = ['getAccount', 'getPositions', 'previewOrder', 'submitPaperOrder'];

export class PaperAdapterRegistry {
  constructor() { this.adapters = new Map(); }
  register(engineId, adapter) {
    if (!/^(crypto|forex|ninjatrader|polymarket)$/.test(engineId)) throw new Error('Unknown engine identifier.');
    if (adapter?.mode !== 'paper') throw new Error('Only paper-mode adapters may be registered.');
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter?.[method] !== 'function') throw new Error(`Adapter ${engineId} is missing ${method}().`);
    }
    this.adapters.set(engineId, adapter);
    return this.status(engineId);
  }
  get(engineId) { return this.adapters.get(engineId) || null; }
  status(engineId) {
    const adapter = this.get(engineId);
    return { engineId, registered: Boolean(adapter), mode: adapter?.mode || null, ready: false,
      note: adapter ? 'Adapter contract registered; provider sandbox verification is still required.' : 'No provider adapter registered.' };
  }
  list() { return ['crypto', 'forex', 'ninjatrader', 'polymarket'].map((id) => this.status(id)); }
}

export const paperAdapterRegistry = new PaperAdapterRegistry();
