/**
 * Tier 1 Backtest Runner
 *
 * Replays historical snapshots through each Tier 1 strategy's detectOpportunities()
 * and records whether the subsequent price move validated the signal.
 *
 * Usage (CLI):
 *   npx tsx lib/workers/backtest/tier1-runner.ts [--days=90] [--strategy=all]
 *
 * Output: JSON written to backtest-results/tier1-{date}.json
 *         Aggregate report printed to stdout
 */

import { createClient } from '@supabase/supabase-js'
import type { OpportunityContext, Opportunity } from '@/lib/strategies/pipeline-types'

// ─── Concrete Tier 1 strategies ──────────────────────────────────────────────

import { PolymarketWalletCopyStrategy } from '@/lib/strategies/impl/polymarket/polymarket-wallet-copy'
import { PolymarketInfoLagStrategy } from '@/lib/strategies/impl/polymarket/polymarket-info-lag'
import { AutopilotCongressionalStrategy } from '@/lib/strategies/impl/stocks/autopilot-congressional'
import { DcaHalvingStrategy } from '@/lib/strategies/impl/crypto/dca-halving'
import { FundingBasisArbStrategy } from '@/lib/strategies/impl/crypto/funding-basis-arb'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  strategyKey: string
  opportunityId: string
  symbol: string
  direction: string
  strength: number
  expectedReturn: number
  detectedAt: string
  /** Price at entry (from metadata or approximated) */
  entryPrice: number
  /** Price at exit (from historical data + hold period) */
  exitPrice: number | null
  /** Actual return: (exit - entry) / entry, sign-adjusted for direction */
  actualReturn: number | null
  /** Whether trade hit target (>0 actual return) */
  win: boolean | null
  holdDays: number | null
  metadata: Record<string, unknown>
}

export interface StrategyBacktestResult {
  strategyKey: string
  displayName: string
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  avgReturn: number
  sharpeApprox: number   // simplified: avgReturn / stdDev
  maxDrawdown: number
  totalReturn: number
  aiLiftEstimate: number // placeholder — computed from audit_logs in master-report
}

// ─── Historical price fetcher ─────────────────────────────────────────────────

/**
 * Fetch historical OHLC for a symbol at a given date.
 * Uses Yahoo Finance chart API (no key).
 */
async function getHistoricalClose(symbol: string, date: Date): Promise<number | null> {
  try {
    const ts = Math.floor(date.getTime() / 1000)
    const end = ts + 86400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${ts}&period2=${end}`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close as (number | null)[]
    return closes?.[0] ?? null
  } catch {
    return null
  }
}

// ─── Per-strategy hold periods ────────────────────────────────────────────────

const HOLD_DAYS: Record<string, number> = {
  polymarket_wallet_copy: 3,
  polymarket_info_lag: 1,
  autopilot_congressional: 90,
  dca_halving: 30,
  funding_basis_arb: 1,
}

// ─── Snapshot generator ───────────────────────────────────────────────────────

/**
 * Generate daily opportunity snapshots by calling detectOpportunities()
 * with minimal context (no live API calls in backtest mode — uses ctx.metadata overrides).
 *
 * For a real backtest, inject historical data via ctx.metadata. The strategy
 * implementations fall back to live APIs when metadata is absent, so this
 * runner is best used for forward testing (paper trade replay) rather than
 * pure historical replay.
 */
async function runStrategyBacktest(
  strategy: { key: string; displayName: string; detectOpportunities: (ctx: OpportunityContext) => Promise<Opportunity[]> },
  days: number,
  supabase: ReturnType<typeof createClient>
): Promise<BacktestTrade[]> {
  const trades: BacktestTrade[] = []
  const holdDays = HOLD_DAYS[strategy.key] ?? 7
  const ctx: OpportunityContext = { supabase: supabase as never, metadata: { _backtestMode: true } }

  // For each "day" in the backtest window, call detectOpportunities
  // In production: replay saved snapshots from a database table
  // For now: call once with current data (paper-trade forward test)
  const opportunities = await strategy.detectOpportunities(ctx).catch(() => [] as Opportunity[])

  for (const opp of opportunities) {
    const detectedDate = new Date(opp.detectedAt)
    const exitDate = new Date(detectedDate.getTime() + holdDays * 86400_000)
    const entryPrice = (opp.metadata.entryPrice as number | undefined) ??
                       (opp.metadata.spotPrice  as number | undefined) ??
                       (opp.metadata.currentPrice as number | undefined) ??
                       (opp.metadata.price as number | undefined) ?? 0

    // Fetch exit price from historical data
    let exitPrice: number | null = null
    if (entryPrice > 0) {
      exitPrice = await getHistoricalClose(opp.symbol.replace('POLY:', '').replace('-PERP', ''), exitDate)
    }

    let actualReturn: number | null = null
    if (exitPrice !== null && entryPrice > 0) {
      const rawReturn = (exitPrice - entryPrice) / entryPrice
      actualReturn = opp.direction === 'short' ? -rawReturn : rawReturn
    }

    trades.push({
      strategyKey: strategy.key,
      opportunityId: opp.id,
      symbol: opp.symbol,
      direction: opp.direction,
      strength: opp.strength,
      expectedReturn: opp.expectedReturn,
      detectedAt: opp.detectedAt,
      entryPrice,
      exitPrice,
      actualReturn,
      win: actualReturn !== null ? actualReturn > 0 : null,
      holdDays,
      metadata: opp.metadata as Record<string, unknown>,
    })
  }

  return trades
}

// ─── Aggregate metrics ────────────────────────────────────────────────────────

function computeMetrics(strategyKey: string, displayName: string, trades: BacktestTrade[]): StrategyBacktestResult {
  const resolved = trades.filter(t => t.actualReturn !== null)
  const wins     = resolved.filter(t => t.win === true)
  const losses   = resolved.filter(t => t.win === false)

  const returns = resolved.map(t => t.actualReturn as number)
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0

  const stdDev = returns.length > 1
    ? Math.sqrt(returns.map(r => (r - avgReturn) ** 2).reduce((a, b) => a + b, 0) / (returns.length - 1))
    : 0

  // Max drawdown: running equity curve
  let peak = 1
  let maxDD = 0
  let equity = 1
  for (const r of returns) {
    equity *= (1 + r)
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDD) maxDD = dd
  }

  const totalReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1

  return {
    strategyKey,
    displayName,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: resolved.length > 0 ? wins.length / resolved.length : 0,
    avgReturn,
    sharpeApprox: stdDev > 0 ? avgReturn / stdDev : 0,
    maxDrawdown: maxDD,
    totalReturn,
    aiLiftEstimate: 0,  // populated from audit_logs in master-report
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runTier1Backtest(days = 90): Promise<{
  trades: BacktestTrade[]
  results: StrategyBacktestResult[]
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  )

  const strategies = [
    new PolymarketWalletCopyStrategy(),
    new PolymarketInfoLagStrategy(),
    new AutopilotCongressionalStrategy(),
    new DcaHalvingStrategy(),
    new FundingBasisArbStrategy(),
  ]

  const allTrades: BacktestTrade[] = []
  const results: StrategyBacktestResult[] = []

  for (const strategy of strategies) {
    console.log(`[backtest] Running ${strategy.displayName}...`)
    const trades = await runStrategyBacktest(strategy, days, supabase)
    allTrades.push(...trades)
    results.push(computeMetrics(strategy.key, strategy.displayName, trades))
  }

  return { trades: allTrades, results }
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.endsWith('tier1-runner.ts'))) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace('--', '').split('=')))
  const days = parseInt(String(args.days ?? '90'), 10)

  runTier1Backtest(days).then(({ trades, results }) => {
    console.log('\n=== TIER 1 BACKTEST RESULTS ===\n')
    for (const r of results) {
      console.log(`${r.displayName}:`)
      console.log(`  Trades: ${r.totalTrades} | Win rate: ${(r.winRate * 100).toFixed(1)}% | Avg return: ${(r.avgReturn * 100).toFixed(2)}%`)
      console.log(`  Max DD: ${(r.maxDrawdown * 100).toFixed(1)}% | Sharpe≈: ${r.sharpeApprox.toFixed(2)} | Total: ${(r.totalReturn * 100).toFixed(1)}%`)
    }
    // Write JSON
    const fs = require('fs')
    const dir = 'backtest-results'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir)
    const file = `${dir}/tier1-${new Date().toISOString().split('T')[0]}.json`
    fs.writeFileSync(file, JSON.stringify({ trades, results }, null, 2))
    console.log(`\nResults written to ${file}`)
  }).catch(console.error)
}
