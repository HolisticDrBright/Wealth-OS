'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { LinkedAccount } from '@/lib/types'

export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('linked_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return data ?? []
}

export async function addLinkedAccount(payload: {
  provider: LinkedAccount['provider']
  account_name?: string
  account_id_external?: string
  is_paper_trading?: boolean
  metadata?: Record<string, unknown>
}): Promise<LinkedAccount | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('linked_accounts')
    .insert({
      user_id: user.id,
      status: 'active',
      currency: 'USD',
      is_paper_trading: false,
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/settings')
  return data
}

export async function removeLinkedAccount(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('linked_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/settings')
}

export async function syncLinkedAccountBalance(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: account } = await supabase
    .from('linked_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!account) return

  let balance_usd: number | null = null

  if (account.provider === 'alpaca') {
    try {
      const base = account.is_paper_trading
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets'
      const res = await fetch(`${base}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
        },
      })
      if (res.ok) {
        const data = await res.json()
        balance_usd = parseFloat(data.portfolio_value ?? data.cash ?? '0')
      }
    } catch { /* ignore */ }
  }

  await supabase
    .from('linked_accounts')
    .update({
      balance_usd,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: balance_usd !== null ? 'active' : 'error',
    })
    .eq('id', id)

  revalidatePath('/settings')
}
