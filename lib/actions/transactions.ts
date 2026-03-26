'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getTransactions(month?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (month) {
    query = query.gte('date', `${month}-01`).lte('date', `${month}-31`)
  }

  const { data, error } = await query.limit(100)
  if (error) {
    console.error('getTransactions error:', error)
    return []
  }
  return data
}

export async function createTransaction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('transactions').insert({
    user_id: user.id,
    date: formData.get('date') as string,
    description: formData.get('description') as string,
    amount: Number(formData.get('amount')),
    category: formData.get('category') as string,
    type: formData.get('type') as string,
    account: (formData.get('account') as string) || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/budget')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteTransaction(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/budget')
  revalidatePath('/dashboard')
  return { success: true }
}
