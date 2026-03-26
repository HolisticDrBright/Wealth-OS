'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getGoals() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', user.id)
    .order('target_date', { ascending: true })

  if (error) {
    console.error('getGoals error:', error)
    return []
  }
  return data
}

export async function createGoal(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('goals').insert({
    user_id: user.id,
    name: formData.get('name') as string,
    target_amount: Number(formData.get('target_amount')),
    current_amount: Number(formData.get('current_amount') || 0),
    target_date: (formData.get('target_date') as string) || null,
    category: formData.get('category') as string,
    notes: (formData.get('notes') as string) || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/planning')
  return { success: true }
}

export async function updateGoal(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('goals')
    .update({
      name: formData.get('name') as string,
      target_amount: Number(formData.get('target_amount')),
      current_amount: Number(formData.get('current_amount') || 0),
      target_date: (formData.get('target_date') as string) || null,
      category: formData.get('category') as string,
      notes: (formData.get('notes') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/planning')
  return { success: true }
}

export async function deleteGoal(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/planning')
  return { success: true }
}
