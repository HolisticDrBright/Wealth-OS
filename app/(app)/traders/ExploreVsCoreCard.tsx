'use client'

/**
 * "Is Explore earning its keep?" (roadmap #3). Compares every closed Explore
 * trade, after costs, with the same dollars held in your Core funds over the
 * same days — in total, and (pro) per strategy. When Explore trails Core over
 * a meaningful stretch, offers to SHRINK the Explore limit. Nothing is sold.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Scale } from 'lucide-react'
import type { ExploreVsCoreView } from '@/lib/explore/vs-core-data'
import { approveExploreShrinkAction, snoozeExploreShrinkAction } from '@/lib/actions/explore-vs-core'
import { toDisplayName } from '@/lib/strategies/strategy-display'

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`

export function ExploreVsCoreCard({ view, uiMode }: { view: ExploreVsCoreView; uiMode: 'simple' | 'pro' }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { comparison: c, verdict: v } = view
  const ahead = c.total.excessUsd >= 0

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setError(null)
    const res = await fn()
    if (!res.ok) setError(res.error ?? 'Something went wrong — nothing was changed.')
    router.refresh()
  })

  return (
    <section aria-labelledby="vs-core-heading" className="rounded-2xl border border-line-strong bg-white/[0.03] p-5">
      <h2 id="vs-core-heading" className="flex items-center gap-2 text-[15px] font-semibold text-text-0">
        <Scale className="h-4 w-4 text-accent-cyan" aria-hidden /> Is Explore earning its keep?
      </h2>

      {!view.available ? (
        <p className="mt-2 text-[13px] text-text-1">{v.reason}</p>
      ) : c.total.trades === 0 ? (
        <p className="mt-2 text-[13px] text-text-1">
          No closed Explore trades yet. Each one will be compared with the same dollars held in your Core funds over the same days.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-text-1">
            Over {c.daysCovered} days and {c.total.trades} closed trades, Explore made{' '}
            <span className="font-mono text-text-0">{usd(c.total.netUsd)}</span> after costs. The same dollars in your Core funds over the
            same days would have made <span className="font-mono text-text-0">{usd(c.total.coreUsd)}</span> —{' '}
            <span className={ahead ? 'text-emerald-300' : 'text-orange-300'}>
              {ahead ? `${usd(c.total.excessUsd)} ahead` : `${usd(-c.total.excessUsd)} behind`}
            </span>.
          </p>
          <p className="mt-1 text-xs text-text-1">{v.propose ? '' : v.reason}</p>
          {c.total.unpriced > 0 && (
            <p className="mt-1 text-xs text-text-1">{c.total.unpriced} trade(s) couldn&apos;t be compared (no Core price history that far back).</p>
          )}
        </>
      )}

      {v.propose && view.summary && v.newCapFraction != null && (
        <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
          <p className="text-xs font-semibold tracking-wide text-cyan-300">NEEDS YOUR DECISION</p>
          <p className="mt-1 text-sm text-text-0">
            Shrink your Explore limit from {pct(v.currentCapFraction)} to {pct(v.newCapFraction)}. {v.reason}
          </p>
          <p className="mt-1 text-xs text-text-1">Nothing is sold. New strategy trades wait until Explore fits the smaller limit; the rest stays with Core.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="min-h-[40px] rounded-lg bg-accent-cyan px-4 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-40"
              disabled={pending} onClick={() => act(() => approveExploreShrinkAction(view.summary!))}
            >Approve — shrink Explore</button>
            <button
              className="min-h-[40px] rounded-lg border border-line-strong px-4 text-sm font-semibold text-text-0 hover:bg-white/5 disabled:opacity-40"
              disabled={pending} onClick={() => act(() => snoozeExploreShrinkAction())}
            >Not now</button>
          </div>
        </div>
      )}

      {uiMode === 'pro' && view.available && c.perStrategy.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-text-1">
            <tr><th scope="col" className="py-1">Strategy</th><th scope="col">Trades</th><th scope="col">After costs</th><th scope="col">Same $ in Core</th><th scope="col">vs Core</th></tr>
          </thead>
          <tbody>
            {c.perStrategy.map(s => (
              <tr key={s.strategyKey} className="border-t border-line-strong">
                <td className="py-1 text-text-0">{toDisplayName(s.strategyKey)}</td>
                <td className="font-mono">{s.trades}</td>
                <td className="font-mono">{usd(s.netUsd)}</td>
                <td className="font-mono">{usd(s.coreUsd)}</td>
                <td className={`font-mono ${s.trades === 0 ? 'text-text-1' : s.excessUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>
                  {s.trades === 0 ? '—' : usd(s.excessUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </section>
  )
}
