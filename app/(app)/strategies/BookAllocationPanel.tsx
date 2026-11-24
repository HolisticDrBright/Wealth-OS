'use client'

/**
 * Book allocation panel — how the open paper strategy book is distributed
 * across the multi-strat books vs. each book's cap, by dollars AND by risk
 * units (notional × annualized volatility; a binary market's stake). The cap
 * binds on whichever share is higher. Plus the regime's rotation stance and
 * the Explore risk budget.
 */

import { cn } from '@/lib/utils'
import { Layers } from 'lucide-react'
import type { BookAllocationView } from '@/lib/actions/book-exposure'

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

const REGIME_TONE: Record<string, string> = {
  RISK_ON: 'text-emerald-400',
  NEUTRAL: 'text-text-1',
  RISK_OFF: 'text-amber-400',
  CRISIS: 'text-red-400',
}

export function BookAllocationPanel({ data }: { data: BookAllocationView }) {
  return (
    <div className="rounded-xl border border-line-strong bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-200">Risk Books</h3>
          <span className="text-xs text-text-1">
            ${Math.round(data.totalNotionalUsd).toLocaleString()} open notional · {Math.round(data.totalRiskUnits).toLocaleString()} risk units
          </span>
        </div>
        <span className={cn('text-xs font-medium', REGIME_TONE[data.regime] ?? 'text-text-1')}>
          {data.regime.replace('_', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {data.books.map(b => {
          const overCap = b.utilization >= 1
          const nearCap = b.utilization >= 0.8 && !overCap
          const cut = b.regimeMultiplier < 1
          return (
            <div key={b.book} className="rounded-lg border border-line-strong bg-white/[0.02] p-3" title={b.blurb}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-300">{b.label}</p>
                {cut && (
                  <span className={cn(
                    'text-xs font-medium',
                    b.regimeMultiplier === 0 ? 'text-red-400' : 'text-amber-400',
                  )}>
                    {b.regimeMultiplier === 0 ? 'closed' : `×${b.regimeMultiplier}`}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm font-semibold tabular-nums text-gray-200">
                {pct(b.share)}
                <span className="ml-1 text-xs font-normal text-text-1">$ · </span>
                {pct(b.riskShare)}
                <span className="ml-1 text-xs font-normal text-text-1">risk</span>
              </p>
              <p className="text-xs text-text-1">cap {pct(b.capShare)} on each</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    overCap ? 'bg-red-500' : nearCap ? 'bg-amber-500' : 'bg-indigo-500',
                  )}
                  style={{ width: `${Math.min(100, Math.round(b.utilization * 100))}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {data.exploreRiskBudget != null && (
        <p className="mt-3 text-xs leading-relaxed text-text-1">
          Explore risk budget: {Math.round(data.exploreRiskBudget).toLocaleString()} risk units
          (your Explore limit × {Math.round(data.referenceVol * 100)}% reference volatility). One position may use at most{' '}
          {Math.round(data.positionRiskCeiling ?? 0).toLocaleString()} of them. Risk units = position size × its annualized
          volatility; for prediction markets, the stake.
        </p>
      )}
    </div>
  )
}
