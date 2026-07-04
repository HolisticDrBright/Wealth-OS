'use client'

/**
 * Wealth checkup — the "regular person building wealth" panel: status items
 * with data-quality labels, the best-next-dollar waterfall, and the missing
 * data that would improve guidance. Educational planning only; every item
 * shows its confidence and whether professional review is required.
 */

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Wallet, ArrowDownWideNarrow, HelpCircle } from 'lucide-react'
import type { WealthCheckup, CheckupItem } from '@/lib/actions/wealth-checkup'
import type { NextDollarStep } from '@/lib/advisory/next-dollar'
import type { DataQualityLabel } from '@/lib/advisory/data-quality'
import type { Explanation } from '@/lib/advisory/suitability'

/** Expandable "why / risks / verify" block (item 9) — same shape everywhere. */
function ExplanationDetails({ e }: { e: Explanation }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-400">
        Why this, what could go wrong, what to verify
      </summary>
      <dl className="mt-1.5 space-y-1 rounded border border-white/5 bg-white/[0.02] p-2 text-[10px] leading-relaxed">
        <div><dt className="font-semibold text-gray-400">Why now</dt><dd className="text-gray-500">{e.whyNow}</dd></div>
        <div><dt className="font-semibold text-gray-400">What could go wrong</dt><dd className="text-gray-500">{e.whatCouldGoWrong}</dd></div>
        <div><dt className="font-semibold text-gray-400">Data used</dt><dd className="text-gray-500">{e.dataUsed.join(', ') || 'none'}</dd></div>
        {e.missingData.length > 0 && (
          <div><dt className="font-semibold text-gray-400">Missing data</dt><dd className="text-gray-500">{e.missingData.join(', ')}</dd></div>
        )}
        <div><dt className="font-semibold text-gray-400">What to verify</dt><dd className="text-gray-500">{e.whatToVerify}</dd></div>
        <div>
          <dt className="font-semibold text-gray-400">Professional review</dt>
          <dd className="text-gray-500">{e.professionalReviewNeeded ? 'Required before acting' : 'Not required — still verify inputs'}</dd>
        </div>
      </dl>
    </details>
  )
}

const STATUS_TONE: Record<CheckupItem['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: 'OK', variant: 'success' },
  action: { label: 'Action', variant: 'warning' },
  needs_data: { label: 'Needs data', variant: 'default' },
  info: { label: 'Info', variant: 'info' },
}

const STEP_TONE: Record<NextDollarStep['status'], string> = {
  recommended: 'text-emerald-400',
  satisfied: 'text-gray-500',
  needs_data: 'text-amber-400',
  not_applicable: 'text-gray-600',
}

function QualityChips({ q }: { q: DataQualityLabel }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-[9px] text-gray-600">
      <span className={cn('rounded border px-1 py-px',
        q.confidence === 'high' ? 'border-emerald-500/30 text-emerald-400/80'
          : q.confidence === 'medium' ? 'border-amber-500/30 text-amber-400/80'
          : 'border-red-500/30 text-red-400/80')}>
        {q.confidence} confidence · {q.completenessPct}% data
      </span>
      {q.ratesCurrent === false && <span className="rounded border border-amber-500/30 px-1 py-px text-amber-400/80">rates need verification</span>}
      {q.taxConstantsCurrent === false && <span className="rounded border border-amber-500/30 px-1 py-px text-amber-400/80">tax constants stale</span>}
      {q.requiresProfessionalReview && <span className="rounded border border-white/10 px-1 py-px">requires CPA review</span>}
      <span className="rounded border border-white/10 px-1 py-px">educational only</span>
      {q.missingInputs.length > 0 && (
        <span className="rounded border border-white/10 px-1 py-px" title={q.missingInputs.join(', ')}>
          missing: {q.missingInputs.slice(0, 2).join(', ')}{q.missingInputs.length > 2 ? '…' : ''}
        </span>
      )}
    </span>
  )
}

export function WealthCheckupPanel({ checkup }: { checkup: WealthCheckup }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Wallet className="h-3.5 w-3.5" /> Wealth checkup
        </h2>
        <span className="text-[10px] text-gray-600">educational planning — not advice</span>
      </div>

      {checkup.error && (
        <p className="mb-3 text-[11px] text-amber-400">Checkup unavailable: {checkup.error}</p>
      )}

      {checkup.staleness.stale && (
        <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-300">
          {checkup.staleness.reasons.join(' · ')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* status items */}
        <div className="space-y-2">
          {checkup.items.map(item => (
            <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-gray-200">{item.title}</span>
                <Badge variant={STATUS_TONE[item.status].variant}>{STATUS_TONE[item.status].label}</Badge>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">{item.summary}</p>
              <div className="mt-1.5"><QualityChips q={item.quality} /></div>
              <ExplanationDetails e={item.explanation} />
            </div>
          ))}
          {checkup.items.length === 0 && !checkup.error && (
            <p className="text-[11px] text-gray-600">Complete the financial profile to populate the checkup.</p>
          )}
        </div>

        {/* next-dollar waterfall */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <ArrowDownWideNarrow className="h-3 w-3" /> Where the next dollar goes
          </p>
          <ol className="space-y-1.5">
            {checkup.nextDollar.steps.map(step => (
              <li key={step.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                <div className="flex items-start gap-2">
                  <span className="mt-px w-4 shrink-0 text-right font-mono text-[10px] text-gray-600">{step.rank}</span>
                  <div className="min-w-0">
                    <p className="text-[11px]">
                      <span className={cn('font-medium', STEP_TONE[step.status])}>{step.title}</span>
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide text-gray-600">{step.status.replace('_', ' ')}</span>
                    </p>
                    <p className="text-[10px] leading-relaxed text-gray-500">{step.reason}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {checkup.nextDollar.bestNext && (
            <p className="mt-2 text-[11px] text-emerald-400/90">
              Best next dollar: <span className="font-medium">{checkup.nextDollar.bestNext.title}</span>
            </p>
          )}
        </div>
      </div>

      {checkup.missingData.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <HelpCircle className="h-3 w-3" /> Data that would improve this guidance
          </p>
          <p className="text-[11px] text-gray-500">{checkup.missingData.join(' · ')}</p>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-gray-600">{checkup.disclaimer}</p>
      <p className="mt-1 text-[10px] text-gray-600">{checkup.nextDollar.disclaimer}</p>
      <p className="mt-1 text-[10px] text-gray-700">
        {checkup.governance.ruleVersion} · generated {checkup.governance.generatedAt.slice(0, 16).replace('T', ' ')}
        {checkup.governance.constantsYear ? ` · ${checkup.governance.constantsYear} tax constants` : ' · tax constants unavailable'}
        {checkup.bestNextSuitability ? ' · suitability file available for the top recommendation' : ''}
      </p>
    </section>
  )
}
