/**
 * Master Backtest Report
 *
 * Aggregates per-strategy metrics from audit_logs + backtest trades.
 * Computes AI lift: (PnL with AI layer) - (PnL without AI layer) - AI cost.
 *
 * Usage:
 *   npx tsx lib/workers/backtest/master-report.ts
 *
 * Prints a master report table and the audit log SQL query confirming:
 *   - edge_type, mirofish_used, kronos_used, broker per trade
 */

import { createClient } from '@supabase/supabase-js'
import type { StrategyBacktestResult } from './tier1-runner'

// ─── Audit log query ──────────────────────────────────────────────────────────

/**
 * SQL query to confirm each Tier 1 trade tags the correct
 * edge_type, mirofish_used, kronos_used, and routed broker.
 *
 * Run in Supabase SQL editor or via psql.
 */
export const AUDIT_VERIFICATION_QUERY = `
-- Audit log verification: Tier 1 strategy attribution
SELECT
  a.strategy_key,
  a.edge_type,
  a.mirofish_used,
  a.kronos_used,
  a.decision,
  a.size_fraction,
  a.decided_at,
  COUNT(*) AS trade_count,
  AVG(p.pnl_pct) * 100 AS avg_pnl_pct,
  SUM(CASE WHEN a.mirofish_used THEN 1 ELSE 0 END) AS with_mirofish,
  SUM(CASE WHEN a.kronos_used THEN 1 ELSE 0 END) AS with_kronos
FROM audit_logs a
LEFT JOIN user_copied_positions p
  ON p.strategy_key = a.strategy_key
  AND p.opened_at >= a.decided_at
  AND p.opened_at < a.decided_at + INTERVAL '1 hour'
WHERE a.strategy_key IN (
  'polymarket_wallet_copy',
  'polymarket_info_lag',
  'autopilot_congressional',
  'dca_halving',
  'funding_basis_arb'
)
AND a.decided_at >= NOW() - INTERVAL '90 days'
GROUP BY
  a.strategy_key,
  a.edge_type,
  a.mirofish_used,
  a.kronos_used,
  a.decision,
  a.size_fraction,
  a.decided_at
ORDER BY a.decided_at DESC
LIMIT 200;
`.trim()

// ─── Expected strategy config ─────────────────────────────────────────────────

interface StrategyExpectation {
  edgeType: string
  mirofishShouldBeUsed: boolean   // false for skip, true for medium/high
  kronosShouldBeUsed: boolean
  expectedBroker: string
}

export const TIER1_EXPECTATIONS: Record<string, StrategyExpectation> = {
  polymarket_wallet_copy: {
    edgeType: 'flow',
    mirofishShouldBeUsed: true,
    kronosShouldBeUsed: false,   // kronos=skip
    expectedBroker: 'polymarket',
  },
  polymarket_info_lag: {
    edgeType: 'information',
    mirofishShouldBeUsed: true,
    kronosShouldBeUsed: false,
    expectedBroker: 'polymarket',
  },
  autopilot_congressional: {
    edgeType: 'flow',
    mirofishShouldBeUsed: true,   // medium
    kronosShouldBeUsed: false,    // skip
    expectedBroker: 'alpaca',
  },
  dca_halving: {
    edgeType: 'onchain',
    mirofishShouldBeUsed: true,   // medium
    kronosShouldBeUsed: true,     // medium
    expectedBroker: 'coinbase',
  },
  funding_basis_arb: {
    edgeType: 'structural',
    mirofishShouldBeUsed: false,  // skip
    kronosShouldBeUsed: false,    // skip
    expectedBroker: 'coinbase+binance_us',
  },
}

// ─── AI lift calculator ───────────────────────────────────────────────────────

interface AuditRow {
  strategy_key: string
  mirofish_used: boolean
  kronos_used: boolean
  mirofish_score: number | null
  pnl_pct: number | null
}

function computeAiLift(rows: AuditRow[]): {
  mfLiftBps: number | null
  kronosLiftBps: number | null
} {
  const MIROFISH_COST_BPS = 1.2   // ~$0.12 per call at $10k position
  const KRONOS_COST_BPS   = 0.1

  const withMF  = rows.filter(r => r.mirofish_used && r.pnl_pct !== null)
  const noMF    = rows.filter(r => !r.mirofish_used && r.pnl_pct !== null)
  const withKro = rows.filter(r => r.kronos_used && r.pnl_pct !== null)
  const noKro   = rows.filter(r => !r.kronos_used && r.pnl_pct !== null)

  const mean = (arr: AuditRow[]) =>
    arr.length > 0 ? arr.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / arr.length * 100 : null

  const avgWithMF  = mean(withMF)
  const avgNoMF    = mean(noMF)
  const avgWithKro = mean(withKro)
  const avgNoKro   = mean(noKro)

  const mfLiftBps   = avgWithMF !== null && avgNoMF !== null
    ? (avgWithMF - avgNoMF) - MIROFISH_COST_BPS : null
  const kronosLiftBps = avgWithKro !== null && avgNoKro !== null
    ? (avgWithKro - avgNoKro) - KRONOS_COST_BPS : null

  return { mfLiftBps, kronosLiftBps }
}

// ─── Master report ────────────────────────────────────────────────────────────

export async function generateMasterReport(backtestResults?: StrategyBacktestResult[]): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  )

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: auditRows } = await supabase
    .from('audit_logs')
    .select('strategy_key, mirofish_used, kronos_used, mirofish_score, decision, decided_at')
    .gte('decided_at', since)
    .in('strategy_key', Object.keys(TIER1_EXPECTATIONS))

  const { data: tradeRows } = await supabase
    .from('user_copied_positions')
    .select('strategy_key, pnl_pct, opened_at')
    .gte('opened_at', since)
    .not('pnl_pct', 'is', null)
    .in('strategy_key', Object.keys(TIER1_EXPECTATIONS))

  console.log('\n═══ TIER 1 MASTER BACKTEST REPORT ═══\n')
  console.log('Strategy              | Trades | Win%  | Avg Ret | Max DD | MF Lift | Kron Lift | AI Lift')
  console.log('──────────────────────|────────|───────|─────────|────────|─────────|───────────|────────')

  for (const [key, expectation] of Object.entries(TIER1_EXPECTATIONS)) {
    const stratAudit = (auditRows ?? []).filter(r => r.strategy_key === key)
    const stratTrades = (tradeRows ?? []).filter(r => (r as Record<string, unknown>).strategy_key === key)
    const auditWithPnl: AuditRow[] = stratAudit.map(a => ({
      ...a,
      pnl_pct: stratTrades.find(t => t.strategy_key === key)?.pnl_pct ?? null,
    }))

    const { mfLiftBps, kronosLiftBps } = computeAiLift(auditWithPnl)
    const backtest = backtestResults?.find(r => r.strategyKey === key)

    const trades  = backtest?.totalTrades ?? stratAudit.length
    const winPct  = backtest ? (backtest.winRate * 100).toFixed(0) + '%' : '—'
    const avgRet  = backtest ? (backtest.avgReturn * 100).toFixed(2) + '%' : '—'
    const maxDD   = backtest ? (backtest.maxDrawdown * 100).toFixed(1) + '%' : '—'
    const mfStr   = mfLiftBps !== null ? (mfLiftBps > 0 ? '+' : '') + mfLiftBps.toFixed(1) + 'bp' : '—'
    const kroStr  = kronosLiftBps !== null ? (kronosLiftBps > 0 ? '+' : '') + kronosLiftBps.toFixed(1) + 'bp' : '—'
    const totalLift = (mfLiftBps ?? 0) + (kronosLiftBps ?? 0)
    const liftStr = mfLiftBps !== null || kronosLiftBps !== null
      ? (totalLift > 0 ? '+' : '') + totalLift.toFixed(1) + 'bp' : '—'

    const name = key.replace(/_/g, ' ').padEnd(21)
    console.log(`${name} | ${String(trades).padStart(6)} | ${winPct.padStart(5)} | ${avgRet.padStart(7)} | ${maxDD.padStart(6)} | ${mfStr.padStart(7)} | ${kroStr.padStart(9)} | ${liftStr.padStart(7)}`)

    // Validate attribution
    const wrongEdge = stratAudit.some(r => (r as Record<string, unknown>).edge_type !== expectation.edgeType)
    const wrongMF   = stratAudit.some(r => r.mirofish_used !== expectation.mirofishShouldBeUsed)
    if (wrongEdge) console.warn(`  ⚠ edge_type mismatch for ${key} (expected ${expectation.edgeType})`)
    if (wrongMF)   console.warn(`  ⚠ mirofish_used mismatch for ${key}`)
  }

  console.log('\n── Audit Verification SQL ──')
  console.log(AUDIT_VERIFICATION_QUERY)

  console.log('\n── Broker Expectations ──')
  for (const [key, exp] of Object.entries(TIER1_EXPECTATIONS)) {
    console.log(`  ${key}: edge=${exp.edgeType}, mf=${exp.mirofishShouldBeUsed}, kronos=${exp.kronosShouldBeUsed}, broker=${exp.expectedBroker}`)
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.endsWith('master-report.ts'))) {
  generateMasterReport().catch(console.error)
}
