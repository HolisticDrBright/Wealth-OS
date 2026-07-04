/**
 * DEPRECATED — retired legacy broker router.
 *
 * This module used to contain its own executeVia* broker implementations,
 * which formed a second, weaker path to real brokers (no capability model,
 * no liveReady gate, unsafe notional→units conversions). Those
 * implementations are GONE. Everything here delegates to
 * `lib/broker-adapters/router.ts`, so every submission — manual API routes
 * included — passes the exact same guard-token, master-switch, capability,
 * jurisdiction, and liveReady logic.
 *
 * New code should import from '@/lib/broker-adapters/router' directly.
 * Only `mapToKrakenPair` remains here as a real implementation because the
 * Kraken PRICE feed (lib/kraken-client.ts) uses it — it never places orders.
 */

export { submitOrder } from './broker-adapters/router'
export type { OrderParams, BrokerResult } from './broker-adapters/types'

/** Kraken pair mapping for the public price feed — read-only usage. */
export function mapToKrakenPair(symbol: string): string {
  const map: Record<string, string> = {
    BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD',
    ADA: 'ADAUSD', DOT: 'DOTUSD', AVAX: 'AVAXUSD',
    MATIC: 'MATICUSD', LINK: 'LINKUSD', XRP: 'XXRPZUSD',
    LTC: 'XLTCZUSD', DOGE: 'XDGEUSD',
  }
  return map[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`
}
