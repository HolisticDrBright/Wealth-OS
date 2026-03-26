'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getBudgets(month: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', month)

  if (error) {
    console.error('getBudgets error:', error)
    return []
  }
  return data
}

export async function upsertBudget(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('budgets').upsert(
    {
      user_id: user.id,
      category: formData.get('category') as string,
      monthly_limit: Number(formData.get('monthly_limit')),
      month: formData.get('month') as string,
    },
    { onConflict: 'user_id,category,month' }
  )

  if (error) return { error: error.message }
  revalidatePath('/budget')
  return { success: true }
}

export async function deleteBudget(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('budgets')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/budget')
  return { success: true }
}
