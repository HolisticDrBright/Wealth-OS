import { describe, it, expect } from 'vitest'
import { aggregateMonthlyCashFlow, monthKey } from '@/lib/savings/cash-flow'

const NOW = new Date('2026-06-10T12:00:00Z')

describe('monthKey', () => {
  it('formats the current month and walks backward across years', () => {
    expect(monthKey(NOW, 0)).toBe('2026-06')
    expect(monthKey(NOW, 5)).toBe('2026-01')
    expect(monthKey(NOW, 6)).toBe('2025-12')
  })
})

describe('aggregateMonthlyCashFlow', () => {
  it('groups income and expenses by calendar month, oldest first', () => {
    const points = aggregateMonthlyCashFlow(
      [
        { date: '2026-06-01', amount: 9000, type: 'income' },
        { date: '2026-06-05', amount: 1200, type: 'expense' },
        { date: '2026-05-15', amount: 8800, type: 'income' },
        { date: '2026-05-20', amount: 4000, type: 'expense' },
        { date: '2026-05-22', amount: 500, type: 'expense' },
      ],
      { months: 6, now: NOW }
    )

    expect(points).toHaveLength(6)
    expect(points[0].month).toBe('2026-01')
    expect(points.at(-1)!.month).toBe('2026-06')

    const may = points.find(p => p.month === '2026-05')!
    expect(may.income).toBe(8800)
    expect(may.expenses).toBe(4500)
    expect(may.hasData).toBe(true)
    expect(may.label).toBe('May')
  })

  it('marks months with no transactions as hasData=false instead of fabricating values', () => {
    const points = aggregateMonthlyCashFlow(
      [{ date: '2026-06-01', amount: 9000, type: 'income' }],
      { months: 6, now: NOW }
    )
    const empty = points.filter(p => !p.hasData)
    expect(empty).toHaveLength(5)
    for (const p of empty) {
      expect(p.income).toBe(0)
      expect(p.expenses).toBe(0)
    }
    expect(points.at(-1)!.hasData).toBe(true)
  })

  it('ignores transactions outside the window', () => {
    const points = aggregateMonthlyCashFlow(
      [{ date: '2025-06-01', amount: 99999, type: 'income' }],
      { months: 6, now: NOW }
    )
    expect(points.every(p => p.income === 0 && !p.hasData)).toBe(true)
  })

  it('handles an empty transaction list', () => {
    const points = aggregateMonthlyCashFlow([], { months: 6, now: NOW })
    expect(points).toHaveLength(6)
    expect(points.every(p => !p.hasData)).toBe(true)
  })
})
