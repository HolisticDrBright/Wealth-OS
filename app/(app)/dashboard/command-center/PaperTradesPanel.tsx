'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn, formatCurrency } from '@/lib/utils'
import { FlaskConical } from 'lucide-react'
import type { PaperView } from '@/lib/actions/command-center'

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-gray-200'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px]">
      <span className="text-gray-500">{label}</span>
      <span className={cn('font-semibold tabular-nums', color)}>{value}</span>
    </span>
  )
}

export function PaperTradesPanel({ paper }: { paper: PaperView }) {
  const { positions, summary } = paper
  const unreal = summary.unrealizedPnlUsd

  const right = summary.hasData ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip label="Open" value={String(summary.openCount)} />
      <Chip
        label="Unreal P&L"
        value={`${unreal >= 0 ? '+' : ''}${formatCurrency(unreal)}`}
        tone={unreal >= 0 ? 'pos' : 'neg'}
      />
    </div>
  ) : undefined

  return (
    <Panel icon={FlaskConical} title="Active Paper Trades" right={right}>
      {positions.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No open paper positions"
          hint="Enable paper trading on an asset page and run a pass — simulated fills will show up here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600">
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 pr-3 font-medium">Symbol</th>
                <th className="pb-2 pr-3 font-medium">Dir</th>
                <th className="pb-2 pr-3 text-right font-medium">Notional</th>
                <th className="pb-2 text-right font-medium">Unreal P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.slice(0, 10).map(p => {
                const isLong = p.direction?.toLowerCase() === 'long'
                const pnl = p.unrealizedPnlUsd
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="max-w-[10rem] truncate py-2 pr-3 text-gray-300">{p.strategyLabel}</td>
                    <td className="py-2 pr-3 font-mono text-indigo-300">{p.symbol}</td>
                    <td className="py-2 pr-3">
                      <span className={cn('font-medium', isLong ? 'text-emerald-400' : 'text-red-400')}>
                        {p.direction?.toUpperCase() || '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-300">
                      {formatCurrency(p.notionalUsd)}
                    </td>
                    <td className={cn('py-2 text-right font-semibold tabular-nums', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {positions.length > 10 && (
            <p className="pt-2 text-center text-[11px] text-gray-600">+{positions.length - 10} more open</p>
          )}
        </div>
      )}
    </Panel>
  )
}
