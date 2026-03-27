'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { upsertRetirementPlan } from '@/lib/actions/retirement'
import { formatCurrency } from '@/lib/utils'
import type { RetirementPlan } from '@/lib/types'
import type { RetirementSummary } from '@/lib/retirement-calculator'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { CheckCircle2, AlertCircle, TrendingUp, PiggyBank, Brain } from 'lucide-react'

interface Props {
  plan: RetirementPlan | null
  summary: RetirementSummary | null
  projection: Array<{ year: number; balance: number; phase: string }>
}

export function RetirementClient({ plan: initialPlan, summary: initialSummary, projection: initialProjection }: Props) {
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

      {/* Projection chart */}
      {projection.length > 0 && (
        <Card>
          <div className="p-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Portfolio Projection</p>
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
