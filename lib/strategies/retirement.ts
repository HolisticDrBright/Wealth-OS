/**
 * Automatic retirement (roadmap #4) — PURE. Promotion stays a manual registry
 * edit; switching a strategy OFF is automatic, because with dozens of
 * strategies some will look good by luck and then stop working.
 *
 * Weekly, per person × paper-enabled strategy, using only trades since the
 * strategy was last switched off (a re-enabled strategy starts fresh):
 *
 *   benchmark_two_quarters  the two most recent complete quarters with at least
 *                           RETIRE_MIN_TRADES_PER_QUARTER trades both trailed the
 *                           passive benchmark, NET of the round-trip fee
 *   gate_failure_streak     with at least MIN_CLOSED_TRADES closed trades, it
 *                           failed its promotion gates (after-cost expectancy
 *                           or drawdown) on RETIRE_FAIL_WEEKS reviews in a row
 *   no_evidence_deadline    enabled RETIRE_EVIDENCE_DEADLINE_DAYS and still short
 *                           of MIN_CLOSED_TRADES — it can't prove itself
 *
 * "Switched off" = paper_enabled false. Never a maturity change; nothing here
 * can increase trading.
 */

import { evaluatePaperToLive, MIN_CLOSED_TRADES } from '@/lib/strategies/promotion-gates'
import { evaluateLifecycle, quarterOf, isCompleteQuarter } from '@/lib/strategies/lifecycle'
import { computeDrawdown, type ClosedTradeRow } from '@/lib/strategies/track-record'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import { RETIRE_FAIL_WEEKS, RETIRE_EVIDENCE_DEADLINE_DAYS } from '@/lib/config/product-defaults'

export type RetireRule = 'benchmark_two_quarters' | 'gate_failure_streak' | 'no_evidence_deadline'

export interface WeeklyGateSnapshot {
  /** Monday (UTC) of the review week, yyyy-mm-dd. */
  week: string
  closedTrades: number
  /** Mean per-trade return after the fee drag (fraction); null without trades. */
  netExpectancyPct: number | null
  maxDrawdownPct: number | null
  /** true = failed a gate; false = passed; null = not judged yet (too few trades). */
  failing: boolean | null
}

export interface RetirementInput {
  strategyKey: string
  assetClass: string
  /** Closed trades SINCE the last switch-off. */
  trades: ClosedTradeRow[]
  /** Quarterly benchmark returns in %, the hold-NO baseline (0%), or null = unmeasured. */
  benchmark: Map<string, number> | 'hold_no' | null
  /** Earlier weekly snapshots since the last switch-off (any order). */
  priorSnapshots: Array<{ week: string; failing: boolean | null }>
  /** When the current evaluation window started (enabled, or last switched off). */
  windowStart: string | null
  now: Date
}

export interface RetirementVerdict {
  retire: boolean
  rule: RetireRule | null
  /** Plain-English reason (filed in the log and sent to the person). */
  reason: string
  /** Consecutive failing weekly reviews, including this one. */
  streakWeeks: number
}

/** Monday (UTC) of the week containing `d`. */
export function weekOf(d: Date): string {
  const day = d.getUTCDay()                       // 0 = Sunday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)))
  return monday.toISOString().slice(0, 10)
}

/** This week's promotion-gate check (after-cost expectancy + drawdown). */
export function weeklyGateSnapshot(i: Pick<RetirementInput, 'strategyKey' | 'assetClass' | 'trades' | 'now'>): WeeklyGateSnapshot {
  const returns = i.trades.map(t => t.realized_pnl_pct).filter((v): v is number => typeof v === 'number')
  const avg = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null
  const dd = computeDrawdown(i.trades)
  const fee = roundTripCostBps(i.assetClass) / 10_000
  const r = evaluatePaperToLive(i.strategyKey, {
    closedTrades: i.trades.length, avgReturnPct: avg, maxDrawdownPct: dd, assetClass: i.assetClass,
  }, null, { shadowAvgReturnPct: null, closedShadowTrades: 0 })
  const net = r.criteria.find(c => c.name === 'Net expectancy')!
  const draw = r.criteria.find(c => c.name === 'Drawdown')!
  const judged = i.trades.length >= MIN_CLOSED_TRADES && net.evaluable
  return {
    week: weekOf(i.now),
    closedTrades: i.trades.length,
    netExpectancyPct: avg == null ? null : avg - fee,
    maxDrawdownPct: dd,
    failing: judged ? (!net.pass || (draw.evaluable && !draw.pass)) : null,
  }
}

/** Per-quarter returns NET of the round-trip fee, in %. */
function quarterlyNet(trades: ClosedTradeRow[], assetClass: string, now: Date) {
  const fee = roundTripCostBps(assetClass) / 10_000
  const by = new Map<string, { sum: number; n: number }>()
  for (const t of trades) {
    if (!t.closed_at || t.realized_pnl_pct == null) continue
    const q = quarterOf(t.closed_at)
    if (!isCompleteQuarter(q, now)) continue
    const cur = by.get(q) ?? { sum: 0, n: 0 }
    cur.sum += (t.realized_pnl_pct - fee) * 100
    cur.n++
    by.set(q, cur)
  }
  return by
}

export function retirementVerdict(i: RetirementInput, thisWeek: WeeklyGateSnapshot = weeklyGateSnapshot(i)): RetirementVerdict {
  // Streak: this week plus the consecutive failing reviews right before it.
  const prior = i.priorSnapshots.filter(s => s.week < thisWeek.week).sort((a, b) => b.week.localeCompare(a.week))
  let streak = thisWeek.failing ? 1 : 0
  if (thisWeek.failing) for (const s of prior) { if (s.failing === true) streak++; else break }

  // 1. Benchmark, two complete quarters in a row, net of fees.
  if (i.benchmark !== null) {
    const bench = i.benchmark
    const quarters = [...quarterlyNet(i.trades, i.assetClass, i.now).entries()]
      .filter(([q]) => bench === 'hold_no' || bench.has(q))
      .map(([q, v]) => ({ quarter: q, strategyReturnPct: v.sum, benchmarkReturnPct: bench === 'hold_no' ? 0 : bench.get(q)!, trades: v.n }))
    const lc = evaluateLifecycle(i.strategyKey, quarters)
    if (lc.demote) return { retire: true, rule: 'benchmark_two_quarters', reason: lc.report, streakWeeks: streak }
  }

  // 2. Failing its gates, week after week.
  if (streak >= RETIRE_FAIL_WEEKS) {
    const net = thisWeek.netExpectancyPct
    return {
      retire: true, rule: 'gate_failure_streak', streakWeeks: streak,
      reason: `${i.strategyKey}: switched off — failed its promotion gates on ${streak} weekly reviews in a row ` +
        `(${thisWeek.closedTrades} trades; ${net == null ? 'no' : `${(net * 100).toFixed(2)}%`} per trade after costs` +
        `${thisWeek.maxDrawdownPct != null ? `, drawdown ${(thisWeek.maxDrawdownPct * 100).toFixed(1)}%` : ''}).`,
    }
  }

  // 3. Can't prove itself in time.
  if (i.windowStart && i.trades.length < MIN_CLOSED_TRADES) {
    const days = Math.floor((i.now.getTime() - new Date(i.windowStart).getTime()) / 86_400_000)
    if (days >= RETIRE_EVIDENCE_DEADLINE_DAYS) {
      return {
        retire: true, rule: 'no_evidence_deadline', streakWeeks: streak,
        reason: `${i.strategyKey}: switched off — ${i.trades.length} closed trades in ${days} days, short of the ${MIN_CLOSED_TRADES} needed to judge it.`,
      }
    }
  }

  return {
    retire: false, rule: null, streakWeeks: streak,
    reason: thisWeek.failing == null
      ? `${i.strategyKey}: not judged yet (${thisWeek.closedTrades} of ${MIN_CLOSED_TRADES} trades).`
      : thisWeek.failing
        ? `${i.strategyKey}: failing its gates — ${streak} of ${RETIRE_FAIL_WEEKS} weeks before it is switched off.`
        : `${i.strategyKey}: passing its gates.`,
  }
}
