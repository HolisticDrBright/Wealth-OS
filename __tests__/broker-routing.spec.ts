/**
 * Unit tests for the broker routing module.
 *
 * Tests:
 *   - selectBroker returns correct primary for each asset class
 *   - selectBroker respects jurisdiction restrictions (fallback_legal)
 *   - selectBroker honours user_override when legal
 *   - selectBroker ignores user_override blocked by jurisdiction
 *   - BrokerFactory caches same instance for same userId+broker
 */

import { describe, it, expect, vi } from 'vitest'
import {
  selectBroker,
  isBrokerAllowed,
  normaliseAssetClass,
  BROKER_CONFIGS,
  ASSET_DEFAULT_BROKER,
  type Broker,
  type AssetClass,
} from '@/lib/brokers/asset-broker-routing'

// ─── isBrokerAllowed ──────────────────────────────────────────────────────────

describe('isBrokerAllowed', () => {
  it('allows alpaca (us_retail_ok) in US jurisdiction', () => {
    expect(isBrokerAllowed('alpaca', 'us')).toBe(true)
  })

  it('allows polymarket (us_unavailable) in EU jurisdiction', () => {
    // us_unavailable brokers are still allowed outside the US
    expect(isBrokerAllowed('polymarket', 'eu')).toBe(true)
  })

  it('allows kraken_futures (us_unavailable) in non-US jurisdictions', () => {
    expect(isBrokerAllowed('kraken_futures', 'eu')).toBe(true)
    expect(isBrokerAllowed('kraken_futures', 'sg')).toBe(true)
  })

  it('allows binance_us (us_retail_restricted) in US', () => {
    expect(isBrokerAllowed('binance_us', 'us')).toBe(true)
  })

  it('allows all brokers in "other" jurisdiction', () => {
    for (const broker of Object.keys(BROKER_CONFIGS) as Broker[]) {
      expect(isBrokerAllowed(broker, 'other')).toBe(true)
    }
  })
})

// ─── selectBroker — primary defaults ─────────────────────────────────────────

describe('selectBroker — primary defaults', () => {
  it('returns oanda for forex + us jurisdiction (no override)', () => {
    const r = selectBroker({ assetClass: 'forex', userJurisdiction: 'us' })
    expect(r.broker).toBe('oanda')
    expect(r.reason).toBe('default')
  })

  it('returns polymarket for polymarket asset class', () => {
    // polymarket is us_unavailable but that is a special case — it IS the only broker
    const r = selectBroker({ assetClass: 'polymarket', userJurisdiction: 'eu' })
    expect(r.broker).toBe('polymarket')
  })

  it('returns alpaca for stocks + us jurisdiction', () => {
    const r = selectBroker({ assetClass: 'stocks', userJurisdiction: 'us' })
    expect(r.broker).toBe('alpaca')
    expect(r.reason).toBe('default')
  })

  it('returns coinbase for crypto_spot + us jurisdiction', () => {
    const r = selectBroker({ assetClass: 'crypto_spot', userJurisdiction: 'us' })
    expect(r.broker).toBe('coinbase')
    expect(r.reason).toBe('default')
  })

  it('returns tradier for options + us jurisdiction', () => {
    const r = selectBroker({ assetClass: 'options', userJurisdiction: 'us' })
    expect(r.broker).toBe('tradier')
    expect(r.reason).toBe('default')
  })

  it('returns ibkr for futures + us jurisdiction', () => {
    const r = selectBroker({ assetClass: 'futures', userJurisdiction: 'us' })
    expect(r.broker).toBe('ibkr')
    expect(r.reason).toBe('default')
  })
})

// ─── selectBroker — user_override ────────────────────────────────────────────

describe('selectBroker — user_override', () => {
  it('returns user_override when legal in jurisdiction', () => {
    const r = selectBroker({
      assetClass: 'forex',
      userOverride: 'ibkr',
      userJurisdiction: 'us',
    })
    expect(r.broker).toBe('ibkr')
    expect(r.reason).toBe('user_override')
  })

  it('falls back to default when override is blocked by jurisdiction (kraken_futures in US)', () => {
    // kraken_futures is us_unavailable → should fall through to primary
    const r = selectBroker({
      assetClass: 'crypto_perp',
      userOverride: 'kraken_futures',
      userJurisdiction: 'us',
    })
    // kraken_futures is NOT allowed in US → falls to primary (kraken_futures) or fallback (binance_us)
    // Since both primary AND override are kraken_futures, it falls to fallback
    expect(r.broker).toBe('binance_us')
    expect(r.reason).toBe('fallback_legal')
  })

  it('accepts kraken_futures override in EU jurisdiction', () => {
    const r = selectBroker({
      assetClass: 'crypto_perp',
      userOverride: 'kraken_futures',
      userJurisdiction: 'eu',
    })
    expect(r.broker).toBe('kraken_futures')
    expect(r.reason).toBe('user_override')
  })
})

// ─── selectBroker — fallback_legal ───────────────────────────────────────────

describe('selectBroker — fallback_legal', () => {
  it('uses fallback when primary is blocked', () => {
    // Force a scenario where primary is us_unavailable but we're in 'us'
    // crypto_perp primary=kraken_futures (us_unavailable) → fallback=binance_us (us_retail_restricted → allowed)
    const r = selectBroker({
      assetClass: 'crypto_perp',
      userJurisdiction: 'us',
    })
    // kraken_futures is us_unavailable in 'us' jurisdiction
    // So we should get fallback: binance_us
    expect(r.broker).toBe('binance_us')
    expect(r.reason).toBe('fallback_legal')
  })
})

// ─── normaliseAssetClass ──────────────────────────────────────────────────────

describe('normaliseAssetClass', () => {
  it('maps "stock" to "stocks"', () => {
    expect(normaliseAssetClass('stock')).toBe('stocks')
  })

  it('maps "crypto" to "crypto_spot"', () => {
    expect(normaliseAssetClass('crypto')).toBe('crypto_spot')
  })

  it('maps "forex" to "forex"', () => {
    expect(normaliseAssetClass('forex')).toBe('forex')
  })

  it('maps "polymarket" to "polymarket"', () => {
    expect(normaliseAssetClass('polymarket')).toBe('polymarket')
  })

  it('defaults unknown types to "stocks"', () => {
    expect(normaliseAssetClass('unknown_type')).toBe('stocks')
  })
})

// ─── BROKER_CONFIGS completeness ──────────────────────────────────────────────

describe('BROKER_CONFIGS', () => {
  it('has all 12 required brokers configured', () => {
    const required: Broker[] = [
      'alpaca', 'ibkr', 'tradier', 'tradestation',
      'coinbase', 'kraken', 'binance_us', 'kraken_futures',
      'oanda', 'tastyfx', 'forex_com', 'polymarket',
    ]
    for (const broker of required) {
      expect(BROKER_CONFIGS[broker], `Missing config for ${broker}`).toBeDefined()
    }
  })

  it('every broker config has required fields', () => {
    for (const [broker, cfg] of Object.entries(BROKER_CONFIGS)) {
      expect(cfg.displayName, broker).toBeTruthy()
      expect(cfg.apiKeyEnvKey, broker).toBeTruthy()
      expect(cfg.fees, broker).toBeDefined()
      expect(Array.isArray(cfg.assetClasses), broker).toBe(true)
    }
  })

  it('every ASSET_DEFAULT_BROKER entry references valid broker keys', () => {
    for (const [asset, { primary, fallback }] of Object.entries(ASSET_DEFAULT_BROKER)) {
      expect(BROKER_CONFIGS[primary], `${asset}.primary=${primary}`).toBeDefined()
      expect(BROKER_CONFIGS[fallback], `${asset}.fallback=${fallback}`).toBeDefined()
    }
  })
})

// ─── BrokerFactory caching ────────────────────────────────────────────────────

describe('BrokerFactory caching', () => {
  it('returns the same instance for the same userId+broker within one cache', async () => {
    // We can test the caching logic directly without mocking Supabase
    // by importing getBroker and passing a no-op supabase
    const { getBroker } = await import('@/lib/brokers/BrokerFactory')
    const cache = new Map()

    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }

    const a1 = await getBroker('alpaca', 'user-1', mockSupabase as never, cache)
    const a2 = await getBroker('alpaca', 'user-1', mockSupabase as never, cache)
    const a3 = await getBroker('alpaca', 'user-2', mockSupabase as never, cache)

    expect(a1).toBe(a2)      // same user+broker → same instance
    expect(a1).not.toBe(a3)  // different user → different instance
  })
})
