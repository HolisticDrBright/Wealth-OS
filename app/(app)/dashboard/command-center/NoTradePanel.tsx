'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import { getNoTradeReason } from '@/lib/no-trade/reasons'
import { TONE_CLASSES } from '@/lib/strategies/strategy-display'
import { ShieldOff } from 'lucide-react'
import type { NoTradeEntry } from '@/lib/actions/no-trade-ledger'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return ''
  const diffMin = Math.round((Date.now() - then) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.round(diffMin / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function NoTradePanel({ entries }: { entries: NoTradeEntry[] }) {
  return (
    <Panel icon={ShieldOff} title="Blocked / No-Trade Calls">
      {entries.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          title="No blocked calls recently"
          hint="Declined trades will appear here — skipping a bad trade is a deliberate, valuable decision."
        />
      ) : (
        <ul className="space-y-1.5">
          {entries.map(e => {
            const reason = getNoTradeReason(e.reasonCode)
            const tone = TONE_CLASSES[reason.tone]
            return (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs"
              >
                <span
                  title={reason.blurb}
                  className={cn(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                    tone.text,
                    tone.bg,
                    tone.border,
                  )}
                >
                  {reason.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-300">
                  {e.strategyLabel}
                  {e.symbol && <span className="ml-1 font-mono text-indigo-300">{e.symbol}</span>}
                </span>
                <span className="shrink-0 text-gray-600">{relativeTime(e.at)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
