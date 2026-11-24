'use client'

/**
 * "Your best next dollar" (roadmap #1) on the Simple Home screen. Shows ONE
 * thing: the highest-ranked question we still need answered, or the
 * recommendation once we know enough. Plus the "save part of your raise"
 * prompt (roadmap #6) and a quiet "my income changed" link. Nothing here
 * moves money.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import type { NextDollarView } from '@/lib/advisory/next-dollar-data'
import {
  answerNextDollarAction, skipNextDollarAction, updateIncomeAction, resolveRaiseAction,
} from '@/lib/actions/next-dollar'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

const btn = 'min-h-[40px] rounded-lg px-4 text-sm font-semibold disabled:opacity-40'
const primary = `${btn} bg-accent-cyan text-bg-0 hover:brightness-110`
const secondary = `${btn} border border-line-strong text-text-0 hover:bg-white/5`
const input = 'mt-1 block w-40 rounded-lg border border-line-strong bg-white/5 px-3 py-2 text-sm text-text-0'

export function NextDollarCard({ view }: { view: NextDollarView }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [debtYes, setDebtYes] = useState(false)
  const [balance, setBalance] = useState('')
  const [apr, setApr] = useState('')
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [income, setIncome] = useState('')

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setError(null)
    const res = await fn()
    if (!res.ok) { setError(res.error ?? 'Something went wrong — nothing was changed.'); return }
    setAmount(''); setBalance(''); setApr(''); setDebtYes(false); setIncome(''); setIncomeOpen(false)
    router.refresh()
  })

  const { card, raise } = view

  return (
    <section aria-labelledby="next-dollar-heading" className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-5">
      <h2 id="next-dollar-heading" className="flex items-center gap-2 text-[15px] font-semibold text-text-0">
        <Sparkles className="h-4 w-4 text-accent-cyan" aria-hidden /> Your best next dollar
      </h2>

      {card.kind === 'question' ? (
        <div className="mt-3">
          <p className="text-[15px] text-text-0">{card.question.prompt}</p>
          {card.question.help && <p className="mt-1 text-[13px] text-text-1">{card.question.help}</p>}
          <p className="mt-1 text-xs text-text-1">Why we ask now: {card.why}</p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            {card.question.input === 'number' && (
              <>
                <label className="text-xs text-text-1">
                  Amount in dollars
                  <input
                    type="number" min={0} inputMode="numeric" value={amount}
                    onChange={e => setAmount(e.target.value)} className={input}
                  />
                </label>
                <button
                  className={primary} disabled={pending || amount === '' || !(Number(amount) >= 0)}
                  onClick={() => run(() => answerNextDollarAction({ fact: card.fact, amount: Number(amount) }))}
                >Save</button>
              </>
            )}

            {card.question.input === 'choice' && card.question.choices?.map(c => (
              <button
                key={c.value} className={secondary} disabled={pending}
                onClick={() => run(() => answerNextDollarAction({ fact: card.fact, choice: c.value }))}
              >{c.label}</button>
            ))}

            {card.question.input === 'debt' && !debtYes && (
              <>
                <button className={secondary} disabled={pending} onClick={() => setDebtYes(true)}>Yes</button>
                <button
                  className={secondary} disabled={pending}
                  onClick={() => run(() => answerNextDollarAction({ fact: 'debts', none: true }))}
                >No</button>
              </>
            )}
            {card.question.input === 'debt' && debtYes && (
              <>
                <label className="text-xs text-text-1">
                  Balance owed ($)
                  <input type="number" min={1} inputMode="numeric" value={balance} onChange={e => setBalance(e.target.value)} className={input} />
                </label>
                <label className="text-xs text-text-1">
                  Interest rate (%)
                  <input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={apr} onChange={e => setApr(e.target.value)} className={input} />
                </label>
                <button
                  className={primary}
                  disabled={pending || !(Number(balance) > 0) || apr === '' || !(Number(apr) >= 0)}
                  onClick={() => run(() => answerNextDollarAction({ fact: 'debts', balanceUsd: Number(balance), aprPct: Number(apr) }))}
                >Save</button>
              </>
            )}

            <button
              className="min-h-[40px] px-2 text-sm text-text-1 underline disabled:opacity-40" disabled={pending}
              onClick={() => run(() => skipNextDollarAction(card.fact))}
            >{card.question.skipLabel}</button>
          </div>
          <p className="mt-2 text-xs text-text-1">
            {card.progress.answered} of {card.progress.total} answered. One question at a time — each one sharpens the advice.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-lg font-semibold text-text-0">{card.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-text-1">{card.body}</p>
          {card.skippedChecks.length > 0 && (
            <p className="mt-2 text-xs text-text-1">
              We couldn&apos;t check {card.skippedChecks.join(', ')} yet — answer those on your <Link href="/advisor" className="underline">Goals</Link> page when you can.
            </p>
          )}
          {card.action === 'add_money' && (
            <Link href="/advisor" className={`${primary} mt-3 inline-flex items-center`}>Add money</Link>
          )}
        </div>
      )}

      {raise && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
          <p className="text-xs font-semibold tracking-wide text-emerald-300">YOU GOT A RAISE</p>
          <p className="mt-1 text-sm text-text-0">
            Your income went up by about {usd(raise.raiseUsd)} a year. Saving half of what reaches your paycheck would add{' '}
            {usd(raise.increaseUsd)} a month to &ldquo;{raise.goalName}&rdquo; — from {usd(raise.currentMonthlyUsd)} to {usd(raise.suggestedMonthlyUsd)}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={primary} disabled={pending} onClick={() => run(() => resolveRaiseAction(true))}>
              Raise my deposit to {usd(raise.suggestedMonthlyUsd)}
            </button>
            <button className={secondary} disabled={pending} onClick={() => run(() => resolveRaiseAction(false))}>Not now</button>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-text-1">
        {incomeOpen ? (
          <div className="flex flex-wrap items-end gap-2">
            <label>
              Household income per year, before tax ($)
              <input type="number" min={0} inputMode="numeric" value={income} onChange={e => setIncome(e.target.value)} className={input} />
            </label>
            <button className={secondary} disabled={pending || income === '' || !(Number(income) >= 0)}
              onClick={() => run(() => updateIncomeAction(Number(income)))}>Save</button>
            <button className="min-h-[40px] px-2 underline" onClick={() => setIncomeOpen(false)}>Cancel</button>
          </div>
        ) : (
          <button className="underline" onClick={() => setIncomeOpen(true)}>Income changed? Update it</button>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      <p className="mt-3 text-xs text-text-1">{view.disclaimer}</p>
    </section>
  )
}
