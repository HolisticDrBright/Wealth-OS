/**
 * Plaid account → Wealth OS rows (roadmap #2) — PURE.
 *
 * Every linked account lands in three places, each its existing home:
 *   connected_account_profiles  the provider-neutral accounts list
 *   assets                      cash and investments → the ladder, Explore cap,
 *                               bad-year math (depository → 'cash', so it
 *                               counts toward Tier 1 Safety)
 *   debt_accounts               cards and loans, with APR from Liabilities →
 *                               the best-next-dollar debt step
 * Unknown types and non-USD accounts are skipped (never guessed).
 */

import type { AccountType } from '@/lib/accounts/aggregation'

export interface PlaidAccount {
  account_id: string
  name: string
  official_name?: string | null
  mask?: string | null
  type: string
  subtype?: string | null
  balances: { current: number | null; available?: number | null; iso_currency_code?: string | null }
}

export interface PlaidLiabilities {
  credit?: Array<{ account_id: string | null; aprs?: Array<{ apr_percentage: number; apr_type: string }> }> | null
  student?: Array<{ account_id: string | null; interest_rate_percentage?: number | null }> | null
  mortgage?: Array<{ account_id: string | null; interest_rate?: { percentage?: number | null } | null }> | null
}

export type AssetCategory = 'cash' | 'stock' | 'crypto' | 'other'
export type DebtType = 'credit_card' | 'student_loan' | 'auto_loan' | 'personal_loan' | 'mortgage' | 'heloc' | 'medical' | 'other'

const sub = (a: PlaidAccount) => (a.subtype ?? '').toLowerCase()

/** The app's account type, or null for anything we don't model. */
export function accountTypeOf(a: PlaidAccount): AccountType | null {
  const s = sub(a)
  switch (a.type) {
    case 'depository':
      if (s === 'checking' || s === 'paypal' || s === 'prepaid' || s === 'cash management') return 'checking'
      if (s === 'hsa') return 'hsa'
      return 'savings'   // savings, money market, cd, …
    case 'credit':
      return 'credit_card'
    case 'loan':
      return s === 'mortgage' || s === 'home equity' ? 'mortgage' : 'loan'
    case 'investment':
      if (/roth/.test(s)) return 'roth_ira'
      if (/^(401a|401k|403b|457b|thrift savings plan|keogh|profit sharing plan|pension|retirement)$/.test(s)) return '401k'
      if (/ira/.test(s)) return 'ira'
      if (s === 'hsa' || s === 'health reimbursement arrangement') return 'hsa'
      return 'brokerage'
    default:
      return null
  }
}

/** Where an account's balance goes in the money model. */
export function destinationOf(a: PlaidAccount): 'asset' | 'debt' | null {
  if (a.type === 'depository' || a.type === 'investment') return 'asset'
  if (a.type === 'credit' || a.type === 'loan') return 'debt'
  return null
}

export function assetCategoryOf(a: PlaidAccount): AssetCategory {
  if (a.type === 'depository') return 'cash'
  const s = sub(a)
  if (s === 'crypto exchange' || s === 'non-custodial wallet') return 'crypto'
  if (s === '529' || s === 'education savings account') return 'other'
  return 'stock'   // brokerage / retirement: diversified holdings counted as stock-like (conservative)
}

export function debtTypeOf(a: PlaidAccount): DebtType {
  const s = sub(a)
  if (a.type === 'credit') return 'credit_card'
  if (s === 'student') return 'student_loan'
  if (s === 'auto') return 'auto_loan'
  if (s === 'mortgage') return 'mortgage'
  if (s === 'home equity' || s === 'line of credit') return 'heloc'
  if (s === 'consumer' || s === 'loan') return 'personal_loan'
  return 'other'
}

/** APR per account from /liabilities/get (credit: purchase APR; loans: their rate). */
export function aprByAccount(l: PlaidLiabilities | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of l?.credit ?? []) {
    if (!c.account_id) continue
    const purchase = c.aprs?.find(x => x.apr_type === 'purchase_apr') ?? c.aprs?.[0]
    if (purchase && Number.isFinite(purchase.apr_percentage)) out.set(c.account_id, purchase.apr_percentage)
  }
  for (const s of l?.student ?? []) {
    if (s.account_id && s.interest_rate_percentage != null) out.set(s.account_id, s.interest_rate_percentage)
  }
  for (const m of l?.mortgage ?? []) {
    if (m.account_id && m.interest_rate?.percentage != null) out.set(m.account_id, m.interest_rate.percentage)
  }
  return out
}

export function displayName(a: PlaidAccount): string {
  const base = (a.official_name || a.name || 'Account').slice(0, 80)
  return a.mask ? `${base} ••${a.mask}` : base
}

/** Only USD accounts with a known balance are mirrored. */
export function usable(a: PlaidAccount): boolean {
  const cur = a.balances.iso_currency_code
  return (cur == null || cur === 'USD') && a.balances.current != null && accountTypeOf(a) != null
}

export interface MirrorRows {
  profile: Record<string, unknown>
  asset: Record<string, unknown> | null
  debt: Record<string, unknown> | null
}

/** The three rows one Plaid account becomes. Balances owed are positive. */
export function mirrorRows(args: {
  userId: string
  itemId: string
  institutionName: string
  account: PlaidAccount
  aprPct: number | null
  now: Date
}): MirrorRows {
  const { userId, itemId, institutionName, account: a, aprPct, now } = args
  const iso = now.toISOString()
  const dest = destinationOf(a)
  const current = Number(a.balances.current ?? 0)
  const balance = dest === 'debt' ? Math.abs(current) : current
  const name = displayName(a)
  return {
    profile: {
      user_id: userId, plaid_account_id: a.account_id, plaid_item_id: itemId,
      institution_name: institutionName, account_name: name, account_type: accountTypeOf(a),
      provider: 'plaid', balance_usd: balance, apr_pct: aprPct,
      last_synced_at: iso, stale_after: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
      sync_error: null, data_quality: 'synced', updated_at: iso,
    },
    asset: dest === 'asset'
      ? {
          user_id: userId, plaid_account_id: a.account_id, name: `${institutionName} — ${name}`.slice(0, 120),
          category: assetCategoryOf(a), current_value: balance,
          notes: `Synced from ${institutionName} via Plaid (read-only)`, updated_at: iso,
        }
      : null,
    debt: dest === 'debt'
      ? {
          user_id: userId, plaid_account_id: a.account_id, name: `${institutionName} — ${name}`.slice(0, 120),
          debt_type: debtTypeOf(a), balance_usd: balance, apr_pct: aprPct, updated_at: iso,
        }
      : null,
  }
}
