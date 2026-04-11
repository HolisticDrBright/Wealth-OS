import { getRiskControls, getRiskSummary } from '@/lib/actions/risk'
import { getSimulationJobs } from '@/lib/actions/simulations'
import { RiskClient } from './risk-client'
import { createClient } from '@/lib/supabase/server'
import { computeRiskMetrics, type PositionInput } from '@/lib/risk-engine'
import { getBarsForSymbols, getBars } from '@/lib/market-data'

export default async function RiskPage() {
  const [controls, summary, jobs] = await Promise.all([
    getRiskControls(),
    getRiskSummary(),
    getSimulationJobs(),
  ])

  // Fetch real risk metrics from the engine
  let realMetrics = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: assets } = await supabase.from('assets').select('*').eq('user_id', user.id)
      if (assets?.length) {
        const total = assets.reduce((s, a) => s + (a.current_value ?? 0), 0)
        const positions: PositionInput[] = assets
          .filter(a => (a.current_value ?? 0) > 0)
          .map(a => ({
            symbol: a.symbol ?? a.name,
            marketValue: a.current_value,
            weight: total > 0 ? a.current_value / total : 0,
          }))
        const symbols = positions.map(p => p.symbol).filter(Boolean)
        const end = new Date().toISOString().slice(0, 10)
        const start = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10)
        const [bars, benchBars] = await Promise.all([
          getBarsForSymbols(symbols, start, end),
          getBars('SPY', start, end),
        ])
        realMetrics = computeRiskMetrics(positions, bars, benchBars)
      }
    }
  } catch { /* non-critical — page still renders without */ }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Risk Management</h1>
        <p className="text-sm text-gray-500 mt-1">Live exposure, controls, and scenario simulations</p>
      </div>
      <RiskClient
        initialControls={controls}
        summary={summary}
        initialJobs={jobs}
        realMetrics={realMetrics}
      />
    </div>
  )
}
