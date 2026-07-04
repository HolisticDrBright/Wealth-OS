'use server'

/**
 * Paper-trading evidence scorecards (validation item 9) — the per-strategy
 * evidence pack the two-month paper phase produces:
 *
 *   closed count, win rate, expectancy, avg win / avg loss, max drawdown,
 *   longest loss streak, recorded-vs-model slippage, skipped/blocked counts,
 *   risk-veto counts, promotion readiness (existing gates), and a maturity
 *   recommendation derived from thresholds — never from vibes.
 */

import { createClient } from '@/lib/supabase/server'
import { evaluatePaperToLive, type PromotionReadiness } from '@/lib/strategies/promotion-gates'
import { getRollingBrier } from '@/lib/learning/rolling-brier'

export interface PaperScorecard {
  strategyKey: string
  assetClass: string
  closedTrades: number
  winRatePct: number | null
  /** Mean realized return per closed trade (fraction, slippage included). */
  expectancyPct: number | null
  avgWinPct: number | null
  avgLossPct: number | null
  maxDrawdownPct: number | null
  longestLossStreak: number
  /** Mean recorded fill slippage vs the model assumption (both bps). */
  meanSlippageBps: number | null
  modelSlippageBps: number | null
  /** Pipeline refusals recorded to audit_logs for this strategy. */
  blockedCount: number
  riskVetoCount: number
  promotion: PromotionReadiness
  /** Threshold-derived next step for the strategy. */
  maturityRecommendation: string
}

// ─── Pure core (exported for tests) ──────────────────────────────────────────

export interface ClosedTrade {
  closedAt: string
  returnPct: number   // fraction
}

export interface ScorecardCore {
  closedTrades: number
  winRatePct: number | null
  expectancyPct: number | null
  avgWinPct: number | null
  avgLossPct: number | null
  maxDrawdownPct: number | null
  longestLossStreak: number
}

export async function computeScorecardCore(trades: ClosedTrade[]): Promise<ScorecardCore> {
  const sorted = [...trades].sort((a, b) => a.closedAt.localeCompare(b.closedAt))
  const n = sorted.length
  if (n === 0) {
    return {
      closedTrades: 0, winRatePct: null, expectancyPct: null,
      avgWinPct: null, avgLossPct: null, maxDrawdownPct: null, longestLossStreak: 0,
    }
  }

  const rets = sorted.map(t => t.returnPct)
  const wins = rets.filter(r => r > 0)
  const losses = rets.filter(r => r < 0)
  const mean = rets.reduce((s, r) => s + r, 0) / n

  let equity = 1, peak = 1, maxDd = 0
  let streak = 0, longestStreak = 0
  for (const r of rets) {
    equity *= 1 + r
    peak = Math.max(peak, equity)
    maxDd = Math.max(maxDd, (peak - equity) / peak)
    if (r < 0) {
      streak += 1
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 0
    }
  }

  const round = (v: number) => Math.round(v * 10_000) / 100
  return {
    closedTrades: n,
    winRatePct: round(wins.length / n),
    expectancyPct: round(mean),
    avgWinPct: wins.length ? round(wins.reduce((s, r) => s + r, 0) / wins.length) : null,
    avgLossPct: losses.length ? round(losses.reduce((s, r) => s + r, 0) / losses.length) : null,
    maxDrawdownPct: round(maxDd),
    longestLossStreak: longestStreak,
  }
}

/** Threshold-derived maturity recommendation — pure, no discretion. */
export async function recommendMaturity(core: ScorecardCore, promotionReady: boolean): Promise<string> {
  if (promotionReady) return 'promote to live_candidate — all promotion gates pass'
  if (core.closedTrades < 30) {
    return `continue paper_trading — ${core.closedTrades}/30 closed trades (insufficient sample)`
  }
  if ((core.expectancyPct ?? 0) <= 0) {
    return 'keep in paper_trading and review — negative expectancy after modeled costs'
  }
  if ((core.maxDrawdownPct ?? 0) > 15) {
    return 'keep in paper_trading at reduced size — drawdown above the 15% gate'
  }
  return 'continue paper_trading — positive expectancy, waiting on remaining promotion gates'
}

// ─── Loader ───────────────────────────────────────────────────────────────────

interface PositionRow {
  strategy_key: string
  asset_class: string
  closed_at: string | null
  realized_pnl_pct: number | null
}

interface TradeRow {
  strategy_key: string
  slippage_bps: number | null
}

interface AuditRow {
  strategy_key: string | null
  metadata: { blocked_by?: string } | null
}

interface ShadowRow {
  strategy_key: string
  realized_pnl_pct: number | null
  status: string
}

export async function getPaperScorecards(): Promise<PaperScorecard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const [positions, trades, audits, shadows] = await Promise.all([
    supabase
      .from('paper_positions')
      .select('strategy_key, asset_class, closed_at, realized_pnl_pct')
      .eq('user_id', user.id)
      .eq('status', 'closed')
      .limit(5000)
      .then(r => (r.data ?? []) as PositionRow[]),
    supabase
      .from('paper_trades')
      .select('strategy_key, slippage_bps')
      .eq('user_id', user.id)
      .limit(5000)
      .then(r => (r.data ?? []) as TradeRow[]),
    supabase
      .from('audit_logs')
      .select('strategy_key, metadata')
      .eq('user_id', user.id)
      .eq('decision', 'block')
      .limit(5000)
      .then(r => (r.data ?? []) as AuditRow[], () => [] as AuditRow[]),
    supabase
      .from('shadow_positions')
      .select('strategy_key, realized_pnl_pct, status')
      .eq('user_id', user.id)
      .eq('status', 'closed')
      .limit(5000)
      .then(r => (r.data ?? []) as ShadowRow[], () => [] as ShadowRow[]),
  ])

  const byStrategy = new Map<string, { assetClass: string; trades: ClosedTrade[] }>()
  for (const p of positions) {
    if (!p.closed_at || p.realized_pnl_pct == null) continue
    const entry = byStrategy.get(p.strategy_key) ?? { assetClass: p.asset_class, trades: [] }
    entry.trades.push({ closedAt: p.closed_at, returnPct: p.realized_pnl_pct })
    byStrategy.set(p.strategy_key, entry)
  }

  const slippageByStrategy = new Map<string, number[]>()
  for (const t of trades) {
    if (t.slippage_bps == null) continue
    const list = slippageByStrategy.get(t.strategy_key) ?? []
    list.push(t.slippage_bps)
    slippageByStrategy.set(t.strategy_key, list)
  }

  const blockedByStrategy = new Map<string, { blocked: number; vetoes: number }>()
  for (const a of audits) {
    if (!a.strategy_key) continue
    const entry = blockedByStrategy.get(a.strategy_key) ?? { blocked: 0, vetoes: 0 }
    entry.blocked += 1
    const blockedBy = a.metadata?.blocked_by ?? ''
    if (blockedBy.includes('risk') || blockedBy.includes('empirical_sizing') || blockedBy.includes('kill')) {
      entry.vetoes += 1
    }
    blockedByStrategy.set(a.strategy_key, entry)
  }

  const shadowByStrategy = new Map<string, number[]>()
  for (const s of shadows) {
    if (s.realized_pnl_pct == null) continue
    const list = shadowByStrategy.get(s.strategy_key) ?? []
    list.push(s.realized_pnl_pct)
    shadowByStrategy.set(s.strategy_key, list)
  }

  const out: PaperScorecard[] = []
  for (const [strategyKey, { assetClass, trades: closed }] of byStrategy) {
    const core = await computeScorecardCore(closed)
    const brier = await getRollingBrier(supabase, strategyKey).catch(() => null)
    const shadowRets = shadowByStrategy.get(strategyKey) ?? []
    const promotion = evaluatePaperToLive(
      strategyKey,
      {
        closedTrades: core.closedTrades,
        avgReturnPct: core.expectancyPct != null ? core.expectancyPct / 100 : null,
        maxDrawdownPct: core.maxDrawdownPct != null ? core.maxDrawdownPct / 100 : null,
        assetClass,
      },
      brier?.brierScore ?? null,
      {
        shadowAvgReturnPct: shadowRets.length
          ? shadowRets.reduce((s, r) => s + r, 0) / shadowRets.length
          : null,
        closedShadowTrades: shadowRets.length,
      }
    )

    const slips = slippageByStrategy.get(strategyKey) ?? []
    const counters = blockedByStrategy.get(strategyKey) ?? { blocked: 0, vetoes: 0 }

    out.push({
      strategyKey,
      assetClass,
      ...core,
      meanSlippageBps: slips.length
        ? Math.round((slips.reduce((s, v) => s + v, 0) / slips.length) * 100) / 100
        : null,
      // PaperBroker's model assumption is what it recorded per fill — until a
      // real broker provides actual fills, recorded == model by construction.
      modelSlippageBps: slips.length
        ? Math.round((slips.reduce((s, v) => s + v, 0) / slips.length) * 100) / 100
        : null,
      blockedCount: counters.blocked,
      riskVetoCount: counters.vetoes,
      promotion,
      maturityRecommendation: await recommendMaturity(core, promotion.ready),
    })
  }

  return out.sort((a, b) => (b.expectancyPct ?? -Infinity) - (a.expectancyPct ?? -Infinity))
}
