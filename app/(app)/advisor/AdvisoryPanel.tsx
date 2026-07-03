'use client'

/**
 * Advisory recommendation cards (UI brief widget 9 + advisory module brief).
 *
 * Ranked by estimated annual benefit; every card carries the education
 * disclaimer + CPA CTA, a "Show the math" expander with the rule's computed
 * numbers, and the status lifecycle New → Reviewing → In progress → Done /
 * Dismissed (with reason). Missing profile fields render as "answer N
 * questions to unlock".
 */

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Calculator, CalendarClock, ShieldAlert, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateAdvisoryStatus, upsertFinancialProfile, type AdvisoryView, type ProviderOption } from '@/lib/actions/advisory'
import type { Recommendation, RuleVerdict, FinancialProfile } from '@/lib/advisory/types'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

const STATUS_FLOW = ['new', 'reviewing', 'in_progress', 'done'] as const
const STATUS_LABEL: Record<string, string> = {
  new: 'New', reviewing: 'Reviewing', in_progress: 'In progress', done: 'Done', dismissed: 'Dismissed',
}

const RULE_PROVIDER_CATEGORIES: Record<string, string[]> = {
  r3_emergency_fund: ['hysa', 'tbill'],
  r7_business_banking: ['business_checking', 'business_card', 'bookkeeping'],
}

/** R3b: read-only rule context injected into the existing portfolio chat. */
function DiscussWithAI({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    if (!question.trim() || busy) return
    setBusy(true); setAnswer('')
    const context =
      `READ-ONLY CONTEXT (computed by the advisory rules engine — do not alter these numbers):\n` +
      `Recommendation: ${rec.title}\nRationale: ${rec.rationale}\n` +
      rec.math.map(m => `${m.label} = ${m.formula} → $${Math.round(m.valueUsd)}`).join('\n') +
      `\nCounter-indications: ${rec.counterIndications.join('; ')}\n\nUser question: ${question}`
    try {
      const res = await fetch('/api/portfolio-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: context }),
      })
      const text = await res.text()
      setAnswer(text || 'No response.')
    } catch {
      setAnswer('Chat unavailable.')
    } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-indigo-300 hover:bg-white/5">
        <MessageCircle className="h-3 w-3" /> Discuss with the AI
      </button>
      {open && (
        <div className="mt-2 w-full rounded-lg bg-black/30 p-2.5">
          <div className="flex gap-1.5">
            <input value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
              placeholder="Ask about this recommendation…"
              className="flex-1 rounded border border-white/10 bg-transparent px-2 py-1 text-[11px] text-gray-200" />
            <button onClick={ask} disabled={busy}
              className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
              {busy ? '…' : 'Ask'}
            </button>
          </div>
          {answer && <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-300">{answer}</p>}
          <p className="mt-1 text-[10px] text-gray-600">The AI explains the rule’s computed numbers — it never recomputes them.</p>
        </div>
      )}
    </>
  )
}

function RecommendationCard({
  rec, status, logId, yields, providers, onStatus,
}: {
  rec: Recommendation
  status: string
  logId: string | null
  yields: AdvisoryView['yields']
  providers: ProviderOption[]
  onStatus: (logId: string, status: string, reason?: string) => void
}) {
  const [showMath, setShowMath] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [dismissReason, setDismissReason] = useState('')

  const isEmergencyFund = rec.ruleId === 'r3_emergency_fund'
  const nextStatus = STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(status as typeof STATUS_FLOW[number]) + 1, STATUS_FLOW.length - 1)]

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{rec.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{rec.rationale}</p>
        </div>
        {rec.estimatedAnnualBenefitUsd != null && (
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums text-emerald-400">
              {usd(rec.estimatedAnnualBenefitUsd)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-600">est. / year</div>
          </div>
        )}
      </div>

      {isEmergencyFund && yields && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {yields.savingsNationalAvgPct != null && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-gray-300">
              Savings nat’l avg {yields.savingsNationalAvgPct.toFixed(2)}%
            </span>
          )}
          {yields.tbill3moPct != null && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-gray-300">
              T-bills ≈{yields.tbill3moPct.toFixed(2)}% (state-tax-free)
            </span>
          )}
          <span className="text-gray-600">live {new Date(yields.fetchedAt).toLocaleDateString()}</span>
        </div>
      )}

      {rec.deadline && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
          <CalendarClock className="h-3.5 w-3.5" /> Deadline: {rec.deadline}
        </p>
      )}

      <ul className="mt-3 space-y-1 text-xs text-gray-300">
        {rec.actionSteps.map((s, i) => (
          <li key={i} className="flex gap-2"><span className="text-indigo-400">{i + 1}.</span>{s}</li>
        ))}
      </ul>

      {rec.math.length > 0 && (
        <button
          onClick={() => setShowMath(v => !v)}
          className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
        >
          <Calculator className="h-3.5 w-3.5" />
          {showMath ? 'Hide the math' : 'Show the math'}
          {showMath ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
      {showMath && (
        <div className="mt-2 space-y-1 rounded-lg bg-black/30 p-3 font-mono text-[11px]">
          {rec.math.map((m, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-gray-500">{m.label} <span className="text-gray-700">= {m.formula}</span></span>
              <span className={cn('tabular-nums', m.valueUsd < 0 ? 'text-red-400' : 'text-gray-200')}>
                {m.valueUsd < 0 ? `−${usd(-m.valueUsd)}` : usd(m.valueUsd)}
              </span>
            </div>
          ))}
        </div>
      )}

      {rec.counterIndications.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
            <ShieldAlert className="h-3 w-3" /> Verify with your CPA
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/70">
            {rec.counterIndications.map((ci, i) => <li key={i}>• {ci}</li>)}
          </ul>
        </div>
      )}

      {providers.length > 0 && (
        <div className="mt-3 rounded-lg bg-white/[0.03] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">
            Current options (refreshed {new Date(providers[0].refreshedAt).toLocaleDateString()} — not endorsements)
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-gray-300">
            {providers.map(o => (
              <li key={`${o.category}-${o.name}`}>
                • {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">{o.name}</a> : o.name}
                {o.note && <span className="text-gray-500"> — {o.note}</span>}
                <span className="ml-1 text-gray-600">[{o.category}]</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DiscussWithAI rec={rec} />
        <span className={cn(
          'rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
          status === 'done' ? 'bg-emerald-500/20 text-emerald-400'
          : status === 'in_progress' ? 'bg-indigo-500/20 text-indigo-300'
          : status === 'reviewing' ? 'bg-amber-500/20 text-amber-300'
          : 'bg-white/10 text-gray-400',
        )}>
          {STATUS_LABEL[status] ?? status}
        </span>
        {logId && status !== 'done' && (
          <button
            onClick={() => onStatus(logId, nextStatus)}
            className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-white/5"
          >
            Mark {STATUS_LABEL[nextStatus].toLowerCase()}
          </button>
        )}
        {logId && !dismissing && status !== 'done' && (
          <button
            onClick={() => setDismissing(true)}
            className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-white/5"
          >
            Dismiss
          </button>
        )}
        {logId && dismissing && (
          <span className="flex items-center gap-1.5">
            <input
              value={dismissReason}
              onChange={e => setDismissReason(e.target.value)}
              placeholder="reason (required)"
              className="w-40 rounded border border-white/10 bg-transparent px-2 py-0.5 text-[11px] text-gray-300"
            />
            <button
              disabled={!dismissReason.trim()}
              onClick={() => onStatus(logId, 'dismissed', dismissReason.trim())}
              className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-gray-300 disabled:opacity-40"
            >
              Confirm
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Profile onboarding (the "answer N questions" flow) ────────────────────────

const PROFILE_FIELDS: Array<{ key: keyof FinancialProfile; label: string; type: 'number' | 'select' | 'boolean'; options?: string[] }> = [
  { key: 'filing_status', label: 'Filing status', type: 'select', options: ['single', 'mfj', 'mfs', 'hoh'] },
  { key: 'age_self', label: 'Your age', type: 'number' },
  { key: 'state', label: 'State (e.g. CA)', type: 'select', options: ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'] },
  { key: 'business_entity', label: 'Business entity', type: 'select', options: ['none', 'sole_prop', 'llc', 'llc_scorp', 'scorp', 'ccorp', 'partnership'] },
  { key: 'net_business_profit_usd', label: 'Net business profit ($/yr)', type: 'number' },
  { key: 'w2_wages_usd', label: 'W-2 wages ($/yr)', type: 'number' },
  { key: 'prior_year_wages_usd', label: 'Prior-year wages ($)', type: 'number' },
  { key: 'magi_estimate_usd', label: 'MAGI estimate ($)', type: 'number' },
  { key: 'health_plan_type', label: 'Health plan', type: 'select', options: ['hdhp', 'ppo', 'hmo', 'none', 'other'] },
  { key: 'monthly_essential_expenses_usd', label: 'Essential expenses ($/mo)', type: 'number' },
  { key: 'liquid_cash_usd', label: 'Liquid cash ($)', type: 'number' },
  { key: 'income_stability', label: 'Income stability', type: 'select', options: ['stable_w2', 'variable', 'self_employed'] },
  { key: 'has_employees', label: 'Business has employees?', type: 'boolean' },
  { key: 'spouse_only_employee', label: 'Only employee is spouse?', type: 'boolean' },
  { key: 'traditional_ira_balance_usd', label: 'Pre-tax IRA balance ($)', type: 'number' },
  { key: 'ytd_401k_employee_usd', label: '401(k) deferred YTD ($)', type: 'number' },
  { key: 'ytd_ira_contribution_usd', label: 'IRA contributed YTD ($)', type: 'number' },
  { key: 'ytd_hsa_contribution_usd', label: 'HSA contributed YTD ($)', type: 'number' },
  { key: 'has_separate_business_bank', label: 'Separate business bank?', type: 'boolean' },
  { key: 'home_office_sqft', label: 'Home office (sqft)', type: 'number' },
  { key: 'business_miles_annual', label: 'Business miles / yr', type: 'number' },
]

function ProfileForm({ profile, onSaved }: { profile: FinancialProfile; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const save = () => {
    const payload: Record<string, unknown> = {}
    for (const f of PROFILE_FIELDS) {
      const v = draft[f.key]
      if (v === undefined || v === '') continue
      payload[f.key] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? v === 'true' : v
    }
    startTransition(async () => {
      await upsertFinancialProfile(payload)
      onSaved()
    })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="text-sm font-semibold text-white">Financial profile</h3>
      <p className="mt-1 text-xs text-gray-500">
        Each answer unlocks analyses — rules state exactly which fields they need.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        {PROFILE_FIELDS.map(f => {
          const current = profile[f.key]
          return (
            <label key={f.key} className="text-[11px] text-gray-500">
              {f.label}
              {f.type === 'select' || f.type === 'boolean' ? (
                <select
                  defaultValue={current == null ? '' : String(current)}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-white/10 bg-[#0b0d13] px-2 py-1 text-xs text-gray-200"
                >
                  <option value="">—</option>
                  {(f.type === 'boolean' ? ['true', 'false'] : f.options!).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  defaultValue={current == null ? '' : String(current)}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-white/10 bg-[#0b0d13] px-2 py-1 text-xs text-gray-200"
                />
              )}
            </label>
          )
        })}
      </div>
      <button
        onClick={save}
        disabled={pending}
        className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save profile'}
      </button>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AdvisoryPanel({ view }: { view: AdvisoryView }) {
  const [showProfile, setShowProfile] = useState(!view.profileComplete)
  const [, startTransition] = useTransition()

  const onStatus = (logId: string, status: string, reason?: string) => {
    startTransition(async () => {
      await updateAdvisoryStatus(logId, status as never, reason)
    })
  }

  const locked = view.verdicts.filter(
    (v): v is Extract<RuleVerdict, { kind: 'not_applicable' }> =>
      v.kind === 'not_applicable' && !!v.missingFields?.length
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Advisory recommendations</h2>
          <p className="text-[11px] text-gray-500">{view.disclaimer}</p>
        </div>
        {view.totalEstimatedAnnualBenefitUsd > 0 && (
          <div className="text-right">
            <div className="text-xl font-bold tabular-nums text-emerald-400">
              {usd(view.totalEstimatedAnnualBenefitUsd)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-600">
              total est. annual benefit — computed from YOUR profile
            </div>
          </div>
        )}
        <button
          onClick={() => setShowProfile(v => !v)}
          className="rounded border border-white/10 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/5"
        >
          {showProfile ? 'Hide profile' : 'Edit profile'}
        </button>
      </div>

      {view.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          Advisory unavailable: {view.error}
        </div>
      )}

      {showProfile && (
        <ProfileForm profile={view.profile} onSaved={() => setShowProfile(false)} />
      )}

      {view.recommendations.map(rec => (
        <RecommendationCard
          key={rec.ruleId}
          rec={rec}
          status={view.statuses[rec.ruleId]?.status ?? 'new'}
          logId={view.statuses[rec.ruleId]?.logId ?? null}
          yields={view.yields}
          providers={view.providerOptions.filter(o =>
            (RULE_PROVIDER_CATEGORIES[rec.ruleId] ?? []).includes(o.category))}
          onStatus={onStatus}
        />
      ))}

      {locked.length > 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-4">
          <p className="text-xs font-medium text-gray-400">Locked analyses</p>
          <ul className="mt-2 space-y-1 text-[11px] text-gray-500">
            {locked.map(v => (
              <li key={v.ruleId}>
                <span className="text-gray-400">{v.ruleId.replace(/_/g, ' ')}:</span> {v.reason}
                {' '}<button onClick={() => setShowProfile(true)} className="text-indigo-400 hover:underline">answer now</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
