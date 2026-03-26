import { Topbar } from '@/components/layout/topbar'
import { BudgetClient } from './budget-client'
import { getTransactions } from '@/lib/actions/transactions'
import { getBudgets } from '@/lib/actions/budgets'
import { mockBudgets, mockTransactions } from '@/lib/mock-data'

export default async function BudgetPage() {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [transactionsData, budgetsData] = await Promise.all([
    getTransactions(currentMonth),
    getBudgets(currentMonth),
  ])

  const transactions = transactionsData.length > 0 ? transactionsData : mockTransactions
  const isDemo = transactionsData.length === 0

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
      />
    </div>
  )
}
