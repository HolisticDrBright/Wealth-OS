'use client'

/**
 * "Your money ladder" (Phases 2–3) — three rows with dollars, what each tier
 * is for, and whether it is funded. Hosts the ladder actions: monthly
 * expenses, the one-tap setup, adding money, and the Core rebalance decision.
 * Every trade here is practice money and is approved explicitly.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Layers, Compass } from 'lucide-react'
import {
  setMonthlyExpensesAction, approveLadderSetupAction, depositAction, approveCoreRebalanceAction,
  type LadderView,
} from '@/lib/actions/ladder'
import { CORE_FUNDS } from '@/lib/config/product-defaults'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-orange-500/15 text-orange-300'}`}>
      {ok ? '✓ ' : '! '}{text}
    </span>
  )
}

function Decision({ text, cta, pending, onApprove }: { text: string; cta: string; pending: boolean; onApprove: () => void }) {
  return (
    <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
      <p className="text-xs font-semibold tracking-wide text-cyan-300">NEEDS YOUR DECISION</p>
      <p className="mt-1 text-sm text-text-0">{text}</p>
      <p className="mt-1 text-xs text-text-1">Nothing happens until you approve.</p>
      <button
        onClick={onApprove}
        disabled={pending}
        className="mt-2 min-h-[40px] rounded-lg bg-accent-cyan px-4 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-40"
      >
        {pending ? 'Working…' : cta}
      </button>
    </div>
  )
}

export function LadderPanel({ view }: { view: LadderView }) {
  const router = useRouter()
  const { ladder, setup, rebalance } = view
  const [expenses, setExpenses] = useState('')
  const [deposit, setDeposit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string; failures?: string[] }>, okText: string) => start(async () => {
    setError(null); setNotice(null)
    const res = await fn()
    if (res.error) setError(res.error)
    else if (res.failures && res.failures.length) setError(`Some trades didn't go through: ${res.failures.join('; ')}`)
    else setNotice(okText)
    router.refresh()
  })

  const t1 = ladder.tier1
  const stockPct = Math.round(ladder.core.stockShare * 100)

  return (
    <section className="rounded-2xl border border-line-strong bg-white/[0.03] p-5" aria-labelledby="ladder-heading">
      <h2 id="ladder-heading" className="text-base font-semibold text-text-0">Your money ladder</h2>
      <p className="mt-1 text-xs text-text-1">
        Filled in order: safety first, then long-term investing, then a small capped slice for strategies. Practice money.
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
            {usd(t1.amountUsd || t1.heldUsd)}{t1.targetUsd != null && <span className="text-sm text-text-1"> of {usd(t1.targetUsd)}</span>}
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
                onClick={() => run(() => setMonthlyExpensesAction(Number(expenses)), 'Saved.')}
                disabled={pending || expenses === '' || Number(expenses) < 0}
                className="min-h-[40px] rounded-lg bg-accent-cyan px-4 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          )}

          {setup && (
            <Decision
              text={setup.summary}
              cta="Approve — set up my ladder"
              pending={pending}
              onApprove={() => run(() => approveLadderSetupAction(setup.summary), 'Your ladder is set up.')}
            />
          )}
        </li>

        {/* Tier 2 */}
        <li className="rounded-xl border border-line-strong p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-0">
              <Layers className="h-4 w-4 text-sky-400" aria-hidden /> 2 · Core
            </span>
            <Status
              ok={ladder.core.invested && !rebalance}
              text={!ladder.core.invested ? 'Not invested yet' : rebalance ? 'Drifted from plan' : 'Invested'}
            />
          </div>
          <p className="mt-2 font-mono text-lg text-text-0">
            {usd(ladder.core.heldUsd)}<span className="text-sm text-text-1"> of {usd(ladder.core.targetUsd)} target</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-1">
            Long-term money in broad, low-cost funds: {stockPct}% stocks ({CORE_FUNDS.usStocks} + {CORE_FUNDS.intlStocks}),
            {' '}{100 - stockPct}% bonds ({CORE_FUNDS.bonds}). The stock share steps down as your goals get closer.
          </p>
          {ladder.core.invested && (
            <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-text-1 sm:grid-cols-3">
              {ladder.core.funds.map(f => (
                <li key={f.symbol} className="font-mono">{f.symbol}: {usd(f.heldUsd)} / {usd(f.targetUsd)}</li>
              ))}
            </ul>
          )}
          {rebalance && (
            <Decision
              text={rebalance.summary}
              cta="Approve — rebalance my core"
              pending={pending}
              onApprove={() => run(() => approveCoreRebalanceAction(rebalance.summary), 'Core rebalanced.')}
            />
          )}
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

      {/* Add money */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line-strong pt-4">
        <label className="text-xs text-text-1">
          Add practice money (fills Safety first, then Core)
          <input
            type="number" min={1} inputMode="numeric" value={deposit}
            onChange={e => setDeposit(e.target.value)}
            placeholder="500"
            className="mt-1 block w-36 rounded-lg border border-line-strong bg-white/5 px-3 py-2 text-sm text-text-0"
          />
        </label>
        <button
          onClick={() => run(() => depositAction(Number(deposit)), 'Money added.')}
          disabled={pending || !(Number(deposit) > 0)}
          className="min-h-[40px] rounded-lg border border-line-strong px-4 text-sm font-semibold text-text-0 hover:bg-white/5 disabled:opacity-40"
        >
          Add money
        </button>
      </div>

      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  )
}
