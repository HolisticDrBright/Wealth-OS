/**
 * Polymarket Crypto Binary 5-Min
 * Source: vault/08 - Polymarket/Polymarket Oracle Lag Repos Evaluation.md
 * Source: vault/08 - Polymarket/Information Lag Edge.md
 * Edge: information (oracle latency arb on Chainlink Data Streams)
 * Asset: polymarket -> Polymarket CLOB API
 * AI Confluence: Kronos=skip, MiroFish=medium
 * External deps: warproxxx/poly_data (backtest), KaustubhPatange/polymarket-trade-engine (execution)
 *
 * Strategy logic:
 *   Enter Polymarket BTC/ETH/SOL/XRP/DOGE 5-min and 15-min binary price markets when:
 *     (a) Off-chain reference price (Coinbase + Binance) has crossed the binary target
 *         by ≥$50 in the same direction as the binary outcome we are betting on
 *     (b) On-chain market price has NOT yet repriced past 0.55 (still cheap)
 *     (c) We are NOT in the first 240 seconds of the window (skip retail entry zone)
 *     (d) Order book imbalance over first 10 levels > 1.8 (buyers loading) OR < 0.55
 *         (sellers breaking) — directionally actionable
 *
 *   Exit:
 *     - Pre-arm limit sell at 0.75 immediately on fill
 *     - Hard market-out 15 seconds before window close
 *     - Never wait for resolution
 *
 *   Position sizing:
 *     - 0.5% account cap per single market entry
 *     - Quarter-Kelly on estimated edge (function of deviation)
 *     - -25% size if MiroFish neutral, -50% if MiroFish bear matches direction
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
import { getRiskControl, applyConfluenceHaircut } from '../../risk-controls'
import { computeEmpiricalSize, zeroSize } from '@/lib/risk/empirical-sizing'
import { PolymarketEngineClient } from '@/lib/integrations/polymarket-engine/PolymarketEngineClient'
import type { Market, OrderBook } from '@/lib/integrations/polymarket-engine/PolymarketEngineClient'
import { randomUUID } from 'crypto'

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'] as const
type CryptoSymbol = typeof SYMBOLS[number]

const MIN_OFFCHAIN_DEVIATION_USD  = 50       // off-chain must cross target by ≥$50
const HIGH_CONVICTION_DEVIATION   = 100      // $100+ → run MiroFish
const MAX_ONCHAIN_PRICE           = 0.55     // market still cheap below this
const ENTRY_TARGET_PRICE          = 0.75     // pre-arm exit here on fill
const WINDOW_ENTRY_SKIP_SECS      = 240      // skip first 4 minutes (retail zone)
const HARD_EXIT_BEFORE_CLOSE_SECS = 15       // market-out this many secs before window close
const MAX_POSITION_PCT            = 0.005    // 0.5% of book per entry
const IMBALANCE_BUY_THRESHOLD     = 1.8      // buyers loading (bid/ask vol > 1.8)
const IMBALANCE_SELL_THRESHOLD    = 0.55     // sellers breaking (bid/ask vol < 0.55)

// ─── Off-chain price fetchers ─────────────────────────────────────────────────

interface OffChainPrice {
  coinbaseUsd: number | null
  binanceUsd: number | null
  consensusUsd: number | null
  fetchedAt: number
}

// Coinbase Advanced Trade REST — public endpoint, no auth for spot price
async function fetchCoinbasePrice(symbol: CryptoSymbol): Promise<number | null> {
  const pairs: Record<CryptoSymbol, string> = {
    BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD', DOGE: 'DOGE-USD',
  }
  try {
    const res = await fetch(
      `https://api.coinbase.com/v2/prices/${pairs[symbol]}/spot`,
      { signal: AbortSignal.timeout(3_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { data?: { amount?: string } }
    return parseFloat(data.data?.amount ?? '') || null
  } catch { return null }
}

// Binance spot (international) — public
async function fetchBinancePrice(symbol: CryptoSymbol): Promise<number | null> {
  const pairs: Record<CryptoSymbol, string> = {
    BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT',
  }
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${pairs[symbol]}`,
      { signal: AbortSignal.timeout(3_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { price?: string }
    return parseFloat(data.price ?? '') || null
  } catch { return null }
}

async function getOffChainPrice(symbol: CryptoSymbol): Promise<OffChainPrice> {
  const [coinbaseUsd, binanceUsd] = await Promise.all([
    fetchCoinbasePrice(symbol),
    fetchBinancePrice(symbol),
  ])
  const prices = [coinbaseUsd, binanceUsd].filter((p): p is number => p !== null)
  const consensusUsd = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null
  return { coinbaseUsd, binanceUsd, consensusUsd, fetchedAt: Date.now() }
}

// ─── Market parsing ───────────────────────────────────────────────────────────

/**
 * Parse the binary target price from a market question like:
 *   "Will BTC be above $95,000 at 2:00 PM?"
 */
function parseTargetPrice(question: string): number | null {
  const match = question.match(/\$\s*([\d,]+(?:\.\d+)?)/i)
  if (!match) return null
  return parseFloat(match[1].replace(/,/g, '')) || null
}

/**
 * Determine if the market is a YES (above) or NO (below) market.
 * Returns 'above' for questions asking if price will be above target, 'below' otherwise.
 */
function parseMarketDirection(question: string): 'above' | 'below' {
  return /\babove\b|\bover\b|\bexceed\b/i.test(question) ? 'above' : 'below'
}

/**
 * Returns how many seconds have elapsed since the window opened.
 * Uses the market's end time and typical window length.
 */
function secondsElapsedInWindow(market: Market, windowMin: 5 | 15): number {
  const windowMs = windowMin * 60 * 1000
  const openedAt = market.endTime - windowMs
  return Math.max(0, (Date.now() - openedAt) / 1000)
}

/**
 * Compute order book imbalance over the top N levels.
 * > 1: more bid volume (buyers loading); < 1: more ask volume.
 */
function computeImbalance(book: OrderBook, levels = 10): number {
  const bidVol = book.bids.slice(0, levels).reduce((s, b) => s + b.size, 0)
  const askVol = book.asks.slice(0, levels).reduce((s, a) => s + a.size, 0)
  if (askVol === 0) return bidVol > 0 ? 99 : 1
  return bidVol / askVol
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class PolymarketCryptoBinary5MinStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_crypto_binary_5min' as const
  readonly displayName = 'Polymarket Crypto Binary 5-Min'
  readonly assetClass = 'polymarket' as const

  // Filled at execute() time; cleared after exit
  private readonly activeExits = new Map<string, { orderId: string; unsubscribe: () => void }>()

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    const supabase = ctx.supabase
    const userId = (ctx.metadata?.userId as string | undefined) ?? 'anon'
    const engine = supabase
      ? new PolymarketEngineClient(supabase, userId)
      : null

    if (!engine) return []

    const opportunities: Opportunity[] = []

    for (const symbol of SYMBOLS) {
      for (const windowMin of [5, 15] as const) {
        const marketsRes = await engine.discoverMarkets({ symbol, windowMin, status: 'active' })
        if (marketsRes.skipped) continue

        const offChain = await getOffChainPrice(symbol)
        if (!offChain.consensusUsd) continue

        for (const market of marketsRes.result) {
          const opp = await this._evaluateMarket(market, windowMin, offChain, engine)
          if (opp) opportunities.push(opp)
        }
      }
    }

    return opportunities
  }

  private async _evaluateMarket(
    market: Market,
    windowMin: 5 | 15,
    offChain: OffChainPrice,
    engine: PolymarketEngineClient
  ): Promise<Opportunity | null> {
    // Condition (c): not in first 240 seconds of the window
    const elapsed = secondsElapsedInWindow(market, windowMin)
    if (elapsed < WINDOW_ENTRY_SKIP_SECS) return null

    const targetPrice = parseTargetPrice(market.question)
    if (!targetPrice) return null

    const direction = parseMarketDirection(market.question)
    const offChainUsd = offChain.consensusUsd!

    // Condition (a): off-chain has crossed target by ≥$50 in correct direction
    const deviation = direction === 'above'
      ? offChainUsd - targetPrice   // positive = above target
      : targetPrice - offChainUsd   // positive = below target

    if (deviation < MIN_OFFCHAIN_DEVIATION_USD) return null

    // Condition (b): on-chain market price not yet repriced past 0.55
    const onChainPrice = market.yesPrice  // YES price = probability of "above" outcome
    const relevantOnChainPrice = direction === 'above' ? onChainPrice : (1 - onChainPrice)
    if (relevantOnChainPrice > MAX_ONCHAIN_PRICE) return null

    // Condition (d): order book imbalance check — subscribe and wait up to 2s for first snapshot
    let imbalance = 1.0
    let unsubBook: (() => void) | undefined
    await new Promise<void>(resolve => {
      unsubBook = engine.subscribeOrderBook(market.marketId, book => {
        imbalance = computeImbalance(book)
        unsubBook?.()
        resolve()
      })
      setTimeout(() => resolve(), 2_000)
    })

    const isActionableImbalance =
      (direction === 'above' && imbalance > IMBALANCE_BUY_THRESHOLD) ||
      (direction === 'below' && imbalance < IMBALANCE_SELL_THRESHOLD)

    if (!isActionableImbalance) return null

    const side: Opportunity['direction'] = direction === 'above' ? 'long' : 'short'
    const strength = Math.min(1, deviation / 200)  // $200 deviation = max strength
    const expectedReturn = ENTRY_TARGET_PRICE - relevantOnChainPrice  // e.g. 0.75 - 0.42 = 0.33

    return {
      id: randomUUID(),
      strategyKey: this.key,
      symbol: `POLY:${market.conditionId}`,
      direction: side,
      assetClass: this.assetClass,
      strength,
      expectedReturn,
      metadata: {
        marketId: market.marketId,
        conditionId: market.conditionId,
        question: market.question,
        symbol: market.symbol,
        windowMin,
        targetPrice,
        marketDirection: direction,
        offChainUsd,
        offChainDeviation: deviation,
        onChainPrice: relevantOnChainPrice,
        imbalance,
        endTime: market.endTime,
        elapsed,
        entryPrice: relevantOnChainPrice,
        target1: ENTRY_TARGET_PRICE,
        hardExitAt: market.endTime - HARD_EXIT_BEFORE_CLOSE_SECS * 1000,
        highConviction: deviation >= HIGH_CONVICTION_DEVIATION,
        reasoning: `Off-chain ${market.symbol} at $${offChainUsd.toFixed(0)}, ` +
          `target $${targetPrice.toFixed(0)} (${direction}), ` +
          `deviation $${deviation.toFixed(0)} ≥ $${MIN_OFFCHAIN_DEVIATION_USD}. ` +
          `On-chain price ${relevantOnChainPrice.toFixed(3)} < ${MAX_ONCHAIN_PRICE}. ` +
          `Imbalance ${imbalance.toFixed(2)}. Exit target: ${ENTRY_TARGET_PRICE}.`,
      },
      detectedAt: new Date().toISOString(),
    }
  }

  // ── MiroFish: medium tier, but upgrade to full sim when deviation ≥ $100 ────

  async runMiroFishConfluence(
    opp: Opportunity,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<import('../../pipeline-types').MiroFishVerdict | null> {
    const isHighConviction = opp.metadata.highConviction as boolean | undefined
    // Only run when deviation is high-conviction (≥$100 off-chain crossing)
    if (!isHighConviction) return null
    return super.runMiroFishConfluence(opp, userId, supabase)
  }

  // ── Kronos: skip per matrix ─────────────────────────────────────────────────

  async runKronosConfluence(): Promise<null> {
    return null
  }

  // ── Red Team ────────────────────────────────────────────────────────────────

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const offChainUsd  = opp.metadata.offChainUsd    as number
    const targetPrice  = opp.metadata.targetPrice    as number
    const onChain      = opp.metadata.onChainPrice   as number
    const deviation    = opp.metadata.offChainDeviation as number
    const endTime      = opp.metadata.endTime        as number

    // Stale off-chain data check (> 10s old = stale)
    const detectedMs = new Date(opp.detectedAt).getTime()
    if (Date.now() - detectedMs > 10_000) {
      return { passed: false, score: 10, reason: 'Off-chain price fetch stale > 10s' }
    }

    // Minimum time remaining in window (don't enter if < 30s left)
    const timeRemainingMs = endTime - Date.now()
    if (timeRemainingMs < 30_000) {
      return { passed: false, score: 5, reason: 'Less than 30s remaining in window' }
    }

    // Sanity: binary market resolution criteria match our reading
    if (!targetPrice || targetPrice <= 0) {
      return { passed: false, score: 0, reason: 'Could not parse binary target price from question' }
    }

    // On-chain must still be below threshold (could have moved since detectOpportunities)
    if (onChain > MAX_ONCHAIN_PRICE + 0.03) {
      return { passed: false, score: 20, reason: `On-chain repriced to ${onChain.toFixed(3)} — lag closed` }
    }

    const deviationScore  = Math.min(40, deviation / 5)    // $200 = max 40 pts
    const lagScore        = Math.min(30, (MAX_ONCHAIN_PRICE - onChain) * 200)  // more lag = more pts
    const timeScore       = Math.min(20, Math.log10(timeRemainingMs / 1000) * 10)
    const score = deviationScore + lagScore + timeScore

    return {
      passed: score >= 40,
      score,
      reason: score < 40
        ? `Red-team score ${score.toFixed(0)} insufficient (deviation=${deviation.toFixed(0)}, lag=${(MAX_ONCHAIN_PRICE - onChain).toFixed(3)})`
        : undefined,
    }
  }

  // ── Size ────────────────────────────────────────────────────────────────────

  async sizePosition(
    opp: Opportunity,
    verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const onChain = opp.metadata.onChainPrice as number
    const deviation = opp.metadata.offChainDeviation as number

    // Edge estimate: implied win probability from deviation — a real model
    // probability (not signal strength), so it feeds the shared empirical
    // path as modelWinProb until rolling calibration takes over.
    const estWinProb  = Math.min(0.85, 0.55 + deviation / 500)
    const estWinLoss  = (ENTRY_TARGET_PRICE - onChain) / onChain   // reward-to-risk ratio

    const sized = await computeEmpiricalSize({
      supabase, userId, strategyKey: this.key, opp,
      modelWinProb: estWinProb,
      winLossRatio: Math.max(0.5, estWinLoss),
      capFraction: MAX_POSITION_PCT,
    })
    if (sized.blocked || sized.portfolioUsd == null) {
      return zeroSize(sized.reason ?? 'refusing to size')
    }
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined

    let fraction = Math.min(sized.fraction, MAX_POSITION_PCT)
    if (rc?.max_single_position_pct) {
      fraction = Math.min(fraction, rc.max_single_position_pct / 100)
    }

    // Confluence haircut using parent helper
    fraction = applyConfluenceHaircut(fraction, verdicts.mirofish?.score ?? null, null)

    // Extra haircut if MiroFish ran and gave a bear verdict matching our direction
    if (verdicts.mirofish?.scenario === 'bear' && opp.direction === 'long') fraction *= 0.5
    if (verdicts.mirofish?.scenario === 'bear' && opp.direction === 'short') fraction *= 0.5

    return {
      fraction,
      notionalUsd: fraction * sized.portfolioUsd,
      rationale: `${sized.rationale}, deviation=$${deviation.toFixed(0)}, estWin=${(estWinProb * 100).toFixed(0)}%`,
    }
  }

  // ── Execute ─────────────────────────────────────────────────────────────────

  async execute(
    opp: Opportunity,
    size: PositionSize,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<ExecutionResult> {
    if (!supabase) return { status: 'skipped', broker: 'polymarket', error: 'no supabase client' }

    const blocked = await this.checkKillSwitch(opp, userId, supabase)
    if (blocked) return blocked

    const liveBlocked = await this.checkLiveGate(opp, userId, supabase)
    if (liveBlocked) return liveBlocked

    const marketId   = opp.metadata.marketId    as string
    const endTime    = opp.metadata.endTime      as number
    const onChain    = opp.metadata.onChainPrice as number
    const hardExitAt = opp.metadata.hardExitAt   as number

    const engine = new PolymarketEngineClient(supabase, userId)

    // Place entry order
    const entry = await engine.placeOrder({
      marketId,
      side: 'buy',
      size: size.notionalUsd,
      limitPrice: onChain + 0.01,  // penny above current ask for fill probability
    })

    if (entry.skipped) {
      return { status: 'skipped', broker: 'polymarket', error: entry.reason }
    }

    const entryOrderId = entry.result

    // Subscribe to fills to pre-arm the exit limit order
    const unsub = engine.subscribeOrderBook(marketId, async (book) => {
      // Check if entry is filled by looking for a fill at our price range
      const fills = await engine.getFills(marketId)
      if (fills.skipped) return

      const ourFill = fills.result.find(f => f.orderId === entryOrderId && f.side === 'buy')
      if (!ourFill) return

      unsub()  // stop polling fills

      // Pre-arm limit sell at 0.75 immediately on fill (within ~100ms)
      const exitRes = await engine.placeOrder({
        marketId,
        side: 'sell',
        size: ourFill.size,
        limitPrice: ENTRY_TARGET_PRICE,
      })

      if (!exitRes.skipped) {
        this.activeExits.set(opp.id, {
          orderId: exitRes.result,
          unsubscribe: () => { /* already unsubscribed above */ },
        })
      }

      // Hard exit: schedule market-out at window close minus 15s
      const msUntilHardExit = hardExitAt - Date.now()
      if (msUntilHardExit > 0) {
        setTimeout(async () => {
          // Cancel the limit sell if still open, then market-out
          const activeExit = this.activeExits.get(opp.id)
          if (activeExit) {
            await engine.cancelOrder(activeExit.orderId).catch(() => {})
            this.activeExits.delete(opp.id)
          }
          // Market-out at best available bid
          await engine.placeOrder({
            marketId,
            side: 'sell',
            size: ourFill.size,
            limitPrice: 0.01,  // effectively market order — take any bid
          })
        }, msUntilHardExit)
      }
    })

    // Log to audit_logs
    if (supabase) {
      supabase.from('audit_logs').insert({
        strategy_key: this.key,
        symbol: opp.symbol,
        direction: opp.direction,
        edge_type: 'information',
        mirofish_used: false,
        kronos_used: false,
        decision: 'execute',
        size_fraction: size.fraction,
        decided_at: new Date().toISOString(),
        metadata: {
          broker_used: 'polymarket',
          polymarket_engine_used: true,
          market_id: marketId,
          entry_order_id: entryOrderId,
        },
      }).then(({ error }) => {
        if (error) console.warn('[audit] polymarket_crypto_binary_5min:', error.message)
      })
    }

    return {
      status: 'submitted',
      broker: 'polymarket',
      brokerOrderId: entryOrderId,
    }
  }
}
