'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { upsertRetirementPlan } from '@/lib/actions/retirement'
import { formatCurrency } from '@/lib/utils'
import type { RetirementPlan } from '@/lib/types'
import type { RetirementSummary } from '@/lib/retirement-calculator'
import type { MonteCarloResult } from '@/lib/retirement/monte-carlo'
import type { WithdrawalYear } from '@/lib/retirement/withdrawal-sequencing'
import { AreaChart, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { CheckCircle2, AlertCircle, TrendingUp, PiggyBank, Brain, Dices, ArrowDownToLine } from 'lucide-react'

interface Props {
  plan: RetirementPlan | null
  summary: RetirementSummary | null
  projection: Array<{ year: number; balance: number; phase: string }>
  monteCarlo: MonteCarloResult | null
  withdrawalFirstYear: WithdrawalYear | null
}

export function RetirementClient({ plan: initialPlan, summary: initialSummary, projection: initialProjection, monteCarlo, withdrawalFirstYear }: Props) {
  const [plan, setPlan] = useState(initialPlan)
  const [summary, setSummary] = useState(initialSummary)
  const [projection, setProjection] = useState(initialProjection)
  const [isSaving, startSave] = useTransition()
  const [advice, setAdvice] = useState(plan?.claude_advice ?? '')
  const [isGettingAdvice, setIsGettingAdvice] = useState(false)

  function updateField(key: keyof RetirementPlan, value: unknown) {
    setPlan(p => p ? { ...p, [key]: value } : p)
  }

  function save() {
    if (!plan) return
    startSave(async () => {
      const updated = await upsertRetirementPlan(plan)
      if (updated) setPlan(updated)
    })
  }

  async function getAdvice() {
    if (!plan) return
    setIsGettingAdvice(true)
    setAdvice('')
    try {
      const res = await fetch('/api/retirement-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break
            try { text += JSON.parse(data).text ?? ''; setAdvice(text) } catch { /* ignore */ }
          }
        }
      }
    } finally {
      setIsGettingAdvice(false)
    }
  }

  const yearsToRetirement = Math.max(0, (plan?.target_retirement_age ?? 65) - (plan?.current_age ?? 35))
  const retirementYear = projection.findIndex(p => p.phase === 'retirement')

  // Monte Carlo derived view data
  const successPct = monteCarlo ? monteCarlo.successProbability * 100 : null
  const successColor = successPct === null
    ? 'text-gray-400'
    : successPct >= 75 ? 'text-emerald-400' : successPct >= 50 ? 'text-amber-400' : 'text-red-400'
  const fanData = monteCarlo?.bands.map(b => ({
    age: b.age,
    outer: [b.p10, b.p90] as [number, number],
    inner: [b.p25, b.p75] as [number, number],
    median: b.p50,
  })) ?? []

  // Withdrawal-order rows for the first retirement year
  const withdrawalRows = withdrawalFirstYear ? [
    { label: '1. Taxable brokerage', sub: 'Long-term capital gains rates', amount: withdrawalFirstYear.fromTaxable },
    {
      label: '2. Traditional 401(k) / IRA',
      sub: withdrawalFirstYear.rmdForced > 0
        ? `Ordinary income — includes ${formatCurrency(withdrawalFirstYear.rmdForced)} forced RMD`
        : 'Ordinary income — RMDs forced from age 73',
      amount: withdrawalFirstYear.fromTraditional,
    },
    { label: '3. Roth IRA', sub: 'Tax-free — preserved last', amount: withdrawalFirstYear.fromRoth },
  ] : []

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Projected Balance', value: formatCurrency(summary.projected_balance), icon: TrendingUp },
            { label: 'Required Nest Egg', value: formatCurrency(summary.required_nest_egg), icon: PiggyBank },
            { label: 'Years to Retire', value: `${summary.years_to_retirement}y`, icon: CheckCircle2 },
            {
              label: 'Status',
              value: summary.on_track ? 'On Track' : 'Off Track',
              icon: summary.on_track ? CheckCircle2 : AlertCircle,
              color: summary.on_track ? 'text-emerald-400' : 'text-red-400',
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${color ?? 'text-indigo-400'}`} />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
                <p className={`text-lg font-bold ${color ?? 'text-white'}`}>{value}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Monte Carlo simulation */}
      {monteCarlo && successPct !== null && (
        <Card>
          <div className="p-6">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Dices className="h-4 w-4 text-indigo-400" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Monte Carlo Simulation</p>
                </div>
                <p className={`text-3xl font-bold ${successColor}`}>{successPct.toFixed(0)}%</p>
                <p className="text-xs text-gray-500 mt-1">
                  Success probability — money lasts to age {monteCarlo.endAge}
                  {monteCarlo.medianDepletionAge !== null && (
                    <span className="text-red-400/70"> · failed paths typically deplete at age {monteCarlo.medianDepletionAge}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {[
                  { label: '10–90th pct', className: 'bg-indigo-500/20' },
                  { label: '25–75th pct', className: 'bg-indigo-500/40' },
                  { label: 'Median', className: 'bg-indigo-400' },
                ].map(({ label, className }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${className}`} />
                    <span className="text-gray-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={fanData}>
                  <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `${v}`} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `$${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    formatter={(value, name) => {
                      if (Array.isArray(value)) {
                        return [`${formatCurrency(Number(value[0]))} – ${formatCurrency(Number(value[1]))}`, name === 'outer' ? '10–90th pct' : '25–75th pct']
                      }
                      return [formatCurrency(Number(value)), 'Median']
                    }}
                    labelFormatter={v => `Age ${v}`}
                  />
                  {plan && (
                    <ReferenceLine x={plan.target_retirement_age} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Retire', fill: '#f59e0b', fontSize: 11 }} />
                  )}
                  <Area type="monotone" dataKey="outer" stroke="none" fill="#6366f1" fillOpacity={0.15} activeDot={false} />
                  <Area type="monotone" dataKey="inner" stroke="none" fill="#6366f1" fillOpacity={0.3} activeDot={false} />
                  <Line type="monotone" dataKey="median" stroke="#818cf8" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Based on {monteCarlo.paths.toLocaleString()} simulated market paths · returns N({plan?.expected_return_pct ?? 7}%, {monteCarlo.returnStdevPct}%) · inflation N(3%, 1%)
            </p>
          </div>
        </Card>
      )}

      {/* Withdrawal order (first retirement year) */}
      {withdrawalFirstYear && (
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownToLine className="h-4 w-4 text-indigo-400" />
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Withdrawal Order</p>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Tax-optimized sequencing for your first retirement year (age {withdrawalFirstYear.age})
            </p>
            <div className="space-y-3">
              {withdrawalRows.map(({ label, sub, amount }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white">{label}</p>
                    <p className="text-xs text-gray-500">{sub}</p>
                  </div>
                  <p className={`text-sm font-semibold ${amount > 0 ? 'text-white' : 'text-gray-600'}`}>
                    {formatCurrency(amount)}
                  </p>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3">
                <p className="text-xs text-gray-500">Estimated tax (22% ordinary / 15% LTCG assumed)</p>
                <p className="text-sm font-semibold text-amber-400">{formatCurrency(withdrawalFirstYear.estimatedTax)}</p>
              </div>
              {withdrawalFirstYear.shortfall > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-red-400">Unfunded need in year one</p>
                  <p className="text-sm font-semibold text-red-400">{formatCurrency(withdrawalFirstYear.shortfall)}</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Deterministic projection chart (secondary view) */}
      {projection.length > 0 && (
        <Card>
          <div className="p-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Deterministic Projection (fixed {plan?.expected_return_pct ?? 7}% return)</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection}>
                  <defs>
                    <linearGradient id="retirementGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="year" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `Yr ${v}`} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `$${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    formatter={(value) => [formatCurrency(Number(value)), 'Balance']}
                    labelFormatter={v => `Year ${v}`}
                  />
                  {retirementYear > 0 && (
                    <ReferenceLine x={retirementYear} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Retire', fill: '#f59e0b', fontSize: 11 }} />
                  )}
                  <Area type="monotone" dataKey="balance" stroke="#6366f1" fill="url(#retirementGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* Plan inputs */}
      <Card>
        <div className="p-6 space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Your Plan</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Input label="Current age" type="number" value={plan?.current_age ?? ''} onChange={e => updateField('current_age', Number(e.target.value))} />
            <Input label="Retire at age" type="number" value={plan?.target_retirement_age ?? 65} onChange={e => updateField('target_retirement_age', Number(e.target.value))} />
            <Input label="Current savings ($)" type="number" value={plan?.current_savings_usd ?? 0} onChange={e => updateField('current_savings_usd', Number(e.target.value))} />
            <Input label="Annual contribution ($)" type="number" value={plan?.annual_contribution_usd ?? 0} onChange={e => updateField('annual_contribution_usd', Number(e.target.value))} />
            <Input label="Expected return (%)" type="number" step="0.1" value={plan?.expected_return_pct ?? 7} onChange={e => updateField('expected_return_pct', Number(e.target.value))} />
            <Input label="Target monthly income ($)" type="number" value={plan?.target_monthly_income_usd ?? ''} onChange={e => updateField('target_monthly_income_usd', Number(e.target.value))} placeholder="e.g. 5000" />
            <Input label="Social Security/mo ($)" type="number" value={plan?.social_security_monthly_usd ?? 0} onChange={e => updateField('social_security_monthly_usd', Number(e.target.value))} />
            <Input label="401(k) balance ($)" type="number" value={plan?.k401_balance_usd ?? 0} onChange={e => updateField('k401_balance_usd', Number(e.target.value))} />
            <Input label="IRA balance ($)" type="number" value={plan?.ira_balance_usd ?? 0} onChange={e => updateField('ira_balance_usd', Number(e.target.value))} />
          </div>
          <div className="flex gap-3">
            <Button onClick={save} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Plan'}</Button>
            <Button variant="outline" onClick={getAdvice} disabled={isGettingAdvice}>
              <Brain className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
              {isGettingAdvice ? 'Analyzing...' : 'Get AI Advice'}
            </Button>
          </div>
        </div>
      </Card>

      {/* AI Advice */}
      {(advice || isGettingAdvice) && (
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-4 w-4 text-indigo-400" />
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">AI Retirement Advisor</p>
            </div>
            {isGettingAdvice && !advice && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                Analyzing your retirement plan...
              </div>
            )}
            {advice && (
              <div className="prose prose-invert prose-sm max-w-none">
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{advice}</p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
