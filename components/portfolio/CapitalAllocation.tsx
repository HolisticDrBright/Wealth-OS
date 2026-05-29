/**
 * CapitalAllocation — compact current-vs-recommended allocation panel.
 *
 * Presentational only: the parent computes slices from real portfolio/risk-profile
 * data. When live balances are unavailable, pass `currentUnavailable` so we show
 * targets without fabricating real balances.
 */
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import { PieChart, AlertCircle } from 'lucide-react'

export interface AllocationSlice {
  key: string
  label: string
  /** Current dollar value, if known. */
  currentUsd?: number | null
  /** Current share of capital [0,100], if known. */
  currentPct?: number | null
  /** Recommended/target share [0,100], if known. */
  recommendedPct?: number | null
  /** Tailwind bg color for the slice swatch/bar. */
  color: string
}

interface Props {
  slices: AllocationSlice[]
  /** True when we have no real balances and should show targets only. */
  currentUnavailable?: boolean
  className?: string
}

export function CapitalAllocation({ slices, currentUnavailable = false, className }: Props) {
  const showCurrent = !currentUnavailable && slices.some(s => (s.currentPct ?? 0) > 0)
  const totalCurrent = slices.reduce((a, s) => a + (s.currentUsd ?? 0), 0)

  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/5 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <PieChart className="h-3.5 w-3.5" /> Capital Allocation
        </p>
        {showCurrent && totalCurrent > 0 && (
          <span className="text-xs text-gray-500">{formatCurrency(totalCurrent)} total</span>
        )}
      </div>

      {currentUnavailable && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
          <p className="text-xs text-gray-400">
            Live balances unavailable — showing recommended targets only. Connect an account to compare against your actual mix.
          </p>
        </div>
      )}

      {/* Stacked recommended bar */}
      <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-white/5">
        {slices.map(s => {
          const w = s.recommendedPct ?? 0
          if (w <= 0) return null
          return <div key={s.key} className={cn('h-full', s.color)} style={{ width: `${w}%` }} title={`${s.label} target ${w}%`} />
        })}
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {slices.map(s => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className={cn('h-2 w-2 shrink-0 rounded-sm', s.color)} />
            <span className="flex-1 truncate text-gray-300">{s.label}</span>
            {showCurrent && (
              <span className="w-14 text-right tabular-nums text-gray-400">
                {s.currentPct != null ? `${s.currentPct.toFixed(0)}%` : '—'}
              </span>
            )}
            <span className="w-16 text-right tabular-nums text-gray-500" title="Recommended target">
              {s.recommendedPct != null ? `→ ${s.recommendedPct.toFixed(0)}%` : '—'}
            </span>
          </div>
        ))}
      </div>

      {showCurrent && (
        <p className="mt-2 text-[11px] text-gray-600">Left = current share · Right = recommended target</p>
      )}
    </div>
  )
}
