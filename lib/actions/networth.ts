'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getNetWorthHistory() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('net_worth_history')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: true })
    .limit(24)

  if (error) {
    console.error('getNetWorthHistory error:', error)
    return []
  }
  return data
}

export async function snapshotNetWorth(totalAssets: number, totalLiabilities: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const month = new Date().toISOString().slice(0, 7) // YYYY-MM

  const { error } = await supabase.from('net_worth_history').upsert(
    {
      user_id: user.id,
      date: month,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
    },
    { onConflict: 'user_id,date' }
  )

  if (error) return { error: error.message }
  revalidatePath('/dashboard')
  return { success: true }
}
