'use client'

/**
 * Household goals (upgrade item 6) — straight-line progress with labeled
 * assumptions, placeholder review reminders, and missing-category prompts.
 */

import { Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GoalsSummary } from '@/lib/advisory/goals'

export function GoalsPanel({ summary }: { summary: GoalsSummary & { error?: string } }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Target className="h-3.5 w-3.5" /> Household goals
        </h2>
        <span className="text-[10px] text-gray-600">
          {summary.activeCount} active · {summary.onTrackCount} on track · {summary.offTrackCount} behind
        </span>
      </div>

      {summary.error && <p className="mb-2 text-[11px] text-amber-400">Goals unavailable: {summary.error}</p>}

      {summary.goals.length === 0 ? (
        <p className="text-[11px] text-gray-600">
          No goals yet — add retirement, emergency-fund, home, or education goals on the Household page.
        </p>
      ) : (
        <ul className="space-y-2">
          {summary.goals.slice(0, 8).map(g => (
            <li key={g.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-gray-200">
                  {g.name}
                  <span className="ml-1.5 text-[9px] uppercase tracking-wide text-gray-600">{g.goalType.replace('_', ' ')}</span>
                </span>
                <span className={cn('shrink-0 text-[10px] tabular-nums',
                  g.isPlaceholder ? 'text-gray-500'
                    : g.onTrack === true ? 'text-emerald-400'
                    : g.onTrack === false ? 'text-amber-400' : 'text-sky-400')}>
                  {g.isPlaceholder ? 'review reminder'
                    : g.progressPct != null ? `${g.progressPct}%`
                    : 'needs data'}
                </span>
              </div>
              {!g.isPlaceholder && g.progressPct != null && (
                <div className="mt-1 h-1 rounded bg-white/5">
                  <div className={cn('h-1 rounded', g.onTrack === false ? 'bg-amber-500/60' : 'bg-emerald-500/60')}
                    style={{ width: `${Math.min(100, g.progressPct)}%` }} />
                </div>
              )}
              <p className="mt-1 text-[10px] text-gray-500">{g.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {summary.missingCategories.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-600">
          Not yet set up: {summary.missingCategories.join(', ')} goal{summary.missingCategories.length > 1 ? 's' : ''}.
        </p>
      )}
      <p className="mt-1 text-[10px] text-gray-600">{summary.assumptionsNote}</p>
    </section>
  )
}
