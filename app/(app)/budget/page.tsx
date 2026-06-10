import { Topbar } from '@/components/layout/topbar'
import { BudgetClient } from './budget-client'
import { getTransactions } from '@/lib/actions/transactions'
import { getBudgets } from '@/lib/actions/budgets'
import { getAssets } from '@/lib/actions/assets'
import { getCashFlowTransactions } from './actions'
import { aggregateMonthlyCashFlow } from '@/lib/savings/cash-flow'
import { detectIdleCash } from '@/lib/savings/cash-sweep'
import { mockBudgets, mockTransactions } from '@/lib/mock-data'

export default async function BudgetPage() {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [transactionsData, budgetsData, cashFlowTransactions, assets] = await Promise.all([
    getTransactions(currentMonth),
    getBudgets(currentMonth),
    getCashFlowTransactions(6),
    getAssets(),
  ])

  const transactions = transactionsData.length > 0 ? transactionsData : mockTransactions
  const isDemo = transactionsData.length === 0

  // Real monthly aggregates for the cash-flow chart (last 6 months).
  // Months without transactions are flagged hasData=false — no fabricated points.
  const cashFlow = aggregateMonthlyCashFlow(cashFlowTransactions, { months: 6 })

  // Idle cash detection across cash-category assets.
  const idleCash = detectIdleCash(assets)

  // Compute spent per category from real transactions
  const spentByCategory = transactions
    .filter(t => t.type === 'expense')
    .reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount
      return acc
    }, {})

  // Merge budgets with spent amounts
  const budgets = budgetsData.length > 0
    ? budgetsData.map(b => ({ ...b, spent: spentByCategory[b.category] ?? 0 }))
    : mockBudgets

  return (
    <div>
      <Topbar title="Budget & Expenses" subtitle={`${currentMonth} — Spending Analysis`} />
      <BudgetClient
        transactions={transactions}
        budgets={budgets}
        currentMonth={currentMonth}
        isDemo={isDemo}
        cashFlow={cashFlow}
        idleCash={idleCash}
      />
    </div>
  )
}
