/**
 * Simple-mode dashboard (Phase 3.2): exactly four things, in plain English.
 * Server component — all numbers come from getSimpleDashboard().
 */

import Link from 'next/link'
import { getSimpleDashboard } from '@/lib/actions/simple-dashboard'
import { GlossaryTerm } from '@/components/ui/glossary'

function usd(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

function Arrow({ n }: { n: number }) {
  return <span aria-hidden>{n >= 0 ? '▲' : '▼'}</span>
}

function monthYear(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function ValueChart({ series }: { series: Array<{ date: string; valueUsd: number }> }) {
  if (series.length < 2) return null
  const w = 640; const h = 72
  const vals = series.map(p => p.valueUsd)
  const min = Math.min(...vals); const max = Math.max(...vals)
  const span = Math.max(1, max - min)
  const pts = series.map((p, i) => {
    const x = (i / (series.length - 1)) * w
    const y = h - 6 - ((p.valueUsd - min) / span) * (h - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const direction = vals[vals.length - 1] >= vals[0] ? 'risen' : 'fallen'
  return (
    <svg
      role="img"
      aria-label={`Your total value has ${direction} from ${usd(vals[0])} to ${usd(vals[vals.length - 1])} over this period`}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 h-16 w-full"
      preserveAspectRatio="none"
    >
      <polyline points={pts.join(' ')} fill="none" stroke="var(--color-accent-cyan, #3cc8e6)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="rgba(255,255,255,0.12)" />
    </svg>
  )
}

export async function SimpleDashboard() {
  const data = await getSimpleDashboard()

  if (!data) {
    return (
      <div className="p-6 text-sm text-text-1">
        We couldn&apos;t load your overview. Refresh to try again — your money and limits are unaffected.
      </div>
    )
  }

  const { goal } = data

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5 md:p-6">
      {/* a. Total value */}
      <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5">
        <p className="text-[13px] text-text-1">You have</p>
        <p className="mt-1 font-mono text-4xl font-semibold tracking-tight text-white">
          {usd(data.totalValueUsd)}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          <span className={data.todayChangeUsd >= 0 ? 'text-emerald-400' : 'text-orange-400'}>
            <Arrow n={data.todayChangeUsd} /> {usd(data.todayChangeUsd)} today
          </span>
          <span className="text-text-1">
            <Arrow n={data.sinceStartChangeUsd} /> {usd(data.sinceStartChangeUsd)} since you started
          </span>
        </div>
        <ValueChart series={data.valueSeries} />
        {data.yearRange && (
          <p className="mt-3 text-[13px] leading-relaxed text-text-1">
            Based on how this kind of mix has behaved before: in a bad year this plan could fall about{' '}
            <span className="font-mono text-orange-300">{usd(data.yearRange.badYearUsd)}</span>; a typical year adds about{' '}
            <span className="font-mono text-gray-200">{usd(data.yearRange.typicalYearUsd)}</span>. Estimates, not promises.
          </p>
        )}
      </section>

      {/* Paused banner */}
      {data.tradingHalted && (
        <section className="rounded-2xl border border-orange-500/40 bg-orange-950/20 p-4 text-[13px] text-orange-200">
          Trading is paused. Nothing new will be bought or sold until you turn it back on from the strip above.
        </section>
      )}

      {/* b. Goal progress */}
      {goal ? (
        <Link
          href="/advisor"
          className="block rounded-2xl border border-line-strong bg-white/[0.03] p-5 transition-colors hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-white">{goal.name}</h2>
            {goal.status === 'on_track' && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">On track</span>
            )}
            {goal.status === 'behind' && (
              <span className="rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-semibold text-orange-300">Behind</span>
            )}
            {(goal.status === 'no_target_date' || goal.status === 'unknown') && (
              <span className="rounded-full bg-fill px-2.5 py-0.5 text-xs font-semibold text-gray-300">No date set</span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={`${Math.round(goal.fraction * 100)}% of your goal saved`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal.fraction * 100)}
            className="mt-3 h-2 rounded-full bg-fill"
          >
            <div className="h-2 rounded-full bg-[var(--color-accent-cyan,#3cc8e6)]" style={{ width: `${goal.fraction * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-1 text-[13px] text-text-1">
            <span><span className="font-mono text-gray-200">{usd(goal.savedUsd)}</span> of <span className="font-mono">{usd(goal.targetAmountUsd)}</span></span>
            {goal.expectedDate
              ? <span>Expected {monthYear(goal.expectedDate)}</span>
              : <span>We can&apos;t estimate a date right now</span>}
          </div>
          {data.goalCount > 1 && (
            <p className="mt-2 text-xs text-gray-500">+{data.goalCount - 1} more goal{data.goalCount > 2 ? 's' : ''} — tap to see all</p>
          )}
        </Link>
      ) : (
        <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5 text-[13px] text-text-1">
          No goal yet. <Link href="/onboarding/risk-profile" className="text-[var(--color-accent-cyan,#3cc8e6)] underline">Set one up</Link> — everything here works toward a goal you choose.
        </section>
      )}

      {/* d. Needs your decision */}
      {data.decisions.length > 0 ? (
        <Link
          href={data.decisions[0].href}
          className="block rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-5 transition-colors hover:border-cyan-400/40"
        >
          <p className="text-xs font-semibold tracking-wide text-cyan-300">NEEDS YOUR DECISION</p>
          <p className="mt-1.5 text-[15px] font-semibold text-white">{data.decisions[0].text}</p>
          {data.decisions.length > 1 && (
            <p className="mt-1 text-[13px] text-text-1">+{data.decisions.length - 1} more waiting</p>
          )}
        </Link>
      ) : (
        <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5 text-[13px] text-gray-500">
          Nothing needs you right now.
        </section>
      )}

      {/* c. What happened this week */}
      <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">What happened this week</h2>
          <Link href="/paper-trading" className="py-2 text-[13px] text-[var(--color-accent-cyan,#3cc8e6)]">See all</Link>
        </div>
        {data.weekItems.length > 0 ? (
          <ul className="mt-3 space-y-2.5">
            {data.weekItems.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-gray-200">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-cyan,#3cc8e6)]" />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-gray-500">
            A quiet week — no trades with your <GlossaryTerm term="practice money">practice money</GlossaryTerm>, nothing skipped, nothing sold.
          </p>
        )}
      </section>
    </div>
  )
}
