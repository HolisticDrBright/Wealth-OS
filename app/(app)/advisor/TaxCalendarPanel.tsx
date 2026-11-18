'use client'

/**
 * Tax planning calendar (upgrade item 4) — dense chronological list with
 * needs-data labels and the staleness banner. Educational; every date needs
 * CPA confirmation.
 */

import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaxCalendarView } from '@/lib/actions/tax-calendar'
import type { CalendarEntry } from '@/lib/advisory/tax-calendar'

const STATUS_TONE: Record<CalendarEntry['status'], string> = {
  soon: 'text-amber-400',
  upcoming: 'text-gray-300',
  past: 'text-gray-600',
  needs_data: 'text-sky-400',
}

const CATEGORY_LABEL: Record<CalendarEntry['category'], string> = {
  contribution: 'contrib',
  tax: 'tax',
  harvesting: 'TLH',
  review: 'review',
  business: 'business',
  placeholder: 'needs data',
}

export function TaxCalendarPanel({ view }: { view: TaxCalendarView }) {
  const visible = view.entries.filter(e => e.status !== 'past')
  return (
    <section className="rounded-xl border border-line-strong bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-1">
          <CalendarDays className="h-3.5 w-3.5" /> Tax & planning calendar
        </h2>
        <span className="text-xs text-gray-600">
          {view.governance.constantsYear ? `${view.governance.constantsYear} constants` : 'tax constants unavailable'}
        </span>
      </div>

      {view.staleness.stale && (
        <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-300">
          {view.staleness.uiCopy}
        </p>
      )}
      {view.error && <p className="mb-2 text-xs text-amber-400">Calendar unavailable: {view.error}</p>}

      <ul className="divide-y divide-white/5">
        {visible.slice(0, 14).map(e => (
          <li key={e.id} className="flex items-start gap-3 py-1.5">
            <span className="w-20 shrink-0 font-mono text-xs text-gray-500">{e.date}</span>
            <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-text-2">{CATEGORY_LABEL[e.category]}</span>
            <div className="min-w-0">
              <p className={cn('text-xs font-medium', STATUS_TONE[e.status])}>
                {e.title}
                {e.status === 'soon' && e.daysAway != null && (
                  <span className="ml-1.5 text-xs text-amber-400/80">{e.daysAway}d</span>
                )}
                {e.status === 'needs_data' && (
                  <span className="ml-1.5 text-xs text-sky-400/80">add {e.missingInputs.join(', ')}</span>
                )}
              </p>
              <p className="text-xs leading-relaxed text-gray-500">{e.detail}</p>
            </div>
          </li>
        ))}
        {visible.length === 0 && !view.error && (
          <li className="py-2 text-xs text-gray-600">No upcoming entries.</li>
        )}
      </ul>
      <p className="mt-2 text-xs text-gray-600">{view.disclaimer}</p>
    </section>
  )
}
