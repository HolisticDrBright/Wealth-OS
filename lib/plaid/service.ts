/**
 * Plaid account linking (roadmap #2) — server only, READ-ONLY products.
 *
 *   createLinkToken     a short-lived token for Plaid Link in the browser
 *   exchangePublicToken public token → access token (encrypted at rest), first sync
 *   syncItem            balances (+ APRs) → connected_account_profiles, assets, debt_accounts
 *   removeItem          revokes the Item at Plaid and deletes everything it created
 *   syncAllItems        the daily cron refresh
 *
 * `admin` is the service-role client: callers MUST have verified `userId`
 * from the user's own session first. Every query is scoped to that userId.
 * The access token never leaves the server and is never returned to a client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { plaidPost, PlaidError } from '@/lib/plaid/client'
import { encryptToken, decryptToken, TOKEN_KEY_VERSION } from '@/lib/plaid/crypto'
import { aprByAccount, mirrorRows, usable, type PlaidAccount, type PlaidLiabilities } from '@/lib/plaid/mapping'

export type LinkKind = 'bank' | 'investments'

/** Read-only products per link flow (Investments must be in `products`). */
export const LINK_PRODUCTS: Record<LinkKind, { products: string[]; optional_products?: string[] }> = {
  bank: { products: ['transactions'], optional_products: ['liabilities'] },
  investments: { products: ['investments'] },
}

/** Products that could move money — never requested (tested). */
export const FORBIDDEN_PRODUCTS = ['auth', 'transfer', 'payment_initiation', 'signal']

export async function createLinkToken(args: {
  userId: string
  kind: LinkKind
  /** Update mode (re-login) for an existing Item. */
  accessToken?: string
}): Promise<string> {
  const body: Record<string, unknown> = {
    client_name: 'Wealth OS',
    language: 'en',
    country_codes: ['US'],
    // The user's opaque id — never an email or name.
    user: { client_user_id: args.userId },
  }
  if (args.accessToken) body.access_token = args.accessToken
  else Object.assign(body, LINK_PRODUCTS[args.kind])
  const res = await plaidPost<{ link_token: string }>('/link/token/create', body)
  return res.link_token
}

interface ItemRow {
  id: string
  user_id: string
  item_id: string
  institution_name: string | null
  link_kind: LinkKind
  status: string
}

async function tokenFor(admin: SupabaseClient, userId: string, itemId: string): Promise<string> {
  const { data, error } = await admin.from('plaid_item_tokens')
    .select('access_token_ciphertext').eq('item_id', itemId).eq('user_id', userId).maybeSingle()
  if (error || !data) throw new Error('no stored access token for this link')
  return decryptToken((data as { access_token_ciphertext: string }).access_token_ciphertext)
}

export async function exchangePublicToken(admin: SupabaseClient, userId: string, publicToken: string, kind: LinkKind): Promise<SyncResult & { itemRowId: string }> {
  const ex = await plaidPost<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken })
  // Institution name (display only).
  let institutionId: string | null = null
  let institutionName: string | null = null
  try {
    const item = await plaidPost<{ item: { institution_id: string | null } }>('/item/get', { access_token: ex.access_token })
    institutionId = item.item.institution_id
    if (institutionId) {
      const inst = await plaidPost<{ institution: { name: string } }>('/institutions/get_by_id', { institution_id: institutionId, country_codes: ['US'] })
      institutionName = inst.institution.name
    }
  } catch { /* name is cosmetic */ }

  const { data: item, error } = await admin.from('plaid_items').upsert({
    user_id: userId, item_id: ex.item_id, institution_id: institutionId,
    institution_name: institutionName ?? 'Linked institution', link_kind: kind,
    status: 'active', updated_at: new Date().toISOString(),
  }, { onConflict: 'item_id' }).select('id').single()
  if (error || !item) throw new Error(`could not save the link: ${error?.message}`)

  const { error: tokErr } = await admin.from('plaid_item_tokens').upsert({
    item_id: ex.item_id, user_id: userId,
    access_token_ciphertext: encryptToken(ex.access_token), key_version: TOKEN_KEY_VERSION,
  }, { onConflict: 'item_id' })
  if (tokErr) throw new Error(`could not store the link securely: ${tokErr.message}`)

  const sync = await syncItem(admin, userId, ex.item_id)
  return { ...sync, itemRowId: (item as { id: string }).id }
}

export interface SyncResult {
  ok: boolean
  accounts: number
  skipped: number
  status: 'active' | 'login_required' | 'error'
  error?: string
}

/** Pull balances (+ APRs) and mirror them. Never throws for Plaid errors — records them on the Item. */
export async function syncItem(admin: SupabaseClient, userId: string, itemId: string, now: Date = new Date()): Promise<SyncResult> {
  const { data: itemData } = await admin.from('plaid_items')
    .select('id, user_id, item_id, institution_name, link_kind, status').eq('item_id', itemId).eq('user_id', userId).maybeSingle()
  const item = itemData as ItemRow | null
  if (!item) return { ok: false, accounts: 0, skipped: 0, status: 'error', error: 'link not found' }

  const fail = async (status: 'login_required' | 'error', message: string): Promise<SyncResult> => {
    await admin.from('plaid_items').update({ status, last_error: message.slice(0, 500), updated_at: now.toISOString() })
      .eq('item_id', itemId).eq('user_id', userId)
    await admin.from('connected_account_profiles').update({ data_quality: 'error', sync_error: message.slice(0, 500) })
      .eq('plaid_item_id', itemId).eq('user_id', userId)
    return { ok: false, accounts: 0, skipped: 0, status, error: message }
  }

  let accessToken: string
  try { accessToken = await tokenFor(admin, userId, itemId) }
  catch (err) { return fail('error', err instanceof Error ? err.message : 'token unavailable') }

  let accounts: PlaidAccount[]
  try {
    accounts = (await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', { access_token: accessToken })).accounts
  } catch (err) {
    if (err instanceof PlaidError && err.code === 'ITEM_LOGIN_REQUIRED') {
      return fail('login_required', 'Your bank needs you to sign in again.')
    }
    return fail('error', err instanceof PlaidError ? (err.displayMessage ?? err.message) : 'sync failed')
  }

  // APRs: best effort — many banks or links don't support Liabilities.
  let aprs = new Map<string, number>()
  if (item.link_kind === 'bank' && accounts.some(a => a.type === 'credit' || a.type === 'loan')) {
    try {
      const l = await plaidPost<{ liabilities: PlaidLiabilities }>('/liabilities/get', { access_token: accessToken })
      aprs = aprByAccount(l.liabilities)
    } catch { /* PRODUCTS_NOT_SUPPORTED, NO_LIABILITY_ACCOUNTS, … → no APRs */ }
  }

  const institutionName = item.institution_name ?? 'Linked institution'
  const kept: string[] = []
  let skipped = 0
  for (const a of accounts) {
    if (!usable(a)) { skipped++; continue }
    const rows = mirrorRows({ userId, itemId, institutionName, account: a, aprPct: aprs.get(a.account_id) ?? null, now })
    const { error } = await admin.from('connected_account_profiles').upsert(rows.profile, { onConflict: 'plaid_account_id' })
    if (error) return fail('error', `could not save ${a.name}: ${error.message}`)
    if (rows.asset) await admin.from('assets').upsert(rows.asset, { onConflict: 'plaid_account_id' })
    if (rows.debt) await admin.from('debt_accounts').upsert(rows.debt, { onConflict: 'plaid_account_id' })
    kept.push(a.account_id)
  }

  // Accounts that disappeared from the link (closed, unshared) → remove their mirrors.
  const { data: existing } = await admin.from('connected_account_profiles')
    .select('plaid_account_id').eq('plaid_item_id', itemId).eq('user_id', userId)
  const gone = ((existing ?? []) as Array<{ plaid_account_id: string | null }>)
    .map(r => r.plaid_account_id).filter((id): id is string => !!id && !kept.includes(id))
  if (gone.length) await deleteMirrors(admin, userId, gone)

  await admin.from('plaid_items').update({
    status: 'active', last_error: null, last_synced_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq('item_id', itemId).eq('user_id', userId)
  return { ok: true, accounts: kept.length, skipped, status: 'active' }
}

async function deleteMirrors(admin: SupabaseClient, userId: string, plaidAccountIds: string[]) {
  for (const table of ['assets', 'debt_accounts', 'connected_account_profiles']) {
    await admin.from(table).delete().eq('user_id', userId).in('plaid_account_id', plaidAccountIds)
  }
}

/** Revoke at Plaid, then delete the link, its token, and every row it created. */
export async function removeItem(admin: SupabaseClient, userId: string, itemId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await plaidPost('/item/remove', { access_token: await tokenFor(admin, userId, itemId) })
  } catch (err) {
    // Still remove locally — the user asked to disconnect. Report it.
    console.warn('[plaid] /item/remove failed:', err instanceof Error ? err.message : err)
  }
  const { data: rows } = await admin.from('connected_account_profiles')
    .select('plaid_account_id').eq('plaid_item_id', itemId).eq('user_id', userId)
  const ids = ((rows ?? []) as Array<{ plaid_account_id: string | null }>).map(r => r.plaid_account_id).filter((x): x is string => !!x)
  if (ids.length) await deleteMirrors(admin, userId, ids)
  const { error } = await admin.from('plaid_items').delete().eq('item_id', itemId).eq('user_id', userId)   // token cascades
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Daily refresh of every active link (cron, service role). */
export async function syncAllItems(admin: SupabaseClient): Promise<{ items: number; ok: number; failed: number }> {
  const { data } = await admin.from('plaid_items').select('user_id, item_id').eq('status', 'active')
  const items = (data ?? []) as Array<{ user_id: string; item_id: string }>
  let ok = 0
  for (const it of items) {
    const r = await syncItem(admin, it.user_id, it.item_id).catch(() => ({ ok: false }) as SyncResult)
    if (r.ok) ok++
  }
  return { items: items.length, ok, failed: items.length - ok }
}

/** Update-mode link token for an Item that needs the user to sign in again. */
export async function createUpdateLinkToken(admin: SupabaseClient, userId: string, itemId: string): Promise<string> {
  return createLinkToken({ userId, kind: 'bank', accessToken: await tokenFor(admin, userId, itemId) })
}
