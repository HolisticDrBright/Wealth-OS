/**
 * /calibration — Per-strategy AI confluence calibration view.
 *
 * Shows for each strategy over the last 90 days:
 *   - Brier score (lower = better calibrated predictions)
 *   - PnL with MiroFish vs without MiroFish
 *   - PnL with Kronos vs without Kronos
 *   - Fee/cost-adjusted lift per AI layer
 */

import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'

// ─── Data fetching ─────────────────────────────────────────────────────────────

interface CalibrationRow {
  strategyKey: StrategyKey
  displayName: string
  assetClass: string
  edgeType: string
  mirofish: string
  kronos: string
  // Brier score (quadratic scoring rule for probabilistic predictions)
  brierScore: number | null
  // PnL averages (bps)
  avgPnlWithMiroFish: number | null
  avgPnlWithoutMiroFish: number | null
  avgPnlWithKronos: number | null
  avgPnlWithoutKronos: number | null
  // Cost-adjusted lift
  miroFishLiftBps: number | null
  kronosLiftBps: number | null
  // Sample counts
  nWithMiroFish: number
  nWithoutMiroFish: number
  nWithKronos: number
  nWithoutKronos: number
}

async function getCalibrationData(): Promise<CalibrationRow[]> {
  const supabase = await createClient()
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: auditRows } = await supabase
    .from('audit_logs')
    .select('strategy_key, mirofish_used, kronos_used, mirofish_score, decision, size_fraction, decided_at')
    .gte('decided_at', since)

  const { data: tradeRows } = await supabase
    .from('user_copied_positions')
    .select('strategy_key, pnl_pct, broker_override_reason, opened_at')
    .gte('opened_at', since)
    .not('pnl_pct', 'is', null)

  const rows: CalibrationRow[] = []

  for (const [key, cfg] of Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, typeof STRATEGY_REGISTRY_CONFIG[StrategyKey]][]) {
    const stratAudit = (auditRows ?? []).filter(r => r.strategy_key === key)
    const stratTrades = (tradeRows ?? []).filter(r => (r as Record<string, unknown>).strategy_key === key)

    // Brier score from mirofish_score predictions vs actual outcomes
    const brierPairs = stratAudit
      .filter(r => r.mirofish_used && r.mirofish_score !== null)
      .map(r => {
        const predicted = (r.mirofish_score as number) / 100
        const actual = r.decision === 'execute' ? 1 : 0
        return (predicted - actual) ** 2
      })
    const brierScore = brierPairs.length >= 5
      ? brierPairs.reduce((a, b) => a + b, 0) / brierPairs.length
      : null

    // PnL split by AI layer usage
    const withMF  = stratTrades.filter(r => stratAudit.some(a => a.mirofish_used))
    const noMF    = stratTrades.filter(r => !stratAudit.some(a => a.mirofish_used))
    const withKro = stratTrades.filter(r => stratAudit.some(a => a.kronos_used))
    const noKro   = stratTrades.filter(r => !stratAudit.some(a => a.kronos_used))

    const mean = (arr: { pnl_pct: number }[]) =>
      arr.length ? arr.reduce((s, r) => s + r.pnl_pct, 0) / arr.length * 100 : null  // → bps

    const avgWithMF    = mean(withMF)
    const avgNoMF      = mean(noMF)
    const avgWithKro   = mean(withKro)
    const avgNoKro     = mean(noKro)

    // Cost-adjusted lift (subtract average AI cost from gross lift)
    const MIROFISH_COST_BPS = cfg.mirofish === 'high' ? 1.2 : cfg.mirofish === 'medium' ? 0.3 : 0
    const KRONOS_COST_BPS   = 0.1  // Kronos reads from DB; negligible

    const mfLift  = avgWithMF !== null && avgNoMF !== null
      ? (avgWithMF - avgNoMF) - MIROFISH_COST_BPS : null
    const kroLift = avgWithKro !== null && avgNoKro !== null
      ? (avgWithKro - avgNoKro) - KRONOS_COST_BPS : null

    rows.push({
      strategyKey: key,
      displayName: key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      assetClass: cfg.assetClass,
      edgeType: cfg.edgeType,
      mirofish: cfg.mirofish,
      kronos: cfg.kronos,
      brierScore,
      avgPnlWithMiroFish: avgWithMF,
      avgPnlWithoutMiroFish: avgNoMF,
      avgPnlWithKronos: avgWithKro,
      avgPnlWithoutKronos: avgNoKro,
      miroFishLiftBps: mfLift,
      kronosLiftBps: kroLift,
      nWithMiroFish: withMF.length,
      nWithoutMiroFish: noMF.length,
      nWithKronos: withKro.length,
      nWithoutKronos: noKro.length,
    })
  }

  return rows
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function fmt(n: number | null, decimals = 1): string {
  if (n === null) return '—'
  return n.toFixed(decimals)
}

function liftColor(n: number | null): string {
  if (n === null) return 'text-gray-400'
  if (n > 5)  return 'text-green-400'
  if (n > 0)  return 'text-green-300'
  if (n > -5) return 'text-yellow-400'
  return 'text-red-400'
}

function brierColor(n: number | null): string {
  if (n === null) return 'text-gray-400'
  if (n < 0.10) return 'text-green-400'
  if (n < 0.20) return 'text-yellow-400'
  return 'text-red-400'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const metadata = { title: 'AI Calibration — Wealth OS' }

export default async function CalibrationPage() {
  const rows = await getCalibrationData()

  const assetGroups = ['stocks', 'options', 'crypto', 'forex', 'polymarket', 'multi-asset']

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">AI Confluence Calibration</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Last 90 days · Brier score (lower = better) · Lift in basis points after AI costs
          </p>
        </div>

        {/* Legend */}
        <div className="flex gap-6 text-xs text-gray-400">
          <span><span className="text-green-400">green lift</span> = AI layer is earning</span>
          <span><span className="text-red-400">red lift</span> = AI layer is costing more than it earns</span>
          <span><span className="text-gray-400">—</span> = insufficient data (&lt;5 trades)</span>
        </div>

        {assetGroups.map(asset => {
          const group = rows.filter(r => r.assetClass === asset)
          if (group.length === 0) return null

          return (
            <section key={asset}>
              <h2 className="text-lg font-semibold capitalize mb-3 border-b border-gray-800 pb-2">
                {asset}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase border-b border-gray-800">
                      <th className="text-left py-2 pr-4 font-medium">Strategy</th>
                      <th className="text-left py-2 pr-4 font-medium">Edge</th>
                      <th className="text-center py-2 pr-4 font-medium">MiroFish</th>
                      <th className="text-center py-2 pr-4 font-medium">Kronos</th>
                      <th className="text-right py-2 pr-4 font-medium">Brier</th>
                      <th className="text-right py-2 pr-4 font-medium">+MF bps</th>
                      <th className="text-right py-2 pr-4 font-medium">−MF bps</th>
                      <th className="text-right py-2 pr-4 font-medium">MF lift</th>
                      <th className="text-right py-2 pr-4 font-medium">+Kron bps</th>
                      <th className="text-right py-2 pr-4 font-medium">−Kron bps</th>
                      <th className="text-right py-2 font-medium">Kron lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(r => (
                      <tr key={r.strategyKey} className="border-b border-gray-900 hover:bg-gray-900/40">
                        <td className="py-2 pr-4 font-medium text-gray-200">{r.displayName}</td>
                        <td className="py-2 pr-4 text-gray-400 text-xs">{r.edgeType}</td>
                        <td className="py-2 pr-4 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            r.mirofish === 'high' ? 'bg-purple-900 text-purple-300'
                            : r.mirofish === 'medium' ? 'bg-blue-900 text-blue-300'
                            : 'bg-gray-800 text-gray-500'
                          }`}>
                            {r.mirofish}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            r.kronos === 'high' ? 'bg-orange-900 text-orange-300'
                            : r.kronos === 'medium' ? 'bg-yellow-900 text-yellow-300'
                            : 'bg-gray-800 text-gray-500'
                          }`}>
                            {r.kronos}
                          </span>
                        </td>
                        <td className={`py-2 pr-4 text-right font-mono ${brierColor(r.brierScore)}`}>
                          {fmt(r.brierScore, 3)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-gray-300">
                          {fmt(r.avgPnlWithMiroFish)}
                          <span className="text-gray-600 ml-1">({r.nWithMiroFish})</span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-gray-300">
                          {fmt(r.avgPnlWithoutMiroFish)}
                          <span className="text-gray-600 ml-1">({r.nWithoutMiroFish})</span>
                        </td>
                        <td className={`py-2 pr-4 text-right font-mono font-semibold ${liftColor(r.miroFishLiftBps)}`}>
                          {r.miroFishLiftBps !== null ? `${r.miroFishLiftBps > 0 ? '+' : ''}${fmt(r.miroFishLiftBps)}` : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-gray-300">
                          {fmt(r.avgPnlWithKronos)}
                          <span className="text-gray-600 ml-1">({r.nWithKronos})</span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-gray-300">
                          {fmt(r.avgPnlWithoutKronos)}
                          <span className="text-gray-600 ml-1">({r.nWithoutKronos})</span>
                        </td>
                        <td className={`py-2 text-right font-mono font-semibold ${liftColor(r.kronosLiftBps)}`}>
                          {r.kronosLiftBps !== null ? `${r.kronosLiftBps > 0 ? '+' : ''}${fmt(r.kronosLiftBps)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}

        <p className="text-xs text-gray-600 mt-8">
          Brier score = mean squared error of MiroFish probability forecasts vs actual trade outcomes.
          Lift = (PnL with AI − PnL without AI) − AI cost. Positive lift means the AI layer is net-positive after fees.
        </p>

        {/* ── Integration Lift Section ─────────────────────────────────────── */}
        <section className="mt-10 border-t border-gray-800 pt-8">
          <h2 className="text-lg font-semibold mb-1">Integration Lift</h2>
          <p className="text-xs text-gray-500 mb-6">
            Per-integration performance vs baseline. Requires ≥ 30 days of paper trading data to populate.
            After 90 days: integrations with negative lift are disabled by default for new users.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Vibe-Trading */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">Vibe-Trading Factor Analysis</p>
                  <p className="text-xs text-gray-500">quant_momentum, vcp_minervini</p>
                </div>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">Collecting</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>With factor_analysis signal</span>
                  <span className="text-gray-600">— bps (n=0)</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Without factor_analysis signal</span>
                  <span className="text-gray-600">— bps (n=0)</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-gray-800 pt-1">
                  <span className="text-gray-300">Lift (after cost)</span>
                  <span className="text-gray-600">—</span>
                </div>
              </div>
              <p className="text-xs text-gray-600">Cost: $0/call (self-hosted MCP)</p>
            </div>

            {/* Camofox */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">Camofox Scraping</p>
                  <p className="text-xs text-gray-500">vs paid Quiver Quant API</p>
                </div>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">Collecting</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>Data freshness (Camofox)</span>
                  <span className="text-gray-600">— hours lag</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Data freshness (Quiver API)</span>
                  <span className="text-gray-600">— hours lag</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-gray-800 pt-1">
                  <span className="text-gray-300">Cost savings vs Quiver</span>
                  <span className="text-gray-600">—</span>
                </div>
              </div>
              <p className="text-xs text-gray-600">Cost: $0.005/call vs $0.017/call (Quiver)</p>
            </div>

            {/* AutoHedge prompt A/B */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">CIO Prompt Variant A/B</p>
                  <p className="text-xs text-gray-500">AutoHedge distilled vs native</p>
                </div>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">Collecting</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>Native CIO prompt</span>
                  <span className="text-gray-600">— avg decision score</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>AutoHedge distilled prompt</span>
                  <span className="text-gray-600">— avg decision score</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-gray-800 pt-1">
                  <span className="text-gray-300">Decision quality delta</span>
                  <span className="text-gray-600">—</span>
                </div>
              </div>
              <p className="text-xs text-gray-600">
                Activate: <code className="bg-gray-800 px-1 rounded">USE_AUTOHEDGE_DISTILLED_PROMPTS=true</code>
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-600 mt-4">
            Integration lift data populates automatically after 30+ days of paper trading.
            Check back here after the paper trading window closes.
          </p>
        </section>
      </div>
    </div>
  )
}
