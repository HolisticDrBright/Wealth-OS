'use server'

/**
 * Web server actions for read-only Plaid linking (roadmap #2). Each one
 * verifies the user from their own session FIRST, then uses the service-role
 * client for the token table (which no user session can read). The access
 * token never reaches the browser — only the short-lived link token does.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { isPlaidConfigured, plaidEnv, PlaidError } from '@/lib/plaid/client'
import {
  createLinkToken, createUpdateLinkToken, exchangePublicToken, syncItem, removeItem, type LinkKind,
} from '@/lib/plaid/service'

export interface PlaidPanelView {
  configured: boolean
  env: 'sandbox' | 'production'
  items: Array<{
    itemId: string
    institutionName: string
    kind: LinkKind
    status: 'active' | 'login_required' | 'error'
    lastSyncedAt: string | null
    lastError: string | null
    accounts: Array<{ name: string; type: string; balanceUsd: number | null; aprPct: number | null }>
  }>
  /** Hand-entered rows that may duplicate linked accounts. */
  manualAssets: number
  manualDebts: number
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function userId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

function friendly(err: unknown): string {
  if (err instanceof PlaidError) return err.displayMessage ?? `Plaid: ${err.message}`
  return err instanceof Error ? err.message : 'Something went wrong'
}

function refresh() {
  revalidatePath('/advisor'); revalidatePath('/dashboard'); revalidatePath('/settings/integrations')
}

export async function getPlaidPanel(): Promise<PlaidPanelView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [itemsRes, accountsRes, manualAssetsRes, manualDebtsRes] = await Promise.all([
    supabase.from('plaid_items').select('item_id, institution_name, link_kind, status, last_synced_at, last_error')
      .eq('user_id', user.id).order('created_at', { ascending: true }),
    supabase.from('connected_account_profiles').select('plaid_item_id, account_name, account_type, balance_usd, apr_pct')
      .eq('user_id', user.id).eq('provider', 'plaid'),
    supabase.from('assets').select('id').eq('user_id', user.id).is('plaid_account_id', null).in('category', ['cash', 'stock']),
    supabase.from('debt_accounts').select('id').eq('user_id', user.id).is('plaid_account_id', null),
  ])
  const accounts = (accountsRes.data ?? []) as Array<{ plaid_item_id: string | null; account_name: string | null; account_type: string; balance_usd: number | null; apr_pct: number | null }>
  return {
    configured: isPlaidConfigured(),
    env: plaidEnv(),
    items: ((itemsRes.data ?? []) as Array<{ item_id: string; institution_name: string | null; link_kind: LinkKind; status: 'active' | 'login_required' | 'error'; last_synced_at: string | null; last_error: string | null }>)
      .map(i => ({
        itemId: i.item_id,
        institutionName: i.institution_name ?? 'Linked institution',
        kind: i.link_kind,
        status: i.status,
        lastSyncedAt: i.last_synced_at,
        lastError: i.last_error,
        accounts: accounts.filter(a => a.plaid_item_id === i.item_id).map(a => ({
          name: a.account_name ?? 'Account', type: a.account_type,
          balanceUsd: a.balance_usd == null ? null : Number(a.balance_usd),
          aprPct: a.apr_pct == null ? null : Number(a.apr_pct),
        })),
      })),
    manualAssets: manualAssetsRes.error ? 0 : (manualAssetsRes.data ?? []).length,
    manualDebts: manualDebtsRes.error ? 0 : (manualDebtsRes.data ?? []).length,
  }
}

export async function createLinkTokenAction(kind: LinkKind): Promise<Result<{ linkToken: string }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'not signed in' }
  if (!isPlaidConfigured()) return { ok: false, error: 'Account linking isn’t set up on this server yet.' }
  if (kind !== 'bank' && kind !== 'investments') return { ok: false, error: 'unknown link type' }
  try {
    return { ok: true, linkToken: await createLinkToken({ userId: uid, kind }) }
  } catch (err) {
    return { ok: false, error: friendly(err) }
  }
}

export async function createUpdateLinkTokenAction(itemId: string): Promise<Result<{ linkToken: string }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'not signed in' }
  try {
    return { ok: true, linkToken: await createUpdateLinkToken(createAdminClient(), uid, itemId) }
  } catch (err) {
    return { ok: false, error: friendly(err) }
  }
}

export async function exchangePublicTokenAction(publicToken: string, kind: LinkKind): Promise<Result<{ accounts: number }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'not signed in' }
  if (!isPlaidConfigured()) return { ok: false, error: 'Account linking isn’t set up on this server yet.' }
  if (typeof publicToken !== 'string' || !publicToken.startsWith('public-')) return { ok: false, error: 'invalid link' }
  try {
    const res = await exchangePublicToken(createAdminClient(), uid, publicToken, kind === 'investments' ? 'investments' : 'bank')
    refresh()
    return res.ok ? { ok: true, accounts: res.accounts } : { ok: false, error: res.error ?? 'linked, but the first sync failed' }
  } catch (err) {
    return { ok: false, error: friendly(err) }
  }
}

export async function syncPlaidItemAction(itemId: string): Promise<Result<{ accounts: number }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'not signed in' }
  try {
    const res = await syncItem(createAdminClient(), uid, itemId)
    refresh()
    return res.ok ? { ok: true, accounts: res.accounts } : { ok: false, error: res.error ?? 'sync failed' }
  } catch (err) {
    return { ok: false, error: friendly(err) }
  }
}

export async function removePlaidItemAction(itemId: string): Promise<Result> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'not signed in' }
  try {
    const res = await removeItem(createAdminClient(), uid, itemId)
    refresh()
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'could not disconnect' }
  } catch (err) {
    return { ok: false, error: friendly(err) }
  }
}
