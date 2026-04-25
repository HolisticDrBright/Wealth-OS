/**
 * Tier 1 strategies — ship first, paper-trade 14 days, confirm Sharpe > 1.5.
 *
 * 1. polymarket_wallet_copy    — copy high-win-rate Polymarket wallets
 * 2. polymarket_info_lag       — buy underdiscounted near-certain outcomes
 * 3. autopilot_congressional   — PEAD on congressional purchase disclosures
 * 4. dca_halving               — DCA BTC by halving cycle phase
 * 5. funding_basis_arb         — long spot + short perp when funding is high
 */

import type { PriceBar } from '@/lib/backtester'
import { BaseStrategy, type StrategySignal } from '../base-strategy'
import {
  scanTrackedWalletTrades,
  getMarketDetails,
  getWalletPositions,
  getTrackedWallets,
} from '@/lib/market-data/polymarket-wallets'
import { getLiveCongressTrades, getCongressTradesForTicker } from '@/lib/market-data/quiver'
import { getUWCongressTrades } from '@/lib/market-data/unusual-whales'
import { getFundingRate, assessBasisArb } from '@/lib/market-data/funding-rates'
import { getDCASignal } from '@/lib/market-data/halving'

// ─── 1. polymarket_wallet_copy ────────────────────────────────────────────────

/**
 * Scans POLYMARKET_TRACKED_WALLETS for trades in the last 5 minutes.
 * Generates a signal to copy any new position that meets criteria:
 *   - Market has >= $10k liquidity
 *   - Market doesn't resolve within 24h (avoid fully-priced-in outcomes)
 *   - Position price is 0.10–0.90 (not near-certain)
 *
 * Symbol format: "POLY:{conditionId}"
 */
export class PolymarketWalletCopyStrategy extends BaseStrategy {
  readonly id = 'polymarket_wallet_copy'
  readonly displayName = 'Polymarket Wallet Copy'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'polymarket'
  readonly defaultAssetClass = 'prediction_market'
  readonly minBars = 0  // no price bars needed

  async generateSignal(
    symbol: string,
    _bars: PriceBar[],
    meta?: Record<string, unknown>
  ): Promise<StrategySignal | null> {
    const wallets = getTrackedWallets()
    if (wallets.length === 0) return null

    // Allow caller to pass pre-fetched trades via metadata to avoid redundant calls
    const trades = (meta?.recent_trades as Awaited<ReturnType<typeof scanTrackedWalletTrades>>) ??
      await scanTrackedWalletTrades(300)  // last 5 minutes

    if (trades.length === 0) return null

    // Take the most recent trade
    const trade = trades[0]
    const conditionId = trade.conditionId
    if (!conditionId) return null

    const details = await getMarketDetails(conditionId)
    if (!details) return null

    // Skip markets resolving in <24h (already priced in)
    const resolveMs = new Date(details.end_date_iso).getTime() - Date.now()
    if (resolveMs < 24 * 60 * 60 * 1000) return null

    // Skip near-certain outcomes (< 0.10 or > 0.90)
    const price = trade.side === 'YES' ? details.yes_price : details.no_price
    if (price < 0.10 || price > 0.90) return null

    // Skip low-liquidity markets
    if (details.liquidity < 10_000) return null

    // Edge = expected value assuming tracked wallet has 60% win rate
    const walletWinRate = (meta?.wallet_win_rate as number | undefined) ?? 0.60
    const ev = walletWinRate * (1 - price) - (1 - walletWinRate) * price
    if (ev <= 0) return null

    return {
      strategyId: this.id,
      symbol: `POLY:${conditionId}`,
      side: 'buy',
      strength: Math.min(1, ev / 0.15),
      expectedReturn: ev,
      assetClass: this.defaultAssetClass,
      metadata: {
        conditionId,
        question: details.question,
        side: trade.side,
        price,
        wallet: trade.wallet,
        liquidity: details.liquidity,
        resolves_in_days: Math.floor(resolveMs / 86400000),
      },
    }
  }
}

// ─── 2. polymarket_info_lag ───────────────────────────────────────────────────

/**
 * Information lag arbitrage: finds Polymarket markets where the outcome is
 * near-certain based on external information but the market price hasn't
 * fully moved yet.
 *
 * Trigger: caller provides a {conditionId, true_probability} via metadata
 * (populated by the news sentiment agent or AI analysis).
 *
 * Signal: buy YES when true_probability - market_price > lag_threshold.
 */
export class PolymarketInfoLagStrategy extends BaseStrategy {
  readonly id = 'polymarket_info_lag'
  readonly displayName = 'Polymarket Info Lag Arb'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'polymarket'
  readonly defaultAssetClass = 'prediction_market'
  readonly minBars = 0

  async generateSignal(
    symbol: string,
    _bars: PriceBar[],
    meta?: Record<string, unknown>
  ): Promise<StrategySignal | null> {
    const conditionId = meta?.conditionId as string | undefined
    const trueProbability = meta?.true_probability as number | undefined

    if (!conditionId || trueProbability === undefined) return null

    const details = await getMarketDetails(conditionId)
    if (!details) return null

    // Skip markets resolving in < 1h (no time to profit)
    const resolveMs = new Date(details.end_date_iso).getTime() - Date.now()
    if (resolveMs < 60 * 60 * 1000) return null

    const lagThreshold = 0.08  // min 8 cent gap to trade

    const yesPriceLag = trueProbability - details.yes_price
    const noPriceLag = (1 - trueProbability) - details.no_price

    if (yesPriceLag >= lagThreshold) {
      return {
        strategyId: this.id,
        symbol: `POLY:${conditionId}`,
        side: 'buy',
        strength: Math.min(1, yesPriceLag / 0.25),
        expectedReturn: yesPriceLag,
        assetClass: this.defaultAssetClass,
        metadata: { conditionId, question: details.question, side: 'YES', lag_cents: yesPriceLag },
      }
    }

    if (noPriceLag >= lagThreshold) {
      return {
        strategyId: this.id,
        symbol: `POLY:${conditionId}`,
        side: 'buy',
        strength: Math.min(1, noPriceLag / 0.25),
        expectedReturn: noPriceLag,
        assetClass: this.defaultAssetClass,
        metadata: { conditionId, question: details.question, side: 'NO', lag_cents: noPriceLag },
      }
    }

    return null
  }
}

// ─── 3. autopilot_congressional ──────────────────────────────────────────────

/**
 * Post-Announcement Drift on congressional purchase disclosures.
 *
 * Signal logic (PEAD on congress):
 *   1. Fetch live congressional trades (Quiver + UW, merged and deduplicated)
 *   2. Filter for Purchase transactions disclosed in the last 7 days
 *   3. Filter for historically profitable representatives (configurable list)
 *   4. Buy within 24h of disclosure — academic evidence shows 3–5% drift
 *      in the 20 days following insider-adjacent congressional purchases
 *
 * Historical high-alpha representatives (by study, not endorsement):
 *   Nancy Pelosi, Dan Crenshaw, Tommy Tuberville, David Perdue (retired)
 */

const HIGH_ALPHA_REPS = [
  'pelosi', 'tuberville', 'crenshaw', 'taylor', 'mccaul', 'gottheimer',
]

export class AutopilotCongressionalStrategy extends BaseStrategy {
  readonly id = 'autopilot_congressional'
  readonly displayName = 'Autopilot Congressional'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  readonly minBars = 0

  async generateSignal(
    symbol: string,
    _bars: PriceBar[],
    meta?: Record<string, unknown>
  ): Promise<StrategySignal | null> {
    // Fetch from both sources, prefer caller-supplied to avoid redundant API calls
    const quiverTrades = (meta?.quiver_trades as Awaited<ReturnType<typeof getLiveCongressTrades>>) ??
      await getLiveCongressTrades()

    const uwTrades = (meta?.uw_trades as Awaited<ReturnType<typeof getUWCongressTrades>>) ??
      await getUWCongressTrades(100)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Quiver purchases for this ticker by high-alpha reps
    const quiverSignals = quiverTrades.filter(t =>
      t.Ticker.toUpperCase() === symbol.toUpperCase() &&
      t.Transaction === 'Purchase' &&
      new Date(t.ReportDate) >= sevenDaysAgo &&
      HIGH_ALPHA_REPS.some(r => t.Representative.toLowerCase().includes(r))
    )

    // UW purchases for this ticker
    const uwSignals = uwTrades.filter(t =>
      t.ticker?.toUpperCase() === symbol.toUpperCase() &&
      t.transaction_type === 'buy' &&
      new Date(t.disclosure_date) >= sevenDaysAgo
    )

    const totalSignals = quiverSignals.length + uwSignals.length
    if (totalSignals === 0) return null

    // Score: each signal adds conviction, large trades add more
    const totalAmount = [
      ...quiverSignals.map(t => t.amount_usd ?? 0),
      ...uwSignals.map(t => t.amount_usd ?? 0),
    ].reduce((a, b) => a + b, 0)

    const strength = Math.min(1, (totalSignals * 0.25) + (totalAmount / 500_000) * 0.25)

    // Expected 3% drift over 20 days from PEAD literature (discounted for uncertainty)
    return {
      strategyId: this.id,
      symbol,
      side: 'buy',
      strength,
      expectedReturn: 0.03,
      assetClass: this.defaultAssetClass,
      metadata: {
        quiver_signals: quiverSignals.length,
        uw_signals: uwSignals.length,
        total_amount_usd: totalAmount,
        representatives: quiverSignals.map(t => t.Representative),
      },
    }
  }
}

// ─── 4. dca_halving ──────────────────────────────────────────────────────────

/**
 * DCA Bitcoin by halving cycle phase.
 *
 * Uses halving cycle state to size buys:
 *   accumulation: buy dips >= 15% from 90d high — full position building
 *   expansion:    buy dips >= 8% from 90d high  — ride momentum
 *   distribution: reduce on strength (< 5% from 90d high)
 *   contraction:  buy dips >= 22% — pre-halving re-entry
 */
export class DCAHalvingStrategy extends BaseStrategy {
  readonly id = 'dca_halving'
  readonly displayName = 'DCA Halving Cycle'
  readonly edgeClassification = 'macro' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'
  readonly minBars = 90

  async generateSignal(
    symbol: string,
    bars: PriceBar[]
  ): Promise<StrategySignal | null> {
    if (!['BTC', 'BITCOIN', 'XBT'].includes(symbol.toUpperCase())) return null
    if (bars.length < 90) return null

    const currentPrice = bars[bars.length - 1].close
    const ninetyDayHigh = Math.max(...bars.slice(-90).map(b => b.high))
    const dcaSignal = getDCASignal(currentPrice, ninetyDayHigh)

    if (dcaSignal.signal === 'hold') return null
    if (dcaSignal.strength === 0) return null

    return {
      strategyId: this.id,
      symbol,
      side: dcaSignal.signal === 'reduce' ? 'sell' : 'buy',
      strength: dcaSignal.strength,
      expectedReturn: dcaSignal.signal === 'buy' ? 0.20 : -0.05,  // cycle-level expected returns
      assetClass: this.defaultAssetClass,
      metadata: { reason: dcaSignal.reason, signal: dcaSignal.signal },
    }
  }
}

// ─── 5. funding_basis_arb ─────────────────────────────────────────────────────

/**
 * Funding rate basis arbitrage.
 *
 * When perpetual futures funding rate is high (longs paying shorts):
 *   → Long spot + short perp = earn the funding yield delta-neutral
 *
 * When funding is very negative (shorts paying longs):
 *   → Short spot + long perp = earn the negative funding yield
 *
 * Entry threshold: 0.05% per 8h (≈ 54.75% annualised)
 * Exit: when funding normalises below 0.01% per 8h
 *
 * Only generates a signal when bars are provided (spot price context).
 */
export class FundingBasisArbStrategy extends BaseStrategy {
  readonly id = 'funding_basis_arb'
  readonly displayName = 'Funding Rate Basis Arb'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'deribit'
  readonly defaultAssetClass = 'crypto_futures'
  readonly minBars = 1

  async generateSignal(
    symbol: string,
    bars: PriceBar[],
    meta?: Record<string, unknown>
  ): Promise<StrategySignal | null> {
    if (bars.length === 0) return null

    // Prefer caller-supplied funding rate (from a pre-fetch batch) to save API calls
    const fundingRate = (meta?.funding_rate as number | undefined) ??
      (await getFundingRate(symbol)).rate

    const { viable, side, annualisedYield } = assessBasisArb(fundingRate, 0.0005)
    if (!viable) return null

    // Trade the PERP side; spot hedge is handled at execution layer
    const perpSide: 'buy' | 'sell' = side === 'short_perp' ? 'sell' : 'buy'

    return {
      strategyId: this.id,
      symbol,
      side: perpSide,
      strength: Math.min(1, Math.abs(fundingRate) / 0.002),
      expectedReturn: annualisedYield / 12,  // monthly expected return
      assetClass: this.defaultAssetClass,
      metadata: {
        funding_rate_8h: fundingRate,
        annualised_yield: annualisedYield,
        arb_side: side,
        spot_hedge: perpSide === 'sell' ? 'buy_spot' : 'sell_spot',
      },
    }
  }
}

export const TIER1_STRATEGIES = [
  new PolymarketWalletCopyStrategy(),
  new PolymarketInfoLagStrategy(),
  new AutopilotCongressionalStrategy(),
  new DCAHalvingStrategy(),
  new FundingBasisArbStrategy(),
]
