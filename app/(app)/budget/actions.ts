'use server'

import { createClient } from '@/lib/supabase/server'
import { monthKey } from '@/lib/savings/cash-flow'

/**
 * Lightweight transaction rows (date/amount/type) for the last N calendar
 * months, used to build real monthly cash-flow aggregates for the chart.
 */
export async function getCashFlowTransactions(
  months = 6
): Promise<Array<{ date: string; amount: number; type: 'income' | 'expense' }>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const startDate = `${monthKey(new Date(), months - 1)}-01`

    const { data, error } = await supabase
      .from('transactions')
      .select('date, amount, type')
      .eq('user_id', user.id)
      .gte('date', startDate)
      .order('date', { ascending: false })
      .limit(5000)

    if (error) {
      console.error('getCashFlowTransactions error:', error)
      return []
    }
    return data ?? []
  } catch (err) {
    console.error('getCashFlowTransactions error:', err)
    return []
  }
}
