'use client'

/**
 * Run history strip — the last N paper runs as a compact timeline so feed
 * degradation or a silent stop shows up as a trend, not just in the last run.
 * Each cell: opened (emerald) > skipped-only (amber) > errors (red ring).
 */

import { cn } from '@/lib/utils'
import type { PaperRunView } from '@/lib/actions/paper-trading'

function relativeTime(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.round(diffMin / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function RunHistoryStrip({ runs }: { runs: PaperRunView[] }) {
  if (runs.length < 2) return null

  // Oldest → newest left to right
  const ordered = [...runs].reverse()

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">Run history</span>
        <span className="text-[10px] text-gray-600">{runs.length} runs · latest {relativeTime(runs[0].runAt)}</span>
      </div>
      <div className="flex items-end gap-1">
        {ordered.map((r, i) => {
          const hasErrors = r.errors.length > 0
          const tone = r.positionsOpened > 0
            ? 'bg-emerald-500/70'
            : r.totalSkipped > 0
              ? 'bg-amber-500/50'
              : 'bg-white/15'
          // Height scales with signal count so dead runs are visibly short
          const h = Math.max(6, Math.min(28, 6 + r.opportunitiesFound * 1.4))
          return (
            <div
              key={`${r.runAt}-${i}`}
              title={`${new Date(r.runAt).toLocaleString()}\n${r.opportunitiesFound} signals · ${r.positionsOpened} opened · ${r.totalSkipped} skipped${hasErrors ? `\n⚠ ${r.errors.length} errors` : ''}`}
              className={cn(
                'flex-1 cursor-default rounded-sm transition-opacity hover:opacity-80',
                tone,
                hasErrors && 'ring-1 ring-red-500/70',
              )}
              style={{ height: `${h}px`, maxWidth: 14 }}
            />
          )
        })}
      </div>
    </div>
  )
}
