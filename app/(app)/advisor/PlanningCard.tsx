'use client'

/**
 * Household plan card (Gap brief C3): headline P(goal) with funded-ratio
 * BANDS (never a single line) and per-recommendation ΔP(goal) chips.
 */

import { Landmark } from 'lucide-react'
import type { PlanningView } from '@/lib/actions/planning'

export function PlanningCard({ view }: { view: PlanningView | null }) {
  if (!view) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Landmark className="h-4 w-4 text-indigo-400" /> Household plan
        </h3>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-emerald-400">
            {view.goalProbabilityPct.toFixed(0)}%
          </div>
          <div className="text-[10px] uppercase tracking-wide text-gray-600">
            P(retirement funded) · {view.paths.toLocaleString()} paths
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {([['p10 funded ratio', view.fundedRatioP10], ['median', view.fundedRatioP50], ['p90', view.fundedRatioP90]] as const).map(([label, v]) => (
          <div key={label} className="rounded-lg bg-white/[0.03] p-2">
            <div className="text-sm font-bold tabular-nums text-gray-200">{v.toFixed(2)}×</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
          </div>
        ))}
      </div>
      {view.deltas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {view.deltas.map(d => (
            <span key={d.ruleId} className="rounded bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
              {d.title.split('—')[0].trim()}: {d.deltaPct >= 0 ? '+' : ''}{d.deltaPct}% to your odds
            </span>
          ))}
        </div>
      )}
      <details className="mt-3 text-[11px] text-gray-500">
        <summary className="cursor-pointer text-gray-400">Assumptions</summary>
        <ul className="mt-1 space-y-0.5">{view.assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul>
      </details>
    </div>
  )
}
