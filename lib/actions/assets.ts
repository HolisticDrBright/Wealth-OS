'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getAssets() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)
    .order('current_value', { ascending: false })

  if (error) {
    console.error('getAssets error:', error)
    return []
  }
  return data
}

export async function createAsset(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const quantity = formData.get('quantity') ? Number(formData.get('quantity')) : null
  const purchasePrice = formData.get('purchase_price') ? Number(formData.get('purchase_price')) : null

  const { error } = await supabase.from('assets').insert({
    user_id: user.id,
    name: formData.get('name') as string,
    category: formData.get('category') as string,
    symbol: (formData.get('symbol') as string) || null,
    quantity,
    current_value: Number(formData.get('current_value')),
    purchase_price: purchasePrice,
    purchase_date: (formData.get('purchase_date') as string) || null,
    notes: (formData.get('notes') as string) || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/portfolio')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateAsset(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const quantity = formData.get('quantity') ? Number(formData.get('quantity')) : null
  const purchasePrice = formData.get('purchase_price') ? Number(formData.get('purchase_price')) : null

  const { error } = await supabase
    .from('assets')
    .update({
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      symbol: (formData.get('symbol') as string) || null,
      quantity,
      current_value: Number(formData.get('current_value')),
      purchase_price: purchasePrice,
      purchase_date: (formData.get('purchase_date') as string) || null,
      notes: (formData.get('notes') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/portfolio')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteAsset(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('assets')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/portfolio')
  revalidatePath('/dashboard')
  return { success: true }
}
