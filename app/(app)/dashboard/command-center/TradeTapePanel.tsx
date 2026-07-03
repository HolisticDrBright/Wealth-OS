'use client'

/**
 * Live trade tape (widget 6) — scrolling fill feed with per-fill provenance:
 * click a row to see the strategy reasoning that produced it (widget 2,
 * compact). No fill without a visible why.
 */

import { useState } from 'react'
import { ListOrdered } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import type { TapeFill } from '@/lib/actions/trade-tape'

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return n < 0 ? `−${s}` : s
}

export function TradeTapePanel({ fills }: { fills: TapeFill[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Panel icon={ListOrdered} title="Trade Tape">
      {fills.length === 0 ? (
        <EmptyState icon={ListOrdered} title="No fills yet" hint="Paper fills stream here with the reasoning that produced them." />
      ) : (
        <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1 font-mono text-[11px]">
          {fills.map(f => {
            const open = f.side === 'open'
            const why = f.reasoning ?? f.exitReason
            return (
              <div key={f.id}>
                <button
                  onClick={() => setExpanded(e => (e === f.id ? null : f.id))}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-white/5"
                >
                  <span className="w-8 shrink-0 text-gray-600">{relTime(f.at)}</span>
                  <span className={cn(
                    'w-11 shrink-0 font-bold uppercase',
                    open ? (f.direction === 'short' ? 'text-red-400' : 'text-emerald-400') : 'text-gray-400',
                  )}>
                    {open ? (f.direction === 'short' ? 'short' : 'long') : 'close'}
                  </span>
                  <span className="w-28 shrink-0 truncate text-gray-200">{f.symbol}</span>
                  <span className="w-32 shrink-0 truncate text-gray-500">{f.strategyKey}</span>
                  <span className="w-16 shrink-0 tabular-nums text-gray-400">{fmtUsd(f.notionalUsd)}</span>
                  <span className="w-20 shrink-0 tabular-nums text-gray-500">@{f.fillPrice.toFixed(f.fillPrice < 10 ? 4 : 2)}</span>
                  {f.pnlUsd != null && (
                    <span className={cn('tabular-nums', f.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {fmtUsd(f.pnlUsd)}
                    </span>
                  )}
                </button>
                {expanded === f.id && (
                  <div className="mx-1.5 mb-1 rounded bg-black/30 p-2 font-sans text-[11px] leading-relaxed text-gray-400">
                    {why ?? 'No recorded reasoning for this fill.'}
                    {f.slippageBps != null && (
                      <span className="ml-2 text-gray-600">slippage {f.slippageBps.toFixed(1)}bps</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
