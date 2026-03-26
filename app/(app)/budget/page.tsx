'use client'

import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { formatCurrency } from '@/lib/utils'
import { mockBudgets, mockTransactions, spendingByCategory } from '@/lib/mock-data'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react'

const monthlyIncome = mockTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
const monthlyExpenses = mockTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
const totalBudgeted = mockBudgets.reduce((s, b) => s + b.monthly_limit, 0)
const totalSpent = mockBudgets.reduce((s, b) => s + b.spent, 0)

const cashFlowData = [
  { month: 'Oct', income: 9200, expenses: 3800 },
  { month: 'Nov', income: 9400, expenses: 4100 },
  { month: 'Dec', income: 11200, expenses: 5200 },
  { month: 'Jan', income: 9500, expenses: 3900 },
  { month: 'Feb', income: 9700, expenses: 4050 },
  { month: 'Mar', income: monthlyIncome, expenses: monthlyExpenses },
]

export default function BudgetPage() {
  return (
    <div>
      <Topbar title="Budget & Expenses" subtitle="March 2026 — Spending Analysis" />

      <div className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Monthly Income</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">{formatCurrency(monthlyIncome)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-400/70">
              <ArrowUpRight className="h-3 w-3" /> Salary, freelance & dividends
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Expenses</p>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(monthlyExpenses)}</p>
            <p className="mt-1 text-xs text-gray-500">{((monthlyExpenses / monthlyIncome) * 100).toFixed(1)}% of income</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Savings</p>
            <p className="mt-2 text-2xl font-bold text-indigo-400">{formatCurrency(monthlyIncome - monthlyExpenses)}</p>
            <p className="mt-1 text-xs text-indigo-400/70">
              {(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100).toFixed(1)}% savings rate
            </p>
          </Card>
        </div>

        {/* Cash Flow Chart + Budget Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Cash Flow Trend</CardTitle>
              <CardDescription>Income vs. Expenses — last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cashFlowData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    formatter={(value) => [formatCurrency(Number(value)), '']}
                  />
                  <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Income" />
                  <Bar dataKey="expenses" fill="#6366f1" radius={[4, 4, 0, 0]} name="Expenses" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Budget Overview</CardTitle>
              <CardDescription>
                {formatCurrency(totalSpent)} of {formatCurrency(totalBudgeted)} used
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Progress
                  value={totalSpent}
                  max={totalBudgeted}
                  barClassName={totalSpent / totalBudgeted > 0.9 ? 'bg-red-500' : totalSpent / totalBudgeted > 0.75 ? 'bg-amber-500' : 'bg-indigo-500'}
                />
                <p className="mt-2 text-right text-xs text-gray-500">
                  {((totalSpent / totalBudgeted) * 100).toFixed(0)}% of budget used
                </p>
              </div>
              <div className="space-y-3">
                {mockBudgets.slice(0, 6).map((budget) => {
                  const pct = (budget.spent / budget.monthly_limit) * 100
                  const isOver = pct >= 100
                  const isWarning = pct >= 80 && !isOver
                  return (
                    <div key={budget.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {isOver && <AlertTriangle className="h-3 w-3 text-red-400" />}
                          <span className="text-xs text-gray-300">{budget.category}</span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatCurrency(budget.spent)} / {formatCurrency(budget.monthly_limit)}
                        </span>
                      </div>
                      <Progress
                        value={budget.spent}
                        max={budget.monthly_limit}
                        barClassName={isOver ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-indigo-500'}
                      />
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Budget Category Cards */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Budget Categories</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {mockBudgets.map((budget) => {
              const pct = (budget.spent / budget.monthly_limit) * 100
              const remaining = budget.monthly_limit - budget.spent
              const isOver = pct >= 100
              const isWarning = pct >= 80 && !isOver
              return (
                <Card key={budget.id} className={isOver ? 'border-red-500/30' : isWarning ? 'border-amber-500/30' : ''}>
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-sm font-medium text-white">{budget.category}</p>
                    <Badge variant={isOver ? 'danger' : isWarning ? 'warning' : 'default'}>
                      {pct.toFixed(0)}%
                    </Badge>
                  </div>
                  <Progress
                    value={budget.spent}
                    max={budget.monthly_limit}
                    barClassName={isOver ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-indigo-500'}
                  />
                  <div className="mt-3 flex justify-between text-xs">
                    <span className="text-gray-500">Spent: <span className="text-white">{formatCurrency(budget.spent)}</span></span>
                    <span className={remaining < 0 ? 'text-red-400' : 'text-gray-500'}>
                      {remaining < 0 ? `Over by ${formatCurrency(Math.abs(remaining))}` : `${formatCurrency(remaining)} left`}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Transaction List */}
        <Card>
          <CardHeader>
            <CardTitle>All Transactions</CardTitle>
            <CardDescription>March 2026 income and expenses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {mockTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-3 text-gray-500">{tx.date}</td>
                      <td className="py-3 text-white font-medium">{tx.description}</td>
                      <td className="py-3">
                        <Badge>{tx.category}</Badge>
                      </td>
                      <td className={`py-3 text-right font-semibold ${tx.type === 'income' ? 'text-emerald-400' : 'text-white'}`}>
                        {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </td>
                      <td className="py-3 text-right">
                        <Badge variant={tx.type === 'income' ? 'success' : 'default'}>
                          {tx.type === 'income' ? (
                            <ArrowUpRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 mr-1" />
                          )}
                          {tx.type}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
