'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { buildWaterfall } from '@/lib/savings/contribution-waterfall'
import { CheckCircle2, Layers } from 'lucide-react'

interface Props {
  defaultAge?: number
  defaultK401?: number
}

export function ContributionWaterfallCard({ defaultAge = 35, defaultK401 = 0 }: Props) {
  const [age, setAge] = useState(defaultAge)
  const [income, setIncome] = useState(120_000)
  const [employerMatchPct, setEmployerMatchPct] = useState(50)
  const [matchLimitPct, setMatchLimitPct] = useState(6)
  const [k401, setK401] = useState(defaultK401)
  const [hsa, setHsa] = useState(0)
  const [rothIra, setRothIra] = useState(0)
  const [taxable, setTaxable] = useState(0)

  const waterfall = useMemo(
    () => buildWaterfall({
      age, income, employerMatchPct, matchLimitPct,
      currentContributions: { k401, hsa, rothIra, taxable },
    }),
    [age, income, employerMatchPct, matchLimitPct, k401, hsa, rothIra, taxable]
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          <div>
            <CardTitle>Contribution Waterfall</CardTitle>
            <CardDescription>
              Where each savings dollar should go first — 2026 limits{age >= 50 ? ', incl. catch-up' : ''}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
          <Input label="Age" type="number" value={age} onChange={e => setAge(Number(e.target.value))} />
          <Input label="Income ($)" type="number" value={income} onChange={e => setIncome(Number(e.target.value))} />
          <Input label="Match rate (%)" type="number" value={employerMatchPct} onChange={e => setEmployerMatchPct(Number(e.target.value))} />
          <Input label="Match up to (% pay)" type="number" value={matchLimitPct} onChange={e => setMatchLimitPct(Number(e.target.value))} />
          <Input label="401(k)/yr ($)" type="number" value={k401} onChange={e => setK401(Number(e.target.value))} />
          <Input label="HSA/yr ($)" type="number" value={hsa} onChange={e => setHsa(Number(e.target.value))} />
          <Input label="Roth IRA/yr ($)" type="number" value={rothIra} onChange={e => setRothIra(Number(e.target.value))} />
          <Input label="Taxable/yr ($)" type="number" value={taxable} onChange={e => setTaxable(Number(e.target.value))} />
        </div>

        <div className="space-y-4">
          {waterfall.steps.map(step => (
            <div key={step.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {step.complete && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                  <span className="text-xs text-gray-300">{step.order}. {step.label}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {step.id === 'taxable'
                    ? `${formatCurrency(step.current)} — no limit`
                    : `${formatCurrency(step.current)} / ${formatCurrency(step.target)}`}
                </span>
              </div>
              {step.id !== 'taxable' && (
                <Progress
                  value={step.current}
                  max={step.target || 1}
                  barClassName={step.complete ? 'bg-emerald-500' : 'bg-indigo-500'}
                />
              )}
              <p className="mt-1 text-xs text-gray-600">
                {step.gap > 0 && <span className="text-amber-400">{formatCurrency(step.gap)} gap · </span>}
                {step.why}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-3 text-xs">
          <span className="text-gray-500">Total tax-advantaged space remaining</span>
          <span className={`font-semibold ${waterfall.totalGap > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {waterfall.totalGap > 0 ? `${formatCurrency(waterfall.totalGap)} unused` : 'Fully maxed'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
