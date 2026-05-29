'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  ClipboardCheck,
  CheckCircle2,
  Gavel,
  PlugZap,
  ShieldAlert,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import type { DecisionItem, DecisionKind } from '@/lib/actions/command-center'

const KIND_META: Record<DecisionKind, { icon: LucideIcon; color: string }> = {
  review_candidate: { icon: Gavel, color: 'text-amber-400' },
  missing_env: { icon: PlugZap, color: 'text-sky-400' },
  risk_controls: { icon: ShieldAlert, color: 'text-red-400' },
}

export function DecisionsPanel({ decisions }: { decisions: DecisionItem[] }) {
  return (
    <Panel icon={ClipboardCheck} title="Required Decisions">
      {decisions.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs your attention"
          hint="Pending reviews, missing config, and unset risk limits will show up here."
        />
      ) : (
        <ul className="space-y-1.5">
          {decisions.map(d => {
            const meta = KIND_META[d.kind]
            const Icon = meta.icon
            return (
              <li key={d.id}>
                <Link
                  href={d.href}
                  className="group flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs hover:border-white/15 hover:bg-white/5"
                >
                  <Icon className={cn('h-4 w-4 shrink-0', meta.color)} />
                  <span className="min-w-0 flex-1 truncate text-gray-300">{d.text}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-600 group-hover:text-gray-400" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
