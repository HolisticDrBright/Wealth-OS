'use client'

/**
 * "Your money ladder" (Phase 2.4) — three rows with dollars, what each tier is
 * for, and whether it is funded. Also hosts the two ladder actions: entering
 * monthly expenses, and approving the one-tap "Set up your ladder" decision.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Layers, Compass } from 'lucide-react'
import { setMonthlyExpensesAction, approveLadderSetupAction, type LadderView } from '@/lib/actions/ladder'
import { CORE_FUNDS } from '@/lib/config/product-defaults'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-orange-500/15 text-orange-300'}`}>
      {ok ? '✓ ' : '! '}{text}
    </span>
  )
}

export function LadderPanel({ view }: { view: LadderView }) {
  const router = useRouter()
  const { ladder, setup } = view
  const [expenses, setExpenses] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const saveExpenses = () => start(async () => {
    setError(null)
    const res = await setMonthlyExpensesAction(Number(expenses))
    if (!res.ok) setError(res.error ?? 'Could not save')
    else router.refresh()
  })

  const approveSetup = () => start(async () => {
    if (!setup) return
    setError(null)
    const res = await approveLadderSetupAction(setup.summary)
    if (!res.ok) setError(res.error ?? 'Could not set up your ladder')
    else router.refresh()
  })

  const t1 = ladder.tier1
  const stockPct = Math.round(ladder.core.stockShare * 100)

  return (
    <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5" aria-labelledby="ladder-heading">
      <h2 id="ladder-heading" className="text-base font-semibold text-text-0">Your money ladder</h2>
      <p className="mt-1 text-xs text-text-1">
        Filled in order: safety first, then long-term investing, then a small capped slice for strategies.
      </p>

      <ol className="mt-4 space-y-3">
        {/* Tier 1 */}
        <li className="rounded-xl border border-line-strong p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-0">
              <ShieldCheck className="h-4 w-4 text-accent-cyan" aria-hidden /> 1 · Safety
            </span>
            {t1.status === 'funded' && <Status ok text="Funded" />}
            {t1.status === 'short' && <Status ok={false} text={`${usd(t1.shortfallUsd)} short`} />}
            {t1.status === 'needs_expenses' && <Status ok={false} text="Needs your expenses" />}
          </div>
          <p className="mt-2 font-mono text-lg text-text-0">
            {usd(t1.heldUsd)}{t1.targetUsd != null && <span className="text-sm text-text-1"> of {usd(t1.targetUsd)}</span>}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-1">
            Cash-like money ({CORE_FUNDS.cashLike}) for emergencies
            {t1.emergencyUsd != null ? ` — ${usd(t1.emergencyUsd)} covers 6 months of essentials` : ''}
            {t1.shortGoals.length > 0 ? `, plus ${usd(t1.shortGoalsUsd)} for goals due within 2 years (${t1.shortGoals.map(g => g.name).join(', ')})` : ''}.
          </p>

          {t1.status === 'needs_expenses' && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-text-1">
                Essential monthly expenses
                <input
                  type="number" min={0} inputMode="numeric" value={expenses}
                  onChange={e => setExpenses(e.target.value)}
                  placeholder="3000"
                  className="mt-1 block w-36 rounded-lg border border-line-strong bg-white/5 px-3 py-2 text-sm text-text-0"
                />
              </label>
              <button
                onClick={saveExpenses}
                disabled={pending || expenses === '' || Number(expenses) < 0}
                className="min-h-[40px] rounded-lg bg-accent-cyan px-4 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          )}

          {setup && (
            <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-300">NEEDS YOUR DECISION</p>
              <p className="mt-1 text-sm text-text-0">{setup.summary}</p>
              <p className="mt-1 text-xs text-text-1">
                Nothing happens until you approve. Until your safety cushion is full, Explore stays at $0.
              </p>
              <button
                onClick={approveSetup}
                disabled={pending}
                className="mt-2 min-h-[40px] rounded-lg bg-accent-cyan px-4 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-40"
              >
                {pending ? 'Setting up…' : 'Approve — set up my ladder'}
              </button>
            </div>
          )}
        </li>

        {/* Tier 2 */}
        <li className="rounded-xl border border-line-strong p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-0">
              <Layers className="h-4 w-4 text-sky-400" aria-hidden /> 2 · Core
            </span>
            <Status ok={t1.funded} text={t1.funded ? 'Invested' : 'Waits for Safety'} />
          </div>
          <p className="mt-2 font-mono text-lg text-text-0">{usd(ladder.core.amountUsd)}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-1">
            Long-term money in broad, low-cost funds: {stockPct}% stocks ({CORE_FUNDS.usStocks} + {CORE_FUNDS.intlStocks}),
            {' '}{100 - stockPct}% bonds ({CORE_FUNDS.bonds}). The stock share steps down as your goals get closer.
          </p>
        </li>

        {/* Tier 3 */}
        <li className="rounded-xl border border-line-strong p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-0">
              <Compass className="h-4 w-4 text-accent-violet" aria-hidden /> 3 · Explore
            </span>
            <Status ok={ladder.explore.open} text={ladder.explore.open ? `${usd(ladder.explore.leftUsd)} left` : 'Paused'} />
          </div>
          <p className="mt-2 font-mono text-lg text-text-0">
            {usd(ladder.explore.inUseUsd)}<span className="text-sm text-text-1"> of {usd(ladder.explore.capUsd)} limit</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-1">
            A small, fenced-off slice ({Math.round(ladder.explore.capFraction * 100)}% of money outside Safety) for strategies and copying.
            {!ladder.explore.open && ' It stays at $0 until your safety cushion is full.'}
          </p>
        </li>
      </ol>

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  )
}
