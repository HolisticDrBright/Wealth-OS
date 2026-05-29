'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { PositionCapBadge, DrawdownBadge, capUtilToLevel } from '@/components/risk/RiskBadges'
import { formatCurrency } from '@/lib/utils'
import { Shield } from 'lucide-react'
import type { RiskSummary } from '@/lib/actions/risk'
import type { RiskControlsView } from '@/lib/actions/command-center'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-gray-100'
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className={`truncate text-sm font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

export function RiskStatusPanel({
  risk,
  controls,
}: {
  risk: RiskSummary
  controls: RiskControlsView | null
}) {
  const hasPositions = risk.open_position_count > 0

  // Cap utilization: fraction of the per-position cap consumed by the largest position.
  const capPct = controls?.maxSinglePositionPct ?? 0
  const usedFraction = capPct > 0 ? risk.largest_position_pct / 100 / (capPct / 100) : 0
  const capBadge = capUtilToLevel(usedFraction)
  const ddValue = controls ? `${controls.maxDrawdownPct.toFixed(0)}%` : 'n/a'

  return (
    <Panel icon={Shield} title="Portfolio Risk Status">
      {!hasPositions ? (
        <EmptyState
          icon={Shield}
          title="No open exposure"
          hint="Open positions and their risk utilization will appear here once you start trading."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Open notional" value={formatCurrency(risk.total_open_notional)} />
            <Stat label="Positions" value={String(risk.open_position_count)} />
            <Stat
              label="Today P&L"
              value={`${risk.today_pnl >= 0 ? '+' : ''}${formatCurrency(risk.today_pnl)}`}
              tone={risk.today_pnl >= 0 ? 'pos' : 'neg'}
            />
            <Stat label="Largest position" value={`${risk.largest_position_pct.toFixed(1)}%`} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
            <PositionCapBadge
              level={controls ? capBadge.level : 'unknown'}
              value={controls ? capBadge.value : 'n/a'}
              title={
                controls
                  ? `Largest position is ${risk.largest_position_pct.toFixed(1)}% vs ${capPct}% cap`
                  : 'No position cap configured'
              }
            />
            <DrawdownBadge
              level={controls ? 'ok' : 'unknown'}
              value={ddValue}
              title={controls ? `Max drawdown limit ${ddValue}` : 'No drawdown limit configured'}
            />
          </div>
        </>
      )}
    </Panel>
  )
}
