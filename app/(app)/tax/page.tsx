'use client'

import { useState } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { mockTaxStrategies } from '@/lib/mock-data'
import type { TaxStrategy } from '@/lib/types'
import {
  FileText,
  TrendingDown,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Info,
  DollarSign,
} from 'lucide-react'

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  deduction: FileText,
  credit: CheckCircle2,
  account: DollarSign,
  investment: TrendingDown,
  timing: AlertCircle,
}

const priorityVariants: Record<string, 'danger' | 'warning' | 'info'> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
}

const totalPotentialSavings = mockTaxStrategies.reduce((s, t) => s + t.potential_savings, 0)

function StrategyCard({ strategy }: { strategy: TaxStrategy }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = categoryIcons[strategy.category] ?? Lightbulb

  return (
    <Card className={`transition-all ${strategy.priority === 'high' ? 'border-indigo-500/20' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5">
            <Icon className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-white">{strategy.title}</p>
              <Badge variant={priorityVariants[strategy.priority]}>
                {strategy.priority} priority
              </Badge>
              <Badge variant="success">
                Save {formatCurrency(strategy.potential_savings)}/yr
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-400 leading-relaxed">{strategy.description}</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Action Items</p>
          <ul className="space-y-2">
            {strategy.action_items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm">Mark as Implemented</Button>
            <Button size="sm" variant="outline">Learn More</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function TaxPage() {
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')

  const filtered = filter === 'all'
    ? mockTaxStrategies
    : mockTaxStrategies.filter(s => s.priority === filter)

  const highPriority = mockTaxStrategies.filter(s => s.priority === 'high')
  const highPrioritySavings = highPriority.reduce((s, t) => s + t.potential_savings, 0)

  return (
    <div>
      <Topbar title="Tax Advisor" subtitle="AI-powered strategies to minimize taxes" />

      <div className="p-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Potential Savings</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">{formatCurrency(totalPotentialSavings)}</p>
            <p className="mt-1 text-xs text-gray-500">Per year, if all strategies implemented</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">High Priority Savings</p>
            <p className="mt-2 text-2xl font-bold text-indigo-400">{formatCurrency(highPrioritySavings)}</p>
            <p className="mt-1 text-xs text-gray-500">{highPriority.length} high-priority strategies</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Tax Rate</p>
            <p className="mt-2 text-2xl font-bold text-white">24%</p>
            <p className="mt-1 text-xs text-amber-400">Could be reduced to ~18% with optimization</p>
          </Card>
        </div>

        {/* Alert Banner */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">Tax Year 2026 Deadlines</p>
            <p className="text-xs text-gray-400 mt-1">
              Q1 estimated taxes due <strong className="text-white">April 15, 2026</strong>. IRA contribution deadline for 2025 is <strong className="text-white">April 15, 2026</strong>.
              HSA contribution deadline is also April 15. Act now on high-priority strategies.
            </p>
          </div>
        </div>

        {/* Tax Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>2026 Tax Estimate</CardTitle>
              <CardDescription>Based on your income and deductions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: 'Gross Income', amount: 102000, type: 'neutral' },
                  { label: '401(k) Contributions (current)', amount: -12000, type: 'deduction' },
                  { label: 'Standard Deduction', amount: -14600, type: 'deduction' },
                  { label: 'Adjusted Gross Income', amount: 75400, type: 'total' },
                  { label: 'Federal Income Tax (24% bracket)', amount: -18096, type: 'tax' },
                  { label: 'FICA / Social Security', amount: -7803, type: 'tax' },
                  { label: 'After-Tax Income (estimated)', amount: 49501, type: 'result' },
                ].map(({ label, amount, type }) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between py-2 ${type === 'total' || type === 'result' ? 'border-t border-white/10 pt-3' : ''}`}
                  >
                    <span className={`text-sm ${type === 'total' || type === 'result' ? 'font-semibold text-white' : 'text-gray-400'}`}>
                      {label}
                    </span>
                    <span className={`text-sm font-semibold ${
                      type === 'deduction' ? 'text-emerald-400' :
                      type === 'tax' ? 'text-red-400' :
                      type === 'result' ? 'text-indigo-400' :
                      'text-white'
                    }`}>
                      {amount < 0 ? `-${formatCurrency(Math.abs(amount))}` : formatCurrency(amount)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strategy Summary</CardTitle>
              <CardDescription>By category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(['account', 'deduction', 'investment', 'timing'] as const).map(category => {
                  const strategies = mockTaxStrategies.filter(s => s.category === category)
                  const savings = strategies.reduce((s, t) => s + t.potential_savings, 0)
                  const Icon = categoryIcons[category] ?? Lightbulb
                  const labels: Record<string, string> = {
                    account: 'Tax-Advantaged Accounts',
                    deduction: 'Deductions',
                    investment: 'Investment Strategy',
                    timing: 'Tax Timing',
                    credit: 'Tax Credits',
                  }
                  return (
                    <div key={category} className="flex items-center gap-3 rounded-lg p-3 bg-white/5">
                      <Icon className="h-4 w-4 text-indigo-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">{labels[category]}</p>
                        <p className="text-xs text-gray-500">{strategies.length} strategies</p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-400 shrink-0">
                        {formatCurrency(savings)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Strategies */}
        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Personalized Tax Strategies
            </h2>
            <div className="flex items-center gap-2">
              {(['all', 'high', 'medium', 'low'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-indigo-600 text-white'
                      : 'border border-white/10 text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filtered.map(strategy => (
              <StrategyCard key={strategy.id} strategy={strategy} />
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            These strategies are for educational purposes. Tax laws are complex and change frequently.
            Consult a qualified CPA or tax professional before implementing any tax strategy.
            Individual results will vary based on your specific financial situation.
          </p>
        </div>
      </div>
    </div>
  )
}
