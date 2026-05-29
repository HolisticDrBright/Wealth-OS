'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import { Activity } from 'lucide-react'
import type { PaperRunView } from '@/lib/actions/paper-trading'

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

function StatCell({ label, value, tone }: { label: string; value: string | number; tone?: 'pos' | 'neg' | 'warn' | 'muted' }) {
  const cls = tone === 'pos' ? 'text-emerald-400'
    : tone === 'neg' ? 'text-red-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'muted' ? 'text-gray-600'
    : 'text-gray-200'
  return (
    <div className="text-center">
      <p className={cn('text-sm font-semibold tabular-nums', cls)}>{value}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">{label}</p>
    </div>
  )
}

export function PaperRunPanel({ lastRun }: { lastRun: PaperRunView | null }) {
  const right = lastRun ? (
    <span className="text-[11px] text-gray-600">{relativeTime(lastRun.runAt)}</span>
  ) : undefined

  return (
    <Panel icon={Activity} title="Last Paper Run" right={right}>
      {!lastRun ? (
        <EmptyState
          icon={Activity}
          title="No runs recorded"
          hint="Hit Run Paper on any asset page to simulate a trading pass. Results appear here."
        />
      ) : (
        <div className="space-y-3">
          {/* Stat row */}
          <div className="grid grid-cols-5 divide-x divide-white/5 rounded-lg border border-white/10 bg-white/[0.02] py-2.5">
            <StatCell label="Strategies" value={lastRun.strategiesRun} />
            <StatCell label="Signals" value={lastRun.opportunitiesFound} />
            <StatCell
              label="Opened"
              value={lastRun.positionsOpened}
              tone={lastRun.positionsOpened > 0 ? 'pos' : 'muted'}
            />
            <StatCell
              label="Closed"
              value={lastRun.positionsClosed}
              tone={lastRun.positionsClosed > 0 ? 'pos' : 'muted'}
            />
            <StatCell
              label="Skipped"
              value={lastRun.totalSkipped}
              tone={lastRun.totalSkipped > 0 ? 'warn' : 'muted'}
            />
          </div>

          {/* Plain-English summary */}
          <p className="text-xs text-gray-400 leading-relaxed">{lastRun.plainEnglish}</p>

          {/* Top skip reason + per-category breakdown */}
          {lastRun.totalSkipped > 0 && (
            <div className="space-y-1">
              {(
                [
                  ['Already open', lastRun.skipped.alreadyOpen, 'text-gray-500'],
                  ['No price', lastRun.skipped.missingPrice, 'text-amber-500'],
                  ['Expired / resolved', lastRun.skipped.expiredMarket + lastRun.skipped.resolvedMarket, 'text-gray-500'],
                  ['Risk / profile blocked', lastRun.skipped.riskBlocked + lastRun.skipped.profileBlocked, 'text-red-500/70'],
                  ['Venue blocked', lastRun.skipped.venueBlocked, 'text-red-500/70'],
                  ['Cap / size', lastRun.skipped.positionCapBlocked + lastRun.skipped.noSize, 'text-amber-500'],
                ] as [string, number, string][]
              )
                .filter(([, n]) => n > 0)
                .map(([label, count, cls]) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{label}</span>
                    <span className={cn('tabular-nums font-medium', cls)}>{count}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Price feed errors */}
          {lastRun.errors.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
              <p className="text-[11px] text-amber-400/80 truncate" title={lastRun.errors[0]}>
                ⚠ {lastRun.errors[0]}
              </p>
              {lastRun.errors.length > 1 && (
                <p className="text-[10px] text-gray-600 mt-0.5">+{lastRun.errors.length - 1} more errors</p>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
