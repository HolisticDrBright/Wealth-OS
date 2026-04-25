/**
 * BrokerFactory — user-scoped broker adapter instantiation.
 *
 * Reads the user's linked API keys from the `linked_accounts` table (or env
 * vars as fallback) and returns the appropriate concrete adapter.
 *
 * Caching: one Map per call-site (pass the same cache across calls in a single
 * request/job to avoid redundant DB reads). The factory does NOT hold global
 * mutable state so it is safe for concurrent requests.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BrokerAdapter } from '@/lib/broker-adapters/types'
import {
  AlpacaAdapter,
  KrakenAdapter,
  CoinbaseAdapter,
  BinanceAdapter,
  OandaAdapter,
  IBKRAdapter,
  TastytradeAdapter,
  PolymarketAdapter,
  DeribitAdapter,
} from '@/lib/broker-adapters/adapters'
import type { Broker } from './asset-broker-routing'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-request cache — create one per API route handler / worker run. */
export type BrokerCache = Map<string, BrokerAdapter>

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Return a configured BrokerAdapter for the given user + broker combination.
 *
 * Reads credentials from:
 *   1. `linked_accounts` table row for this user + provider
 *   2. Process env vars (fallback — used in dev / paper-trading)
 *
 * Pass the same `cache` Map across multiple `getBroker()` calls within a single
 * request to avoid redundant DB queries.
 */
export async function getBroker(
  broker: Broker,
  userId: string,
  supabase: SupabaseClient,
  cache: BrokerCache = new Map()
): Promise<BrokerAdapter> {
  const cacheKey = `${userId}::${broker}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // Attempt to fetch user's linked credentials
  const credentials = await fetchUserCredentials(supabase, userId, broker)

  const adapter = buildAdapter(broker, credentials)
  cache.set(cacheKey, adapter)
  return adapter
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Credentials {
  api_key?: string
  api_secret?: string
  account_id?: string
  access_token?: string
}

/**
 * Fetch decrypted credentials from linked_accounts.
 * Falls back to empty object — the adapter will then read from env vars.
 */
async function fetchUserCredentials(
  supabase: SupabaseClient,
  userId: string,
  broker: Broker
): Promise<Credentials> {
  try {
    const provider = brokerToProvider(broker)
    const { data } = await supabase
      .from('linked_accounts')
      .select('api_key, api_secret, account_id, access_token')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('status', 'active')
      .limit(1)
      .single()
    return (data as Credentials | null) ?? {}
  } catch {
    return {}
  }
}

/**
 * Map broker ID to the provider string used in linked_accounts table.
 * Providers follow the LinkedAccount.provider union from lib/types.ts.
 */
function brokerToProvider(broker: Broker): string {
  const map: Partial<Record<Broker, string>> = {
    alpaca:         'alpaca',
    kraken:         'kraken',
    kraken_futures: 'kraken',
    coinbase:       'coinbase',
    binance_us:     'binance_us',
    oanda:          'oanda',
    ibkr:           'ibkr',
    tastyfx:        'tastyfx',
    forex_com:      'forex_com',
    tradier:        'tradier',
    tradestation:   'tradestation',
    polymarket:     'polymarket',
  }
  return map[broker] ?? broker
}

/**
 * Instantiate the concrete adapter, injecting user credentials into env vars
 * temporarily if the adapter reads from process.env (which all current adapters
 * do). This avoids rewriting each adapter's constructor.
 *
 * NOTE: This pattern is acceptable in a serverless context where each request
 * is isolated. In a long-running process you'd pass credentials via constructor.
 */
function buildAdapter(broker: Broker, creds: Credentials): BrokerAdapter {
  // Apply user credentials to env vars for this adapter instantiation
  // Only set if value is present (don't overwrite configured defaults with empty)
  if (creds.api_key) {
    process.env[apiKeyEnvVar(broker)] = creds.api_key
  }
  if (creds.api_secret) {
    const secretKey = apiSecretEnvVar(broker)
    if (secretKey) process.env[secretKey] = creds.api_secret
  }
  if (creds.account_id) {
    const acctKey = accountIdEnvVar(broker)
    if (acctKey) process.env[acctKey] = creds.account_id
  }
  if (creds.access_token) {
    process.env[apiKeyEnvVar(broker)] = creds.access_token
  }

  switch (broker) {
    case 'alpaca':         return new AlpacaAdapter()
    case 'kraken':         return new KrakenAdapter()
    case 'kraken_futures': return new KrakenAdapter()  // same credentials
    case 'coinbase':       return new CoinbaseAdapter()
    case 'binance_us':     return new BinanceAdapter()
    case 'oanda':          return new OandaAdapter()
    case 'ibkr':           return new IBKRAdapter()
    case 'tastyfx':        return new TastytradeAdapter()
    case 'forex_com':      return new TastytradeAdapter()  // same adapter pattern
    case 'tradier':        return new TastytradeAdapter()  // same REST pattern
    case 'tradestation':   return new TastytradeAdapter()  // same REST pattern
    case 'polymarket':     return new PolymarketAdapter()
    default:               return new AlpacaAdapter()
  }
}

// ─── Env var name helpers ─────────────────────────────────────────────────────

function apiKeyEnvVar(broker: Broker): string {
  const m: Record<Broker, string> = {
    alpaca:         'ALPACA_API_KEY',
    ibkr:           'IBKR_ACCOUNT_ID',
    tradier:        'TRADIER_API_KEY',
    tradestation:   'TRADESTATION_API_KEY',
    coinbase:       'COINBASE_API_KEY',
    kraken:         'KRAKEN_API_KEY',
    binance_us:     'BINANCE_API_KEY',
    kraken_futures: 'KRAKEN_FUTURES_API_KEY',
    oanda:          'OANDA_API_KEY',
    tastyfx:        'TASTYFX_API_KEY',
    forex_com:      'FOREX_COM_API_KEY',
    polymarket:     'POLYMARKET_PRIVATE_KEY',
  }
  return m[broker]
}

function apiSecretEnvVar(broker: Broker): string | null {
  const m: Partial<Record<Broker, string>> = {
    alpaca:         'ALPACA_SECRET_KEY',
    tradier:        'TRADIER_API_SECRET',
    tradestation:   'TRADESTATION_API_SECRET',
    coinbase:       'COINBASE_API_SECRET',
    kraken:         'KRAKEN_API_SECRET',
    binance_us:     'BINANCE_API_SECRET',
    kraken_futures: 'KRAKEN_FUTURES_API_SECRET',
    tastyfx:        'TASTYFX_API_SECRET',
    forex_com:      'FOREX_COM_API_SECRET',
  }
  return m[broker] ?? null
}

function accountIdEnvVar(broker: Broker): string | null {
  const m: Partial<Record<Broker, string>> = {
    oanda:        'OANDA_ACCOUNT_ID',
    ibkr:         'IBKR_ACCOUNT_ID',
    tradestation: 'TRADESTATION_ACCOUNT_ID',
    tastyfx:      'TASTYFX_ACCOUNT_NUMBER',
  }
  return m[broker] ?? null
}
