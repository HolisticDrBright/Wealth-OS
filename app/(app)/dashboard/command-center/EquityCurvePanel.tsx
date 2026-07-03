'use client'

/**
 * Equity curve panel — the "is the machine making money?" headline.
 * Cumulative realized paper P&L over time with the Shadow Portfolio
 * (rejected trades) overlaid, plus total P&L incl. unrealized.
 */

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import { LineChart as LineChartIcon } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'
import type { EquityCurveView } from '@/lib/actions/equity-curve'

/** Underwater series: distance below the running high-water mark (≤ 0). */
function withUnderwater(points: EquityCurveView['points']) {
  let peak = -Infinity
  return points.map(p => {
    peak = Math.max(peak, p.realUsd)
    return { ...p, underwaterUsd: Math.round((p.realUsd - peak) * 100) / 100 }
  })
}

function fmt(usd: number): string {
  const abs = Math.abs(usd)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return usd < 0 ? `−${s}` : `+${s}`
}

function pnlClass(v: number): string {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
}

export function EquityCurvePanel({ data }: { data: EquityCurveView | null }) {
  const hasData = !!data && data.points.length > 0

  const right = hasData ? (
    <div className="flex items-baseline gap-3">
      <span className={cn('text-sm font-semibold tabular-nums', pnlClass(data.totalPnlUsd))}>
        {fmt(data.totalPnlUsd)} total
      </span>
      <span className="text-[11px] text-gray-600 tabular-nums">
        {fmt(data.totalRealizedUsd)} realized · {fmt(data.totalUnrealizedUsd)} open
        {data.winRate != null && ` · ${Math.round(data.winRate * 100)}% wins`}
      </span>
    </div>
  ) : undefined

  return (
    <Panel icon={LineChartIcon} title="Equity Curve" right={right}>
      {!hasData ? (
        <EmptyState
          icon={LineChartIcon}
          title="No closed trades yet"
          hint="The cumulative P&L curve appears once paper positions start closing."
        />
      ) : (
        <div className="space-y-2">
          <div className="h-44" style={{ minHeight: 176 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={withUnderwater(data.points)} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={46}
                  tickFormatter={(v: number) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(value, name) => [
                    `$${Number(value).toFixed(2)}`,
                    name === 'realUsd' ? 'Real (accepted)'
                      : name === 'underwaterUsd' ? 'Drawdown from peak'
                      : 'Shadow (rejected)',
                  ]}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                {/* Underwater drawdown shading — always ≤ 0 */}
                <Area type="monotone" dataKey="underwaterUsd" stroke="none"
                  fill="rgba(248,113,113,0.18)" />
                <Line type="monotone" dataKey="realUsd" stroke="#34d399" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="shadowUsd" stroke="#818cf8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-emerald-400" /> Real (accepted trades)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-indigo-400" /> Shadow (rejected trades)
            </span>
            <span className="ml-auto flex items-center gap-2 tabular-nums">
              <a href="/api/ledger/head" target="_blank" rel="noreferrer"
                title="Every decision, order, and outcome is hash-chained — fetch the head and recompute independently"
                className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20">
                ✓ Verified ledger
              </a>
              {data.closedTrades} closed trades
            </span>
          </div>
        </div>
      )}
    </Panel>
  )
}
