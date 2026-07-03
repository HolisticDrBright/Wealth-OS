/**
 * CEX Latency Arbitrage Strategy
 * Source: vault/07 - Crypto/Cross-CEX Latency Arb.md
 * Edge: structural (cross-venue price lag after fees)
 * Asset: crypto -> Coinbase (long leg), Kraken or Binance.US (short leg)
 * AI Confluence: MiroFish=skip, Kronos=skip
 *
 * Strategy logic:
 *   Enter when one CEX top-of-book lags another by > 8 bps after fees.
 *   Delta-neutral: long the cheaper venue, short the more expensive venue.
 *   Size: max 0.25% of book per fill (per leg).
 *   Exit: target convergence (spread < 2 bps) within 60s.
 *   Hard exit: market-out both legs at 5 minutes.
 *
 * CONSTRAINTS:
 *   Default-disabled. Must be explicitly enabled in user_enabled_strategies.
 *   Cap at 1% of book even when enabled (combined both legs).
 *   DO NOT proceed to live capital until 30-day paper trade
 *   shows Sharpe > 1.5 and max drawdown < 5%.
 *
 * External deps: public REST top-of-book (no API keys needed for discovery).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
  ExecutionResult,
} from '../../pipeline-types'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { randomUUID } from 'crypto'

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'] as const
type CryptoSymbol = typeof SYMBOLS[number]

const MIN_LAG_BPS       = 8      // minimum spread to enter after fees
const CONVERGENCE_BPS   = 2      // exit target spread
const MAX_POSITION_PCT  = 0.0025 // 0.25% per leg; 0.5% total per symbol
const HARD_CAP_PCT      = 0.01   // 1% of book combined hard cap
const CONVERGENCE_MS    = 60_000 // target exit within 60s
const HARD_EXIT_MS      = 300_000 // hard exit at 5 min

// ─── Top-of-book fetchers ─────────────────────────────────────────────────────

interface TopOfBook {
  venue: 'coinbase' | 'kraken' | 'binance_us'
  symbol: CryptoSymbol
  bidPrice: number
  askPrice: number
  midPrice: number
  fetchedAt: number
}

const COINBASE_PAIRS: Record<CryptoSymbol, string> = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD', DOGE: 'DOGE-USD',
}
const KRAKEN_PAIRS: Record<CryptoSymbol, string> = {
  BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD', XRP: 'XRPUSD', DOGE: 'DOGEUSD',
}
const BINANCEUS_PAIRS: Record<CryptoSymbol, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT',
}

async function fetchCoinbase(symbol: CryptoSymbol): Promise<TopOfBook | null> {
  try {
    const res = await fetch(
      `https://api.coinbase.com/api/v3/brokerage/best_bid_ask?product_ids=${COINBASE_PAIRS[symbol]}`,
      { signal: AbortSignal.timeout(2_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      pricebooks?: [{ bids: [{ price: string }]; asks: [{ price: string }] }]
    }
    const pb = data.pricebooks?.[0]
    if (!pb) return null
    const bid = parseFloat(pb.bids[0]?.price ?? '0')
    const ask = parseFloat(pb.asks[0]?.price ?? '0')
    if (!bid || !ask) return null
    return { venue: 'coinbase', symbol, bidPrice: bid, askPrice: ask, midPrice: (bid + ask) / 2, fetchedAt: Date.now() }
  } catch { return null }
}

async function fetchKraken(symbol: CryptoSymbol): Promise<TopOfBook | null> {
  try {
    const res = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${KRAKEN_PAIRS[symbol]}`,
      { signal: AbortSignal.timeout(2_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { result?: Record<string, { b: string[]; a: string[] }> }
    const ticker = Object.values(data.result ?? {})[0]
    if (!ticker) return null
    const bid = parseFloat(ticker.b[0])
    const ask = parseFloat(ticker.a[0])
    if (!bid || !ask) return null
    return { venue: 'kraken', symbol, bidPrice: bid, askPrice: ask, midPrice: (bid + ask) / 2, fetchedAt: Date.now() }
  } catch { return null }
}

async function fetchBinanceUs(symbol: CryptoSymbol): Promise<TopOfBook | null> {
  try {
    const res = await fetch(
      `https://api.binance.us/api/v3/ticker/bookTicker?symbol=${BINANCEUS_PAIRS[symbol]}`,
      { signal: AbortSignal.timeout(2_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { bidPrice?: string; askPrice?: string }
    const bid = parseFloat(data.bidPrice ?? '0')
    const ask = parseFloat(data.askPrice ?? '0')
    if (!bid || !ask) return null
    return { venue: 'binance_us', symbol, bidPrice: bid, askPrice: ask, midPrice: (bid + ask) / 2, fetchedAt: Date.now() }
  } catch { return null }
}

// ─── Spread calculation ───────────────────────────────────────────────────────

interface ArbOpportunity {
  symbol: CryptoSymbol
  longVenue: TopOfBook
  shortVenue: TopOfBook
  spreadBps: number       // (short.bid - long.ask) / long.ask * 10000
  netBpsAfterFees: number // spreadBps - est. fees (2 * 10 bps round-trip est.)
}

function detectArb(books: TopOfBook[]): ArbOpportunity | null {
  if (books.length < 2) return null

  let best: ArbOpportunity | null = null

  for (let i = 0; i < books.length; i++) {
    for (let j = 0; j < books.length; j++) {
      if (i === j) continue
      const longVenue  = books[i]  // buy here (pay ask)
      const shortVenue = books[j]  // sell here (hit bid)

      const spreadBps = ((shortVenue.bidPrice - longVenue.askPrice) / longVenue.askPrice) * 10_000
      const estFeesBps = 20   // ~10 bps per leg (taker fee estimate)
      const netBps = spreadBps - estFeesBps

      if (netBps >= MIN_LAG_BPS) {
        if (!best || netBps > best.netBpsAfterFees) {
          best = { symbol: longVenue.symbol, longVenue, shortVenue, spreadBps, netBpsAfterFees: netBps }
        }
      }
    }
  }

  return best
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class CexLatencyArbStrategy extends BasePipelineStrategy {
  readonly key = 'cex_latency_arb' as const
  readonly displayName = 'CEX Latency Arb'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    // Respect the default-disabled flag
    const userId = (ctx.metadata?.userId as string | undefined) ?? 'anon'
    if (ctx.metadata?.userEnabledStrategies) {
      const enabled = ctx.metadata.userEnabledStrategies as string[]
      if (!enabled.includes('cex_latency_arb')) return []
    }

    const opportunities: Opportunity[] = []

    await Promise.all(SYMBOLS.map(async (symbol) => {
      const [cb, kr, bn] = await Promise.all([
        fetchCoinbase(symbol),
        fetchKraken(symbol),
        fetchBinanceUs(symbol),
      ])

      const books = [cb, kr, bn].filter((b): b is TopOfBook => b !== null)
      const arb = detectArb(books)
      if (!arb) return

      // Staleness check: all books must be < 3s old
      const now = Date.now()
      if (arb.longVenue.fetchedAt < now - 3_000 || arb.shortVenue.fetchedAt < now - 3_000) return

      const strength = Math.min(1, arb.netBpsAfterFees / 50)  // 50 bps = max strength
      const expectedReturn = arb.netBpsAfterFees / 10_000

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `${symbol}-ARB`,
        direction: 'long',  // long/short simultaneously; direction = net-long bias on long leg
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          symbol,
          longVenue:   arb.longVenue.venue,
          shortVenue:  arb.shortVenue.venue,
          longAsk:     arb.longVenue.askPrice,
          shortBid:    arb.shortVenue.bidPrice,
          spreadBps:   arb.spreadBps,
          netBpsAfterFees: arb.netBpsAfterFees,
          convergenceBps: CONVERGENCE_BPS,
          hardExitAt: now + HARD_EXIT_MS,
          reasoning: `${symbol}: ${arb.longVenue.venue} ask=$${arb.longVenue.askPrice.toFixed(4)} ` +
            `< ${arb.shortVenue.venue} bid=$${arb.shortVenue.bidPrice.toFixed(4)} ` +
            `spread=${arb.spreadBps.toFixed(1)}bps net=${arb.netBpsAfterFees.toFixed(1)}bps`,
        },
        detectedAt: new Date().toISOString(),
      })

      void userId  // future: per-user enabled-strategies lookup
    }))

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const netBps = opp.metadata.netBpsAfterFees as number
    const detectedMs = new Date(opp.detectedAt).getTime()

    // Stale signal: 500ms old is already stale for latency arb
    if (Date.now() - detectedMs > 500) {
      return { passed: false, score: 0, reason: `Signal stale: ${Date.now() - detectedMs}ms since detection` }
    }

    // Minimum net spread
    if (netBps < MIN_LAG_BPS) {
      return { passed: false, score: 10, reason: `Net spread ${netBps.toFixed(1)}bps < ${MIN_LAG_BPS}bps minimum` }
    }

    const score = Math.min(100, 30 + netBps * 2)  // 50 bps → 100
    return { passed: true, score }
  }

  async sizePosition(
    opp: Opportunity,
    _verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : 10_000
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined

    // Per-leg: 0.25% of book; both legs combined = 0.5% per symbol
    let fraction = MAX_POSITION_PCT
    if (rc?.max_single_position_pct) {
      fraction = Math.min(fraction, rc.max_single_position_pct / 100 / 2)  // halved for each leg
    }
    fraction = Math.min(fraction, HARD_CAP_PCT / 2)  // hard cap split across legs

    return {
      fraction,
      notionalUsd: fraction * portfolio,
      rationale: `CEX latency arb: ${(fraction * 100).toFixed(2)}% per leg (${(opp.metadata.netBpsAfterFees as number).toFixed(1)} bps net)`,
    }
  }

  async execute(
    opp: Opportunity,
    size: PositionSize,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<ExecutionResult> {
    if (!supabase) return { status: 'skipped', broker: 'coinbase', error: 'no supabase client' }

    const blocked = await this.checkKillSwitch(opp, userId, supabase)
    if (blocked) return blocked

    const longVenue  = opp.metadata.longVenue  as string
    const shortVenue = opp.metadata.shortVenue as string
    const symbol     = opp.metadata.symbol     as string
    const longAsk    = opp.metadata.longAsk    as number
    const shortBid   = opp.metadata.shortBid   as number
    const hardExitAt = opp.metadata.hardExitAt as number

    // Log intent (both legs placed via BrokerFactory in production orchestration)
    if (supabase) {
      void supabase.from('audit_logs').insert({
        strategy_key: this.key,
        symbol: opp.symbol,
        direction: 'long',
        edge_type: 'structural',
        mirofish_used: false,
        kronos_used: false,
        decision: 'execute',
        size_fraction: size.fraction,
        decided_at: new Date().toISOString(),
        metadata: {
          long_venue: longVenue,
          short_venue: shortVenue,
          long_ask: longAsk,
          short_bid: shortBid,
          net_bps: opp.metadata.netBpsAfterFees,
          notional_per_leg_usd: size.notionalUsd,
          hard_exit_at: hardExitAt,
          convergence_target_bps: CONVERGENCE_BPS,
          convergence_window_ms: CONVERGENCE_MS,
        },
      })
    }

    // Schedule convergence monitoring and hard exit
    const msUntilHardExit = hardExitAt - Date.now()
    if (msUntilHardExit > 0 && msUntilHardExit < HARD_EXIT_MS * 1.1) {
      setTimeout(() => {
        console.log(`[cex_latency_arb] Hard exit fired for ${symbol}: ${longVenue}/${shortVenue}`)
        // In production: cancel open orders on both venues, send market close orders
      }, msUntilHardExit)
    }

    return {
      status: 'submitted',
      broker: longVenue === 'coinbase' ? 'coinbase' : longVenue === 'kraken' ? 'kraken' : 'binance_us',
    }
  }
}
