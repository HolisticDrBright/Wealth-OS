/**
 * Asset-to-broker routing with jurisdiction enforcement.
 *
 * Priority order per asset class:
 *   1. broker_override in params
 *   2. ASSET_DEFAULT_BROKER map
 *   3. First configured adapter that handles the asset class
 *   4. skipped (no configured broker)
 */

import type { OrderParams, BrokerResult } from './types'
import { BrokerAdapter } from './types'
import { isGuardTokenValid, liveTradingEnabled, PAPER_PHASE_REASON, type GuardToken } from './execution-guard'
import {
  AlpacaAdapter,
  KrakenAdapter,
  CoinbaseAdapter,
  BinanceAdapter,
  OandaAdapter,
  IBKRAdapter,
  RobinhoodAdapter,
  WebullAdapter,
  EToroAdapter,
  TastytradeAdapter,
  PolymarketAdapter,
  DeribitAdapter,
} from './adapters'

// ─── Adapter registry ─────────────────────────────────────────────────────────

export const BROKER_ADAPTERS: BrokerAdapter[] = [
  new AlpacaAdapter(),
  new KrakenAdapter(),
  new CoinbaseAdapter(),
  new BinanceAdapter(),
  new OandaAdapter(),
  new IBKRAdapter(),
  new RobinhoodAdapter(),
  new WebullAdapter(),
  new EToroAdapter(),
  new TastytradeAdapter(),
  new PolymarketAdapter(),
  new DeribitAdapter(),
]

export const BROKER_CONFIGS = Object.fromEntries(
  BROKER_ADAPTERS.map(a => [a.config.id, a.config])
)

// ─── Default broker per asset class ──────────────────────────────────────────

export const ASSET_DEFAULT_BROKER: Record<string, string> = {
  stock:              'alpaca',
  etf:                'alpaca',
  equity:             'alpaca',
  crypto:             'kraken',
  crypto_options:     'deribit',
  crypto_futures:     'deribit',
  forex:              'oanda',
  fx:                 'oanda',
  options:            'tastytrade',
  futures:            'ibkr',
  prediction_market:  'polymarket',
  polymarket:         'polymarket',
  cfd:                'etoro',
}

// ─── selectBroker() ────────────────────────────────────────────────────────────

/**
 * Select the best available broker adapter for an order.
 *
 * Returns null if no configured, jurisdiction-allowed adapter is available.
 */
export function selectBroker(params: OrderParams): BrokerAdapter | null {
  const adapterMap = new Map(BROKER_ADAPTERS.map(a => [a.config.id, a]))

  // 1. Explicit override
  if (params.broker_override) {
    const adapter = adapterMap.get(params.broker_override)
    if (adapter && adapter.isConfigured() && adapter.isAllowedJurisdiction(params.jurisdiction)) {
      return adapter
    }
    return null
  }

  // 2. Asset class default
  const defaultId = ASSET_DEFAULT_BROKER[params.asset_class.toLowerCase()]
  if (defaultId) {
    const adapter = adapterMap.get(defaultId)
    if (adapter && adapter.isConfigured() && adapter.isAllowedJurisdiction(params.jurisdiction)) {
      return adapter
    }
  }

  // 3. First configured adapter that handles this asset class
  for (const adapter of BROKER_ADAPTERS) {
    if (
      adapter.config.assetClasses.includes(params.asset_class.toLowerCase()) &&
      adapter.isConfigured() &&
      adapter.isAllowedJurisdiction(params.jurisdiction)
    ) {
      return adapter
    }
  }

  return null
}

// ─── submitOrder() — drop-in replacement for the old broker-router ─────────────

export async function submitOrder(
  params: OrderParams,
  guard?: GuardToken
): Promise<BrokerResult> {
  // The router REFUSES ungated submissions — no future caller can skip the
  // kill switch / cost gate by calling submitOrder directly.
  if (!isGuardTokenValid(guard)) {
    return {
      status: 'failed',
      reason: 'ungated submission refused — run preExecutionGuard() and pass its token',
    }
  }
  // Master switch: real broker execution is OFF during the paper phase.
  if (!liveTradingEnabled()) {
    return { status: 'skipped', reason: PAPER_PHASE_REASON }
  }

  const adapter = selectBroker(params)
  if (!adapter) {
    return {
      status: 'skipped',
      reason: `No configured broker for asset_class="${params.asset_class}"${params.jurisdiction ? ` in jurisdiction="${params.jurisdiction}"` : ''}`,
    }
  }
  return adapter.execute(params)
}
