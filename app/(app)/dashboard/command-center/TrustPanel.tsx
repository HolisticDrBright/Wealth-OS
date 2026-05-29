'use client'

import { Panel } from './Panel'
import { InsufficientData } from '@/components/ui/states'
import { MaturityBadge } from '@/components/strategies/MaturityBadge'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { TrustView, TrustEntry } from '@/lib/actions/command-center'

function TrustList({
  title,
  icon: Icon,
  accent,
  entries,
  emptyLabel,
}: {
  title: string
  icon: typeof TrendingUp
  accent: string
  entries: TrustEntry[]
  emptyLabel: string
}) {
  return (
    <div className="min-w-0">
      <p className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${accent}`}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-600">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(e => (
            <li key={e.strategyKey} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-gray-200">{e.strategyLabel}</span>
                <MaturityBadge status={e.maturityStatus} />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-gray-500" title={e.reason}>{e.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TrustPanel({ trust }: { trust: TrustView }) {
  return (
    <Panel icon={TrendingUp} title="Strategies Gaining / Losing Trust">
      {trust.insufficient ? (
        <InsufficientData label="Trust trends populate as strategies accumulate graded outcomes." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TrustList
            title="Gaining"
            icon={TrendingUp}
            accent="text-emerald-400"
            entries={trust.gaining}
            emptyLabel="No promotion candidates yet."
          />
          <TrustList
            title="Losing"
            icon={TrendingDown}
            accent="text-red-400"
            entries={trust.losing}
            emptyLabel="No strategies have lost trust."
          />
        </div>
      )}
    </Panel>
  )
}
