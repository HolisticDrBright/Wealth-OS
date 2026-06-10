'use client'

/**
 * Promotion pipeline — for each paper-trading strategy, the quantitative bar
 * it must clear to become a live candidate and where it stands today.
 * Read-only: promotion itself remains a manual registry change.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { GitBranch, CheckCircle2, XCircle, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { PromotionPipelineRow } from '@/lib/actions/promotion-readiness'

function CriterionIcon({ pass, evaluable }: { pass: boolean; evaluable: boolean }) {
  if (!evaluable) return <HelpCircle className="h-3.5 w-3.5 shrink-0 text-gray-600" />
  return pass
    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
    : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
}

export function PromotionPipelinePanel({ rows }: { rows: PromotionPipelineRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (rows.length === 0) return null

  const visible = showAll ? rows : rows.slice(0, 6)
  const readyCount = rows.filter(r => r.ready).length

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-200">Promotion Pipeline</h3>
          <span className="text-[11px] text-gray-600">paper → live candidate</span>
        </div>
        <span className={cn('text-xs font-medium', readyCount > 0 ? 'text-emerald-400' : 'text-gray-600')}>
          {readyCount > 0 ? `${readyCount} ready for review` : 'none ready yet'}
        </span>
      </div>

      <div className="space-y-1.5">
        {visible.map(r => {
          const expanded = open === r.strategyKey
          return (
            <div key={r.strategyKey} className="rounded-lg border border-white/10 bg-white/[0.02]">
              <button
                onClick={() => setOpen(expanded ? null : r.strategyKey)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {r.ready
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    : <span className="text-[11px] tabular-nums text-gray-500">{r.passing}/{r.totalCriteria}</span>}
                  <span className="text-sm text-gray-200">{r.displayName}</span>
                </div>
                <div className="flex items-center gap-2">
                  {r.ready && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      Ready — review manually
                    </span>
                  )}
                  {expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-600" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-600" />}
                </div>
              </button>

              {expanded && (
                <div className="space-y-1.5 border-t border-white/5 px-3 py-2.5">
                  {r.criteria.map(c => (
                    <div key={c.name} className="flex items-start gap-2 text-xs">
                      <CriterionIcon pass={c.pass} evaluable={c.evaluable} />
                      <div className="flex-1">
                        <span className="text-gray-400">{c.name}</span>
                        <span className="text-gray-600"> · needs {c.required} · </span>
                        <span className={cn(
                          !c.evaluable ? 'text-gray-500' : c.pass ? 'text-emerald-400/80' : 'text-red-400/80',
                        )}>
                          {c.actual}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {rows.length > 6 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-2 text-xs text-indigo-400 transition-colors hover:text-indigo-300"
        >
          {showAll ? 'Show fewer' : `Show all ${rows.length} paper strategies`}
        </button>
      )}
    </div>
  )
}
