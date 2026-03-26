'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { TransactionForm } from '@/components/forms/transaction-form'
import { BudgetForm } from '@/components/forms/budget-form'
import { formatCurrency } from '@/lib/utils'
import { deleteTransaction } from '@/lib/actions/transactions'
import { deleteBudget } from '@/lib/actions/budgets'
import type { Transaction, Budget } from '@/lib/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { ArrowUpRight, ArrowDownRight, AlertTriangle, Plus, Trash2, PlusCircle, Info } from 'lucide-react'

interface Props {
  transactions: Transaction[]
  budgets: Budget[]
  currentMonth: string
  isDemo: boolean
}

const cashFlowMonths = [
  { month: 'Oct', income: 9200, expenses: 3800 },
  { month: 'Nov', income: 9400, expenses: 4100 },
  { month: 'Dec', income: 11200, expenses: 5200 },
  { month: 'Jan', income: 9500, expenses: 3900 },
  { month: 'Feb', income: 9700, expenses: 4050 },
]

export function BudgetClient({ transactions, budgets, currentMonth, isDemo }: Props) {
  const [showTxForm, setShowTxForm] = useState(false)
  const [showBudgetForm, setShowBudgetForm] = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
  const [isPending, startTransition] = useTransition()

  const monthlyIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const monthlyExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalBudgeted = budgets.reduce((s, b) => s + b.monthly_limit, 0)
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0)

  const cashFlowData = [
    ...cashFlowMonths,
    { month: 'Mar', income: monthlyIncome, expenses: monthlyExpenses },
  ]

  function handleDeleteTx(id: string) {
    if (!confirm('Delete this transaction?')) return
    startTransition(async () => { await deleteTransaction(id) })
  }

  function handleDeleteBudget(id: string) {
    if (!confirm('Delete this budget category?')) return
    startTransition(async () => { await deleteBudget(id) })
  }

  return (
    <div className="p-6 space-y-6">
      {isDemo && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            Showing <strong className="text-indigo-400">demo data</strong>. Add your income and expenses to track real spending.
          </p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Monthly Income</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">{formatCurrency(monthlyIncome)}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-emerald-400/70">
            <ArrowUpRight className="h-3 w-3" /> {transactions.filter(t => t.type === 'income').length} income entries
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Expenses</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(monthlyExpenses)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {monthlyIncome > 0 ? ((monthlyExpenses / monthlyIncome) * 100).toFixed(1) : 0}% of income
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Savings</p>
          <p className={`mt-2 text-2xl font-bold ${monthlyIncome - monthlyExpenses >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>
            {formatCurrency(monthlyIncome - monthlyExpenses)}
          </p>
          <p className="mt-1 text-xs text-indigo-400/70">
            {monthlyIncome > 0 ? (((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100).toFixed(1) : 0}% savings rate
          </p>
        </Card>
      </div>

      {/* Cash Flow + Budget Overview */}
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Budget Overview</CardTitle>
                <CardDescription>
                  {formatCurrency(totalSpent)} of {formatCurrency(totalBudgeted)} used
                </CardDescription>
              </div>
              <button
                onClick={() => { setEditingBudget(null); setShowBudgetForm(true) }}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {budgets.length > 0 ? (
              <>
                <div className="mb-4">
                  <Progress
                    value={totalSpent}
                    max={totalBudgeted || 1}
                    barClassName={totalSpent / (totalBudgeted || 1) > 0.9 ? 'bg-red-500' : totalSpent / (totalBudgeted || 1) > 0.75 ? 'bg-amber-500' : 'bg-indigo-500'}
                  />
                  <p className="mt-2 text-right text-xs text-gray-500">
                    {totalBudgeted > 0 ? ((totalSpent / totalBudgeted) * 100).toFixed(0) : 0}% of budget used
                  </p>
                </div>
                <div className="space-y-3">
                  {budgets.slice(0, 6).map((budget) => {
                    const pct = budget.monthly_limit > 0 ? (budget.spent / budget.monthly_limit) * 100 : 0
                    return (
                      <div key={budget.id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            {pct >= 100 && <AlertTriangle className="h-3 w-3 text-red-400" />}
                            <span className="text-xs text-gray-300">{budget.category}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {formatCurrency(budget.spent)} / {formatCurrency(budget.monthly_limit)}
                          </span>
                        </div>
                        <Progress
                          value={budget.spent}
                          max={budget.monthly_limit}
                          barClassName={pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500 mb-3">No budgets set</p>
                <Button size="sm" onClick={() => setShowBudgetForm(true)}>
                  <PlusCircle className="h-4 w-4" /> Set Budget
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budget Category Cards */}
      {budgets.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Budget Categories</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {budgets.map((budget) => {
              const pct = budget.monthly_limit > 0 ? (budget.spent / budget.monthly_limit) * 100 : 0
              const remaining = budget.monthly_limit - budget.spent
              const isOver = pct >= 100
              const isWarning = pct >= 80 && !isOver
              return (
                <Card key={budget.id} className={isOver ? 'border-red-500/30' : isWarning ? 'border-amber-500/30' : ''}>
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-sm font-medium text-white">{budget.category}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant={isOver ? 'danger' : isWarning ? 'warning' : 'default'}>
                        {pct.toFixed(0)}%
                      </Badge>
                      <button
                        onClick={() => { setEditingBudget(budget); setShowBudgetForm(true) }}
                        className="h-5 w-5 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <span className="text-xs">✏️</span>
                      </button>
                      <button
                        onClick={() => handleDeleteBudget(budget.id)}
                        disabled={isPending}
                        className="h-5 w-5 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <Progress
                    value={budget.spent}
                    max={budget.monthly_limit}
                    barClassName={isOver ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-indigo-500'}
                  />
                  <div className="mt-3 flex justify-between text-xs">
                    <span className="text-gray-500">Spent: <span className="text-white">{formatCurrency(budget.spent)}</span></span>
                    <span className={remaining < 0 ? 'text-red-400' : 'text-gray-500'}>
                      {remaining < 0 ? `Over ${formatCurrency(Math.abs(remaining))}` : `${formatCurrency(remaining)} left`}
                    </span>
                  </div>
                </Card>
              )
            })}
            <button
              onClick={() => { setEditingBudget(null); setShowBudgetForm(true) }}
              className="rounded-xl border border-dashed border-white/20 p-6 text-center hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-colors group"
            >
              <Plus className="h-5 w-5 text-gray-600 group-hover:text-indigo-400 mx-auto mb-2 transition-colors" />
              <p className="text-xs text-gray-600 group-hover:text-indigo-400 transition-colors">Add Category</p>
            </button>
          </div>
        </div>
      )}

      {/* Transaction List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>{currentMonth} income and expenses</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowTxForm(true)}>
              <Plus className="h-4 w-4" /> Add Transaction
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-gray-500 mb-3">No transactions yet</p>
              <Button size="sm" onClick={() => setShowTxForm(true)}>
                <Plus className="h-4 w-4" /> Add Your First Transaction
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-white/5 transition-colors group">
                      <td className="py-3 text-gray-500">{tx.date}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {tx.type === 'income' ? (
                            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                          )}
                          <span className="text-white font-medium">{tx.description}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge>{tx.category}</Badge>
                      </td>
                      <td className={`py-3 text-right font-semibold ${tx.type === 'income' ? 'text-emerald-400' : 'text-white'}`}>
                        {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteTx(tx.id)}
                          disabled={isPending}
                          className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-all ml-auto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TransactionForm open={showTxForm} onClose={() => setShowTxForm(false)} />
      <BudgetForm
        open={showBudgetForm}
        onClose={() => { setShowBudgetForm(false); setEditingBudget(null) }}
        month={currentMonth}
        existingCategory={editingBudget?.category}
        existingLimit={editingBudget?.monthly_limit}
      />
    </div>
  )
}
