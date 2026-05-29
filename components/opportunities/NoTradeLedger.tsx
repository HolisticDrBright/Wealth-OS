'use client'

/**
 * No-Trade Ledger — a deliberate record of every signal Wealth OS declined and
 * why. Framing matters: *not* trading is a risk-aware decision, so even an empty
 * ledger shows the full reason taxonomy as a legend to make the discipline
 * visible. Clicking a legend chip filters the entries by that reason.
 */

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/states'
import { TONE_CLASSES, assetClassLabel } from '@/lib/strategies/strategy-display'
import {
  ALL_NO_TRADE_REASONS,
  getNoTradeReason,
  type NoTradeReasonCode,
} from '@/lib/no-trade/reasons'
import type { NoTradeEntry } from '@/lib/actions/no-trade-ledger'
import { ShieldCheck, X } from 'lucide-react'

interface Props {
  entries: NoTradeEntry[]
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

function ReasonChip({
  code,
  label,
  active,
  dimmed,
  onClick,
  title,
}: {
  code: NoTradeReasonCode
  label: string
  active?: boolean
  dimmed?: boolean
  onClick?: () => void
  title?: string
}) {
  const tone = TONE_CLASSES[getNoTradeReason(code).tone]
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
        tone.text,
        tone.bg,
        tone.border,
        active && 'ring-1 ring-white/40',
        dimmed && 'opacity-40 hover:opacity-100',
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function NoTradeLedger({ entries }: Props) {
  const [activeReason, setActiveReason] = useState<NoTradeReasonCode | null>(null)

  const filtered = useMemo(
    () => (activeReason ? entries.filter(e => e.reasonCode === activeReason) : entries),
    [entries, activeReason],
  )

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Not trading is a decision too.</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
              This ledger logs every signal Wealth OS reviewed and deliberately declined — with the
              risk-aware reason it was rejected. A short list here is discipline working as intended.
            </p>
          </div>
        </div>
      </div>

      {/* Reason legend */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Reason taxonomy
          </p>
          {activeReason && (
            <button
              type="button"
              onClick={() => setActiveReason(null)}
              className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
            >
              <X className="h-3 w-3" /> Clear filter
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_NO_TRADE_REASONS.map(r => (
            <ReasonChip
              key={r.code}
              code={r.code}
              label={r.label}
              title={r.blurb}
              active={activeReason === r.code}
              dimmed={activeReason !== null && activeReason !== r.code}
              onClick={() => setActiveReason(prev => (prev === r.code ? null : r.code))}
            />
          ))}
        </div>
      </div>

      {/* Entries */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={activeReason ? 'No blocked calls for this reason' : 'No blocked calls recently'}
          hint="When a signal is rejected — weak edge, wide spread, jurisdiction, failed Red Team, etc. — it will appear here with the reason."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {/* Header row (desktop) */}
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,0.7fr)] gap-3 border-b border-white/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 sm:grid">
            <span>Reason</span>
            <span>Strategy</span>
            <span>Symbol</span>
            <span>Asset</span>
            <span>Detail</span>
            <span className="text-right">When</span>
          </div>

          <ul className="divide-y divide-white/5">
            {filtered.map(entry => {
              const meta = getNoTradeReason(entry.reasonCode)
              const tone = TONE_CLASSES[meta.tone]
              return (
                <li
                  key={entry.id}
                  className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,0.7fr)] sm:items-center sm:gap-y-0"
                >
                  {/* Reason pill */}
                  <div className="min-w-0 order-1">
                    <span
                      className={cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        tone.text,
                        tone.bg,
                        tone.border,
                      )}
                      title={meta.blurb}
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
                      <span className="truncate">{meta.label}</span>
                    </span>
                  </div>

                  {/* Strategy */}
                  <div className="min-w-0 order-3 sm:order-2">
                    <span className="block truncate text-gray-300" title={entry.strategyLabel}>
                      {entry.strategyLabel}
                    </span>
                  </div>

                  {/* Symbol */}
                  <div className="min-w-0 order-2 text-right sm:order-3 sm:text-left">
                    {entry.symbol ? (
                      <span className="font-mono font-semibold text-indigo-300">{entry.symbol}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </div>

                  {/* Asset */}
                  <div className="min-w-0 order-4">
                    <span className="block truncate text-gray-400">
                      {entry.assetClass ? assetClassLabel(entry.assetClass) : '—'}
                    </span>
                  </div>

                  {/* Detail */}
                  <div className="col-span-2 min-w-0 order-6 sm:col-span-1 sm:order-5">
                    <span
                      className="block truncate text-gray-500"
                      title={entry.detail ?? undefined}
                    >
                      {entry.detail ?? '—'}
                    </span>
                  </div>

                  {/* When */}
                  <div className="min-w-0 order-5 text-right text-gray-500 sm:order-6">
                    <span title={new Date(entry.at).toLocaleString()}>{relativeTime(entry.at)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
