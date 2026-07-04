'use server'

/**
 * Connected-accounts loaders/actions (upgrade item 1). Manual-mode only
 * today — plaid/teller/finicity are architecture stubs with honest status
 * labels. Balances entered here feed the wealth checkup, debt waterfall,
 * and accounts summary.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  summarizeAccounts,
  getAggregationProviders,
  type ConnectedAccount,
  type AccountsSummary,
  type AccountType,
  type AccountProvider,
} from '@/lib/accounts/aggregation'

interface Row {
  id: string
  institution_name: string
  account_name: string | null
  account_type: AccountType
  provider: AccountProvider
  balance_usd: number | null
  apr_pct: number | null
  last_synced_at: string | null
  stale_after: string | null
  sync_error: string | null
  data_quality: ConnectedAccount['dataQuality']
}

function toAccount(r: Row): ConnectedAccount {
  return {
    id: r.id,
    institutionName: r.institution_name,
    accountName: r.account_name,
    accountType: r.account_type,
    provider: r.provider,
    balanceUsd: r.balance_usd,
    aprPct: r.apr_pct,
    lastSyncedAt: r.last_synced_at,
    staleAfter: r.stale_after,
    syncError: r.sync_error,
    dataQuality: r.data_quality,
  }
}

export async function getConnectedAccounts(): Promise<ConnectedAccount[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('connected_account_profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
  return ((data ?? []) as Row[]).map(toAccount)
}

export async function getAccountsSummary(): Promise<AccountsSummary> {
  return summarizeAccounts(await getConnectedAccounts())
}

export interface ProviderStatus {
  id: AccountProvider
  configured: boolean
  status: string
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  return getAggregationProviders().map(p => ({
    id: p.id,
    configured: p.isConfigured(),
    status: p.statusLabel(),
  }))
}

export async function upsertManualAccount(payload: {
  id?: string
  institution_name: string
  account_name?: string
  account_type: AccountType
  balance_usd?: number
  apr_pct?: number
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  const row = {
    user_id: user.id,
    provider: 'manual' as const,
    data_quality: 'manual' as const,
    updated_at: new Date().toISOString(),
    ...payload,
  }
  const { error } = payload.id
    ? await supabase.from('connected_account_profiles').update(row).eq('id', payload.id).eq('user_id', user.id)
    : await supabase.from('connected_account_profiles').insert(row)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/integrations')
  revalidatePath('/advisor')
  return { ok: true }
}
