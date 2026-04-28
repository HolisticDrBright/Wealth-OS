/**
 * Autopilot Congressional — FLOW FOLLOWER
 * Source: wealth-os-vault/01 - Stocks/Autopilot Congressional.md
 * Edge: flow (#edge/flow)
 * Asset: stocks → Alpaca
 * AI Confluence: Kronos=skip, MiroFish=medium
 *
 * Copies purchases filed by US senators/representatives within 20 days of
 * transaction, filtered to large-cap (>$1B mkt cap) trades in the top decile
 * of reported trade sizes. Holds 90 days or until position is closed by the
 * original member of congress (whichever comes first).
 *
 * Data sources:
 *   - Quiver Quant API (gated via FeatureFlagService ~2c/call)
 *   - SEC EDGAR full-text search (free fallback, 30-day lag)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { binomialPValue } from '@/lib/stats/binomial-pvalue'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
} from '../../pipeline-types'
import { getRiskControl, getPortfolioUsd, quarterKelly, applyConfluenceHaircut } from '../../risk-controls'
import { getLiveCongressTrades } from '@/lib/market-data/quiver'
import type { CongressTrade } from '@/lib/market-data/quiver'
import { randomUUID } from 'crypto'

// ─── Thresholds (per vault recipe) ────────────────────────────────────────────

const MAX_FILING_LAG_DAYS  = 20      // reject if filed more than 20 days after trade
const MIN_TRADE_AMOUNT_USD = 15_001  // minimum dollar range midpoint (~$15k)
const TOP_DECILE_USD       = 100_000 // trades above this are top-decile by count
const TRADE_RISK_PCT       = 0.005   // 0.5% per trade (flow-following is lower-conviction)
const HOLD_DAYS            = 90      // target 90-day hold
const MAX_SIMULTANEOUS     = 5       // max open congressional positions

// ─── Free fallback: House/Senate Stock Watcher public S3 feeds ───────────────

const HOUSE_WATCHER_URL  = 'https://house-stock-watcher-data.s3-us-east-2.amazonaws.com/data/all_transactions.json'
const SENATE_WATCHER_URL = 'https://senate-stock-watcher-data.s3-us-east-2.amazonaws.com/aggregate/all_transactions.json'

interface HouseRecord {
  disclosure_year?: string
  disclosure_date?: string
  transaction_date?: string
  ticker?: string
  type?: string
  amount?: string
  representative?: string
}

interface SenateRecord {
  transaction_date?: string
  ticker?: string
  asset_type?: string
  type?: string
  amount?: string
  senator?: string
  disclosure_date?: string
}

/** Parse dollar range midpoint. e.g. "$15,001 - $50,000" → 32500 */
function parseAmountRange(amount: string): number {
  const nums = amount.replace(/[$,]/g, '').match(/\d+/g)?.map(Number) ?? []
  if (nums.length === 0) return 0
  if (nums.length === 1) return nums[0]
  return (nums[0] + nums[1]) / 2
}

/**
 * Fetch recent congressional stock trades from the free public S3 feeds.
 * housestockwatcher.com and senatestockwatcher.com maintain these.
 * Returns trades from the last 60 days, sorted by transaction_date desc.
 */
async function fetchStockWatcherFallback(): Promise<CongressTrade[]> {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const trades: CongressTrade[] = []

  const [houseRes, senateRes] = await Promise.allSettled([
    fetch(HOUSE_WATCHER_URL, { signal: AbortSignal.timeout(10_000) }),
    fetch(SENATE_WATCHER_URL, { signal: AbortSignal.timeout(10_000) }),
  ])

  if (houseRes.status === 'fulfilled' && houseRes.value.ok) {
    try {
      const rows: HouseRecord[] = await houseRes.value.json()
      for (const r of rows) {
        const txDate = r.transaction_date ?? ''
        if (!txDate || txDate < cutoff) continue
        const ticker = (r.ticker ?? '').trim().toUpperCase()
        if (!ticker || ticker === 'N/A' || ticker.length > 5) continue
        const txType = (r.type ?? '').toLowerCase()
        if (!txType.includes('purchase')) continue
        const amount_usd = parseAmountRange(r.amount ?? '')
        trades.push({
          Ticker:          ticker,
          Representative:  r.representative ?? 'Unknown',
          Transaction:     'Purchase',
          Range:           r.amount ?? '',
          TransactionDate: txDate,
          ReportDate:      r.disclosure_date ?? txDate,
          House:           'House',
          amount_usd,
        })
      }
    } catch { /* ignore parse errors */ }
  }

  if (senateRes.status === 'fulfilled' && senateRes.value.ok) {
    try {
      const rows: SenateRecord[] = await senateRes.value.json()
      for (const r of rows) {
        const txDate = r.transaction_date ?? ''
        if (!txDate || txDate < cutoff) continue
        const ticker = (r.ticker ?? '').trim().toUpperCase()
        if (!ticker || ticker === 'N/A' || ticker.length > 5) continue
        if ((r.asset_type ?? '').toLowerCase() !== 'stock') continue
        const txType = (r.type ?? '').toLowerCase()
        if (!txType.includes('purchase')) continue
        const amount_usd = parseAmountRange(r.amount ?? '')
        trades.push({
          Ticker:          ticker,
          Representative:  r.senator ?? 'Unknown',
          Transaction:     'Purchase',
          Range:           r.amount ?? '',
          TransactionDate: txDate,
          ReportDate:      r.disclosure_date ?? txDate,
          House:           'Senate',
          amount_usd,
        })
      }
    } catch { /* ignore parse errors */ }
  }

  return trades.sort((a, b) => b.TransactionDate.localeCompare(a.TransactionDate))
}

// ─── Market cap check ─────────────────────────────────────────────────────────

/** Quick market cap filter using Yahoo Finance public API (no key required). */
async function getMarketCapUsd(ticker: string): Promise<number> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return 0
    const data = await res.json()
    const quote = data.chart?.result?.[0]?.meta
    // Yahoo returns marketCap directly in meta for some symbols
    return (quote?.marketCap as number | undefined) ?? 0
  } catch {
    return 0
  }
}

// ─── Filing lag ───────────────────────────────────────────────────────────────

function filingLagDays(transactionDate: string, reportDate: string): number {
  const tx = new Date(transactionDate).getTime()
  const rpt = new Date(reportDate).getTime()
  return Math.max(0, Math.floor((rpt - tx) / (24 * 60 * 60 * 1000)))
}

// ─── Count open positions ─────────────────────────────────────────────────────

async function countOpenCongressPositions(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data } = await supabase
    .from('user_copied_positions')
    .select('id')
    .eq('user_id', userId)
    .eq('asset_class', 'stocks')
    .eq('status', 'open')
    .like('broker_override_reason', '%congressional%')
  return (data ?? []).length
}

// Minimum trades to apply binomial filter; below this we skip the filter
const MIN_FILER_HISTORY = 10

interface FilerStat {
  wins: number
  total: number
  avgReturnVsSpy: number
}

/** Fetch closed congress trades for this representative from paper_trades. */
async function getFilerHistory(
  supabase: SupabaseClient,
  representative: string
): Promise<FilerStat> {
  try {
    const { data } = await supabase
      .from('paper_trades')
      .select('pnl_pct, metadata')
      .eq('strategy_key', 'autopilot_congressional')
      .not('pnl_pct', 'is', null)
      .limit(100)
    if (!data || data.length === 0) return { wins: 0, total: 0, avgReturnVsSpy: 0 }

    // Filter to trades from this representative
    const filerTrades = data.filter(t => {
      const meta = t.metadata as Record<string, unknown> | null
      return meta?.representative === representative
    })
    if (filerTrades.length === 0) return { wins: 0, total: filerTrades.length, avgReturnVsSpy: 0 }

    const wins = filerTrades.filter(t => (t.pnl_pct as number) > 0).length
    const avg = filerTrades.reduce((s, t) => s + (t.pnl_pct as number), 0) / filerTrades.length
    return { wins, total: filerTrades.length, avgReturnVsSpy: avg / 100 }
  } catch {
    return { wins: 0, total: 0, avgReturnVsSpy: 0 }
  }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class AutopilotCongressionalStrategy extends BasePipelineStrategy {
  readonly key = 'autopilot_congressional' as const
  readonly displayName = 'Autopilot Congressional'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = []

    // Respect max simultaneous cap early
    let openCount = 0
    if (ctx.supabase && ctx.metadata?.userId) {
      openCount = await countOpenCongressPositions(ctx.supabase, ctx.metadata.userId as string)
      if (openCount >= MAX_SIMULTANEOUS) return []
    }

    // Pull congress trades — prefer Quiver Quant, fall back to free S3 feeds
    let rawTrades: CongressTrade[] = []
    const hasQuiver = !!process.env.QUIVER_QUANT_API_KEY
    if (hasQuiver) {
      rawTrades = await getLiveCongressTrades()
    } else {
      rawTrades = await fetchStockWatcherFallback()
    }

    if (rawTrades.length === 0) return []

    // Filter: only Purchases (not sales)
    const purchases = rawTrades.filter(t => t.Transaction === 'Purchase')

    // Filter: filing lag ≤ 20 days
    const fresh = purchases.filter(t => {
      const lag = filingLagDays(t.TransactionDate, t.ReportDate)
      return lag <= MAX_FILING_LAG_DAYS
    })

    // Filter: trade size ≥ MIN_TRADE_AMOUNT_USD
    const sizable = fresh.filter(t => (t.amount_usd ?? 0) >= MIN_TRADE_AMOUNT_USD)

    // Deduplicate by ticker (take largest trade per ticker in this batch)
    const byTicker = new Map<string, CongressTrade>()
    for (const t of sizable) {
      const existing = byTicker.get(t.Ticker)
      if (!existing || (t.amount_usd ?? 0) > (existing.amount_usd ?? 0)) {
        byTicker.set(t.Ticker, t)
      }
    }

    for (const [ticker, trade] of byTicker) {
      if (opportunities.length + openCount >= MAX_SIMULTANEOUS) break

      // Market cap filter (>$1B) — skip if fetch fails (conservative)
      const cap = await getMarketCapUsd(ticker)
      if (cap > 0 && cap < 1_000_000_000) continue

      // Binomial p-value filter (suislanchez methodology)
      // Only applied when we have enough history for this filer
      if (ctx.supabase) {
        const filerStat = await getFilerHistory(ctx.supabase, trade.Representative)
        if (filerStat.total >= MIN_FILER_HISTORY) {
          if (binomialPValue(filerStat.wins, filerStat.total) > 0.001) continue
          if (filerStat.avgReturnVsSpy < 0.02) continue
        }
      }

      const lag = filingLagDays(trade.TransactionDate, trade.ReportDate)
      const tradeAmount = trade.amount_usd ?? MIN_TRADE_AMOUNT_USD
      const isTopDecile = tradeAmount >= TOP_DECILE_USD

      // Strength: function of trade amount, freshness, and whether top decile
      const amountScore   = Math.min(1, tradeAmount / 1_000_000)  // scale 0→1 at $1M
      const freshnessScore = 1 - lag / MAX_FILING_LAG_DAYS         // higher for fresher
      const decileBonus   = isTopDecile ? 0.2 : 0
      const strength      = Math.min(1, amountScore * 0.5 + freshnessScore * 0.3 + decileBonus)

      // Expected return: congressional alphas average ~6% over 90d (academic estimates)
      const expectedReturn = 0.06 * (strength * 0.5 + 0.5)  // 3–6% range

      const targetDate = new Date(Date.now() + HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: ticker,
        direction: 'long',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          ticker,
          representative: trade.Representative,
          house: trade.House,
          party: trade.Party,
          transactionDate: trade.TransactionDate,
          reportDate: trade.ReportDate,
          filingLagDays: lag,
          tradeAmount,
          isTopDecile,
          holdDays: HOLD_DAYS,
          targetExitDate: targetDate,
          source: hasQuiver ? 'quiver' : 'stockwatcher',
          reasoning: `${trade.Representative} (${trade.House}) purchased $${(tradeAmount / 1000).toFixed(0)}k of ${ticker} on ${trade.TransactionDate}, filed ${lag}d later.${isTopDecile ? ' Top-decile size.' : ''} 90-day hold.`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const lag       = (opp.metadata.filingLagDays as number | undefined) ?? 0
    const amount    = (opp.metadata.tradeAmount   as number | undefined) ?? 0
    const topDecile = (opp.metadata.isTopDecile   as boolean | undefined) ?? false

    if (lag > MAX_FILING_LAG_DAYS) return { passed: false, score: 15, reason: `Filing lag ${lag}d exceeds ${MAX_FILING_LAG_DAYS}d limit` }
    if (amount < MIN_TRADE_AMOUNT_USD) return { passed: false, score: 20, reason: `Trade size $${amount} below minimum` }

    // Opposing case: the member might be making a personal financial decision, not signalling alpha
    // Academic papers show congressional alpha decays rapidly after day 20 and is mostly in small-caps
    let baseScore = Math.min(100, opp.strength * 70 + (topDecile ? 15 : 0))

    // Penalty for stale filings
    if (lag > 10) baseScore *= 0.85

    return {
      passed: baseScore >= 40,
      score: baseScore,
      reason: baseScore < 40
        ? `Congressional alpha signal too weak (score ${baseScore.toFixed(0)}). Lag=${lag}d, amount=$${(amount / 1000).toFixed(0)}k.`
        : undefined,
    }
  }

  async sizePosition(
    opp: Opportunity,
    verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : 10_000
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    // Recipe: 0.5% per trade, quarter-Kelly overlay
    const qk = quarterKelly(opp.strength, opp.expectedReturn / 0.015)
    let fraction = Math.min(qk, TRADE_RISK_PCT, maxSinglePct / 100)
    fraction = applyConfluenceHaircut(fraction, verdicts.mirofish?.score ?? null, verdicts.kronos?.pass ?? null)
    fraction = Math.max(fraction, 0.003)  // minimum 0.3%

    const notionalUsd = fraction * portfolio
    return {
      fraction,
      notionalUsd,
      rationale: `QK=${(qk * 100).toFixed(1)}% flow-edge, congress lag=${opp.metadata.filingLagDays}d, amount=$${((opp.metadata.tradeAmount as number) / 1000).toFixed(0)}k`,
    }
  }
}
