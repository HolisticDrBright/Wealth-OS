'use client'

/**
 * Strategy Leaderboard (UI brief widget 5) — FreqUI metric set per strategy:
 * net-of-cost expectancy, annualized return, Sortino, Calmar, SQN, max DD,
 * trade count. Promotion-gate progress lives in the PromotionPipelinePanel
 * below; this is the raw performance table.
 */

import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StrategyMetrics } from '@/lib/actions/strategy-metrics'

type SortKey = keyof Pick<StrategyMetrics, 'netExpectancyPct' | 'annualizedPct' | 'sortino' | 'calmar' | 'sqn' | 'maxDrawdownPct' | 'trades'>

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: 'netExpectancyPct', label: 'EXP%', title: 'Net expectancy per trade (after modeled costs)' },
  { key: 'annualizedPct', label: 'ANN%', title: 'Annualized (expectancy × trades/yr) — approximation' },
  { key: 'sortino', label: 'SORTINO', title: 'Mean / downside deviation, annualized' },
  { key: 'calmar', label: 'CALMAR', title: 'Annualized return / max drawdown' },
  { key: 'sqn', label: 'SQN', title: 'System Quality Number: (mean/std)×√n' },
  { key: 'maxDrawdownPct', label: 'MAXDD%', title: 'Max drawdown of the per-trade equity curve' },
  { key: 'trades', label: 'N', title: 'Closed trades' },
]

function cell(v: number | null, invert = false): { text: string; cls: string } {
  if (v == null) return { text: '—', cls: 'text-gray-600' }
  const good = invert ? v <= 10 : v > 0
  return {
    text: v.toFixed(2),
    cls: good ? 'text-emerald-400' : invert && v > 20 ? 'text-red-400' : v < 0 ? 'text-red-400' : 'text-gray-300',
  }
}

export function LeaderboardPanel({ metrics }: { metrics: StrategyMetrics[] }) {
  const [sortBy, setSortBy] = useState<SortKey>('netExpectancyPct')
  if (metrics.length === 0) return null

  const sorted = [...metrics].sort((a, b) => ((b[sortBy] ?? -Infinity) as number) - ((a[sortBy] ?? -Infinity) as number))

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Trophy className="h-4 w-4 text-amber-400" /> Strategy Leaderboard
        <span className="text-[10px] font-normal text-gray-600">closed paper trades, net of modeled costs</span>
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600">
              <th className="pb-1.5 pr-3">Strategy</th>
              {COLUMNS.map(c => (
                <th key={c.key} title={c.title} className="pb-1.5 pr-3">
                  <button
                    onClick={() => setSortBy(c.key)}
                    className={cn('hover:text-gray-300', sortBy === c.key && 'text-indigo-400')}
                  >
                    {c.label}{sortBy === c.key ? ' ↓' : ''}
                  </button>
                </th>
              ))}
              <th className="pb-1.5">WIN%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(m => (
              <tr key={m.strategyKey} className="border-t border-white/5">
                <td className="py-1 pr-3 text-gray-200">{m.strategyKey}</td>
                {COLUMNS.map(c => {
                  const { text, cls } = cell(m[c.key] as number | null, c.key === 'maxDrawdownPct')
                  return <td key={c.key} className={cn('py-1 pr-3 tabular-nums', cls)}>{text}</td>
                })}
                <td className="py-1 tabular-nums text-gray-400">{m.winRatePct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
