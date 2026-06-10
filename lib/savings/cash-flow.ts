/**
 * Monthly cash-flow aggregation from real transactions.
 *
 * Replaces fabricated history points: groups transactions by calendar month
 * and reports an honest `hasData` flag for months with no transactions so
 * the UI can show an empty/partial state instead of made-up numbers.
 */

import type { Transaction } from '@/lib/types'

export interface MonthlyCashFlowPoint {
  /** 'YYYY-MM' */
  month: string
  /** Short label for charts, e.g. 'Oct'. */
  label: string
  income: number
  expenses: number
  /** True if at least one transaction exists in this month. */
  hasData: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** First day of the month `monthsBack` months before `now`, as 'YYYY-MM'. */
export function monthKey(now: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Aggregate transactions into per-month income/expense totals for the last
 * `months` calendar months (oldest first, current month last).
 */
export function aggregateMonthlyCashFlow(
  transactions: Pick<Transaction, 'date' | 'amount' | 'type'>[],
  options: { months?: number; now?: Date } = {}
): MonthlyCashFlowPoint[] {
  const months = options.months ?? 6
  const now = options.now ?? new Date()

  const byMonth = new Map<string, { income: number; expenses: number; count: number }>()
  for (const tx of transactions) {
    if (!tx.date || typeof tx.date !== 'string') continue
    const key = tx.date.slice(0, 7) // 'YYYY-MM'
    const bucket = byMonth.get(key) ?? { income: 0, expenses: 0, count: 0 }
    if (tx.type === 'income') bucket.income += tx.amount
    else if (tx.type === 'expense') bucket.expenses += tx.amount
    bucket.count++
    byMonth.set(key, bucket)
  }

  const points: MonthlyCashFlowPoint[] = []
  for (let back = months - 1; back >= 0; back--) {
    const key = monthKey(now, back)
    const bucket = byMonth.get(key)
    const monthIdx = Number(key.slice(5, 7)) - 1
    points.push({
      month: key,
      label: MONTH_LABELS[monthIdx] ?? key,
      income: Math.round((bucket?.income ?? 0) * 100) / 100,
      expenses: Math.round((bucket?.expenses ?? 0) * 100) / 100,
      hasData: (bucket?.count ?? 0) > 0,
    })
  }
  return points
}
