'use client'

/**
 * Income-Growth pillar (P3). The QUANTIFIED header (income-vs-allocation from
 * the real Monte Carlo) ranks first; the COACHING idea cards render below with
 * the "Coaching — not calculated advice" badge and the ease/speed/investment/
 * profit/scalability classification.
 */

import { TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IncomeGrowthView } from '@/lib/actions/income-growth'
import type { IncomeIdea } from '@/lib/advisory/rules/r9-income-growth'

const TAG = (label: string, value: string) => (
  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-gray-400">{label}: {value}</span>
)

function IdeaCard({ idea }: { idea: IncomeIdea }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-white">{idea.title}</h4>
        <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-400">
          Coaching — not calculated advice
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{idea.description}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {TAG('ease', idea.ease)}
        {TAG('speed', idea.speed)}
        {TAG('investment', idea.requiredInvestment)}
        {TAG('potential', idea.profitPotential)}
        {TAG('scale', idea.scalability)}
      </div>
    </div>
  )
}

export function IncomeGrowthPanel({ view }: { view: IncomeGrowthView }) {
  if (!view.triggered && view.ideas.length === 0) return null

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <TrendingUp className="h-3.5 w-3.5" /> Income growth
        </h2>
        <span className="text-[10px] text-gray-600">the earning lever</span>
      </div>

      {view.error && <p className="mb-2 text-[11px] text-amber-400">{view.error}</p>}
      {view.reason && <p className="mb-3 text-[11px] text-gray-400">{view.reason}</p>}

      {/* QUANTIFIED header — real Monte Carlo, numbers allowed */}
      {view.comparison && (
        <div className={cn('mb-3 rounded-lg border p-3',
          view.comparison.incomeWins ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-white/10 bg-white/[0.02]')}>
          <p className="text-[11px] leading-relaxed text-gray-200">{view.comparison.headline}</p>
          <div className="mt-2 flex gap-4 text-[10px] text-gray-500">
            <span>Income lift: <span className="tabular-nums text-emerald-400">+{view.comparison.incomeDeltaPct} pts</span></span>
            <span>Best allocation: <span className="tabular-nums text-gray-300">+{view.comparison.allocationDeltaPct} pts</span></span>
          </div>
          <p className="mt-1.5 text-[9px] text-gray-600">
            ΔP(goal) from the block-bootstrap Monte Carlo. The income figure is illustrative — it changes your
            plan only if you record it as a real income change in your profile.
          </p>
        </div>
      )}

      {/* COACHING idea cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {view.ideas.map(idea => <IdeaCard key={idea.category} idea={idea} />)}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-gray-600">{view.disclaimer}</p>
    </section>
  )
}
