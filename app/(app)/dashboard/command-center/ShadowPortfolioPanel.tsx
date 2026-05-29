'use client'

import Link from 'next/link'
import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import { Ghost, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { ShadowPortfolioSummary } from '@/lib/actions/shadow-portfolio'

function fmt(usd: number): string {
  const abs = Math.abs(usd)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return usd < 0 ? `−${s}` : `+${s}`
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

export function ShadowPortfolioPanel({ data }: { data: ShadowPortfolioSummary | null }) {
  const hasData = !!data && data.positions.length > 0

  const verdict = (): { label: string; tone: 'pos' | 'neg' | 'neutral' } => {
    if (!data || data.closedShadowPositions < 3) return { label: 'Collecting data…', tone: 'neutral' }
    const delta = data.totalRealPnlUsd - data.totalShadowPnlUsd
    if (Math.abs(delta) < 5) return { label: 'Gates are neutral', tone: 'neutral' }
    if (delta > 0) return { label: `Gates saving ${fmt(delta)}`, tone: 'pos' }
    return { label: `Gates costing ${fmt(-delta)}`, tone: 'neg' }
  }

  const v = verdict()
  const VIcon = v.tone === 'pos' ? TrendingUp : v.tone === 'neg' ? TrendingDown : Minus

  const right = hasData ? (
    <Link href="/shadow-portfolio" className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
      View all →
    </Link>
  ) : undefined

  return (
    <Panel icon={Ghost} title="Shadow Portfolio" right={right}>
      {!hasData ? (
        <EmptyState
          icon={Ghost}
          title="No shadow positions yet"
          hint="Shadow positions are created when CIO blocks a tradeable signal. Run paper trading to begin."
        />
      ) : (
        <div className="space-y-3">
          {/* Verdict badge */}
          <div className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2',
            v.tone === 'pos' ? 'bg-emerald-500/10'
              : v.tone === 'neg' ? 'bg-red-500/10'
              : 'bg-white/[0.03]',
          )}>
            <VIcon className={cn(
              'h-3.5 w-3.5 shrink-0',
              v.tone === 'pos' ? 'text-emerald-400' : v.tone === 'neg' ? 'text-red-400' : 'text-gray-500',
            )} />
            <span className={cn(
              'text-xs font-medium',
              v.tone === 'pos' ? 'text-emerald-400' : v.tone === 'neg' ? 'text-red-400' : 'text-gray-500',
            )}>
              {v.label}
            </span>
          </div>

          {/* P&L comparison */}
          <div className="grid grid-cols-2 divide-x divide-white/5 rounded-lg border border-white/10 bg-white/[0.02]">
            <div className="py-2.5 px-3 text-center">
              <p className={cn(
                'text-sm font-semibold tabular-nums',
                data.totalShadowPnlUsd > 0 ? 'text-emerald-400'
                  : data.totalShadowPnlUsd < 0 ? 'text-red-400'
                  : 'text-gray-600',
              )}>
                {fmt(data.totalShadowPnlUsd)}
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">Shadow (rejected)</p>
            </div>
            <div className="py-2.5 px-3 text-center">
              <p className={cn(
                'text-sm font-semibold tabular-nums',
                data.totalRealPnlUsd > 0 ? 'text-emerald-400'
                  : data.totalRealPnlUsd < 0 ? 'text-red-400'
                  : 'text-gray-600',
              )}>
                {fmt(data.totalRealPnlUsd)}
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">Real (accepted)</p>
            </div>
          </div>

          {/* Avg return row */}
          {(data.shadowAvgReturnPct != null || data.realAvgReturnPct != null) && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">Avg return per closed position</span>
              <div className="flex gap-3 tabular-nums">
                <span className={cn(data.shadowAvgReturnPct != null && data.shadowAvgReturnPct > 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {pct(data.shadowAvgReturnPct)} shadow
                </span>
                <span className="text-gray-700">vs</span>
                <span className={cn(data.realAvgReturnPct != null && data.realAvgReturnPct > 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {pct(data.realAvgReturnPct)} real
                </span>
              </div>
            </div>
          )}

          {/* Position counts */}
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>{data.openShadowPositions} tracking live</span>
            <span>{data.closedShadowPositions} resolved</span>
          </div>
        </div>
      )}
    </Panel>
  )
}
