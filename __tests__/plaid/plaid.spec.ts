/**
 * Roadmap #2 — read-only account linking through Plaid.
 *  - access tokens: encrypted at rest (AES-256-GCM), fail closed without a key,
 *    stored in a table no user session can read, never returned to a client,
 *  - only read-only products are ever requested,
 *  - account mapping into assets / debt_accounts / connected_account_profiles,
 *  - sync, re-login, disappeared accounts, disconnect,
 *  - linked mortgages don't hijack the best-next-dollar debt step.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { encryptToken, decryptToken } from '@/lib/plaid/crypto'
import { plaidPost, isPlaidConfigured, PlaidError, PLAID_API_VERSION } from '@/lib/plaid/client'
import {
  accountTypeOf, destinationOf, assetCategoryOf, debtTypeOf, aprByAccount, usable, mirrorRows, type PlaidAccount,
} from '@/lib/plaid/mapping'
import { LINK_PRODUCTS, FORBIDDEN_PRODUCTS } from '@/lib/plaid/service'
import { nextDollarInputsFrom } from '@/lib/advisory/next-dollar-inputs'
import { EMPTY_EMPLOYER_BENEFITS, type DebtAccount } from '@/lib/advisory/benefits-debt'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  vi.stubEnv('PLAID_CLIENT_ID', 'client-123')
  vi.stubEnv('PLAID_SECRET', 'secret-abc')
  vi.stubEnv('PLAID_TOKEN_KEY', KEY)
  vi.stubEnv('PLAID_ENV', 'sandbox')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const acct = (over: Partial<PlaidAccount> & { type: string }): PlaidAccount => ({
  account_id: over.account_id ?? `a-${Math.random()}`, name: over.name ?? 'Account', mask: over.mask ?? '1234',
  subtype: null, balances: { current: 1_000, iso_currency_code: 'USD' }, ...over,
})

// ─── Tokens ──────────────────────────────────────────────────────────────────

describe('access-token encryption', () => {
  it('round-trips, and the ciphertext never contains the token', () => {
    const blob = encryptToken('access-sandbox-xyz')
    expect(blob.startsWith('v1:')).toBe(true)
    expect(blob).not.toContain('access-sandbox-xyz')
    expect(decryptToken(blob)).toBe('access-sandbox-xyz')
    expect(encryptToken('access-sandbox-xyz')).not.toBe(blob)   // random IV
  })
  it('detects tampering', () => {
    const [v, iv, tag, ct] = encryptToken('access-sandbox-xyz').split(':')
    const flipped = Buffer.from(ct, 'base64'); flipped[0] ^= 1
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })
  it('fails CLOSED without a valid key', () => {
    vi.stubEnv('PLAID_TOKEN_KEY', '')
    expect(() => encryptToken('x')).toThrow(/PLAID_TOKEN_KEY/)
    vi.stubEnv('PLAID_TOKEN_KEY', Buffer.from('short').toString('base64'))
    expect(() => encryptToken('x')).toThrow(/32 bytes/)
  })
  it('linking is "configured" only with id, secret AND the token key', () => {
    expect(isPlaidConfigured()).toBe(true)
    vi.stubEnv('PLAID_TOKEN_KEY', '')
    expect(isPlaidConfigured()).toBe(false)
  })
})

// ─── Client ──────────────────────────────────────────────────────────────────

describe('plaidPost', () => {
  it('sends credentials as headers to the sandbox host with the pinned API version', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    await plaidPost('/accounts/get', { access_token: 't' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sandbox.plaid.com/accounts/get')
    const h = init.headers as Record<string, string>
    expect(h['PLAID-CLIENT-ID']).toBe('client-123')
    expect(h['PLAID-SECRET']).toBe('secret-abc')
    expect(h['Plaid-Version']).toBe(PLAID_API_VERSION)
    expect(String(init.body)).not.toContain('secret-abc')
  })
  it('maps Plaid errors, keeping the user-safe message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details have changed', display_message: 'Please sign in again.',
    }), { status: 400 })))
    await expect(plaidPost('/accounts/get', {})).rejects.toMatchObject({ code: 'ITEM_LOGIN_REQUIRED', displayMessage: 'Please sign in again.' })
  })
  it('refuses without credentials', async () => {
    vi.stubEnv('PLAID_SECRET', '')
    await expect(plaidPost('/x', {})).rejects.toBeInstanceOf(PlaidError)
  })
})

describe('read-only products only', () => {
  it('no product that can move money is ever requested', () => {
    for (const cfg of Object.values(LINK_PRODUCTS)) {
      for (const p of [...cfg.products, ...(cfg.optional_products ?? [])]) expect(FORBIDDEN_PRODUCTS).not.toContain(p)
    }
    expect(FORBIDDEN_PRODUCTS).toEqual(expect.arrayContaining(['auth', 'transfer', 'payment_initiation']))
  })
  it('Investments sits in `products` (Plaid requires it there)', () => {
    expect(LINK_PRODUCTS.investments.products).toEqual(['investments'])
    expect(LINK_PRODUCTS.bank).toEqual({ products: ['transactions'], optional_products: ['liabilities'] })
  })
})

// ─── Mapping ─────────────────────────────────────────────────────────────────

describe('account mapping', () => {
  it.each([
    ['depository', 'checking', 'checking', 'asset'],
    ['depository', 'savings', 'savings', 'asset'],
    ['depository', 'money market', 'savings', 'asset'],
    ['depository', 'hsa', 'hsa', 'asset'],
    ['credit', 'credit card', 'credit_card', 'debt'],
    ['loan', 'student', 'loan', 'debt'],
    ['loan', 'mortgage', 'mortgage', 'debt'],
    ['investment', '401k', '401k', 'asset'],
    ['investment', 'roth 401k', 'roth_ira', 'asset'],
    ['investment', 'ira', 'ira', 'asset'],
    ['investment', 'roth', 'roth_ira', 'asset'],
    ['investment', 'brokerage', 'brokerage', 'asset'],
  ])('%s/%s → %s (%s)', (type, subtype, expected, dest) => {
    const a = acct({ type, subtype })
    expect(accountTypeOf(a)).toBe(expected)
    expect(destinationOf(a)).toBe(dest)
  })
  it('cash counts toward Safety; investments are stock-like; crypto and 529 kept apart', () => {
    expect(assetCategoryOf(acct({ type: 'depository', subtype: 'savings' }))).toBe('cash')
    expect(assetCategoryOf(acct({ type: 'investment', subtype: '401k' }))).toBe('stock')
    expect(assetCategoryOf(acct({ type: 'investment', subtype: 'crypto exchange' }))).toBe('crypto')
    expect(assetCategoryOf(acct({ type: 'investment', subtype: '529' }))).toBe('other')
  })
  it('debt types', () => {
    expect(debtTypeOf(acct({ type: 'credit', subtype: 'credit card' }))).toBe('credit_card')
    expect(debtTypeOf(acct({ type: 'loan', subtype: 'student' }))).toBe('student_loan')
    expect(debtTypeOf(acct({ type: 'loan', subtype: 'auto' }))).toBe('auto_loan')
    expect(debtTypeOf(acct({ type: 'loan', subtype: 'mortgage' }))).toBe('mortgage')
  })
  it('APRs from Liabilities: purchase APR for cards, the rate for loans', () => {
    const m = aprByAccount({
      credit: [{ account_id: 'c', aprs: [{ apr_type: 'cash_apr', apr_percentage: 29 }, { apr_type: 'purchase_apr', apr_percentage: 24.99 }] }],
      student: [{ account_id: 's', interest_rate_percentage: 5.5 }],
      mortgage: [{ account_id: 'm', interest_rate: { percentage: 6.25 } }],
    })
    expect(Object.fromEntries(m)).toEqual({ c: 24.99, s: 5.5, m: 6.25 })
  })
  it('skips what it can’t model honestly: non-USD, no balance, unknown types', () => {
    expect(usable(acct({ type: 'depository', subtype: 'checking', balances: { current: 10, iso_currency_code: 'EUR' } }))).toBe(false)
    expect(usable(acct({ type: 'depository', subtype: 'checking', balances: { current: null } }))).toBe(false)
    expect(usable(acct({ type: 'other' }))).toBe(false)
  })
  it('one account → profile + asset (cash) / debt (positive owed)', () => {
    const now = new Date('2026-11-24T12:00:00Z')
    const cash = mirrorRows({ userId: 'u1', itemId: 'i1', institutionName: 'First Bank', account: acct({ account_id: 'a1', type: 'depository', subtype: 'checking', name: 'Checking' }), aprPct: null, now })
    expect(cash.profile).toMatchObject({ user_id: 'u1', plaid_account_id: 'a1', provider: 'plaid', data_quality: 'synced', account_type: 'checking' })
    expect(cash.asset).toMatchObject({ user_id: 'u1', plaid_account_id: 'a1', category: 'cash', current_value: 1_000 })
    expect(cash.debt).toBeNull()
    const card = mirrorRows({ userId: 'u1', itemId: 'i1', institutionName: 'First Bank', account: acct({ account_id: 'a2', type: 'credit', subtype: 'credit card', balances: { current: -410, iso_currency_code: 'USD' } }), aprPct: 24.99, now })
    expect(card.debt).toMatchObject({ debt_type: 'credit_card', balance_usd: 410, apr_pct: 24.99 })
    expect(card.asset).toBeNull()
  })
})

// ─── Service against a fake database + mocked Plaid ─────────────────────────

type Row = Record<string, unknown>
const db = { tables: {} as Record<string, Row[]>, ops: [] as Array<{ table: string; op: string; row?: Row }> }

function fakeAdmin() {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = []
      const rows = () => (db.tables[table] ?? []).filter(r => filters.every(f => f(r)))
      let mode: 'select' | 'update' | 'delete' = 'select'
      let patch: Row = {}
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = (k: string, v: unknown) => { filters.push(r => r[k] === v); return c }
      c.in = (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return c }
      c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      c.upsert = (row: Row, opts?: { onConflict?: string }) => {
        const key = opts?.onConflict
        const list = db.tables[table] ?? (db.tables[table] = [])
        const existing = key ? list.find(r => r[key] === row[key]) : undefined
        const stored = existing ? Object.assign(existing, row) : (list.push({ id: `${table}-${list.length + 1}`, ...row }), list[list.length - 1])
        db.ops.push({ table, op: 'upsert', row })
        const res = { data: { id: stored.id }, error: null }
        return { select: () => ({ single: async () => res }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }
      }
      c.update = (p: Row) => { mode = 'update'; patch = p; return c }
      c.delete = () => { mode = 'delete'; return c }
      c.then = (ok: (v: unknown) => unknown) => {
        if (mode === 'update') { for (const r of rows()) Object.assign(r, patch); db.ops.push({ table, op: 'update', row: patch }) }
        if (mode === 'delete') {
          const doomed = new Set(rows())
          db.tables[table] = (db.tables[table] ?? []).filter(r => !doomed.has(r))
          db.ops.push({ table, op: 'delete' })
          // FK cascade: plaid_items → plaid_item_tokens
          if (table === 'plaid_items') {
            const ids = new Set([...doomed].map(r => r.item_id))
            db.tables.plaid_item_tokens = (db.tables.plaid_item_tokens ?? []).filter(r => !ids.has(r.item_id))
          }
        }
        return Promise.resolve({ data: mode === 'select' ? rows() : null, error: null }).then(ok)
      }
      return c
    },
  } as never
}

type PlaidReply = Record<string, unknown> | ((body: Record<string, unknown>) => Record<string, unknown> | Response)
function mockPlaid(routes: Record<string, PlaidReply>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ path, body })
    const r = routes[path]
    if (!r) return new Response(JSON.stringify({ error_code: 'NOT_MOCKED', error_message: path }), { status: 400 })
    const out = typeof r === 'function' ? r(body) : r
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 })
  }))
  return calls
}

const ACCOUNTS = [
  { account_id: 'chk', name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 110, iso_currency_code: 'USD' } },
  { account_id: 'cc', name: 'Plaid Credit Card', mask: '3333', type: 'credit', subtype: 'credit card', balances: { current: 410, iso_currency_code: 'USD' } },
  { account_id: 'mtg', name: 'Plaid Mortgage', mask: '8888', type: 'loan', subtype: 'mortgage', balances: { current: 56_302, iso_currency_code: 'USD' } },
]

beforeEach(() => { db.tables = {}; db.ops = [] })

describe('exchange → encrypted token → first sync', () => {
  it('stores ONLY ciphertext, mirrors balances, attaches APRs', async () => {
    const calls = mockPlaid({
      '/item/public_token/exchange': { access_token: 'access-sandbox-SECRET', item_id: 'item-1' },
      '/item/get': { item: { institution_id: 'ins_1' } },
      '/institutions/get_by_id': { institution: { name: 'First Platypus Bank' } },
      '/accounts/get': { accounts: ACCOUNTS },
      '/liabilities/get': { liabilities: { credit: [{ account_id: 'cc', aprs: [{ apr_type: 'purchase_apr', apr_percentage: 15.24 }] }], mortgage: [{ account_id: 'mtg', interest_rate: { percentage: 3.99 } }] } },
    })
    const { exchangePublicToken } = await import('@/lib/plaid/service')
    const res = await exchangePublicToken(fakeAdmin(), 'u1', 'public-sandbox-1', 'bank')
    expect(res).toMatchObject({ ok: true, accounts: 3, status: 'active' })

    const tok = db.tables.plaid_item_tokens[0]
    expect(String(tok.access_token_ciphertext)).not.toContain('access-sandbox-SECRET')
    expect(decryptToken(String(tok.access_token_ciphertext))).toBe('access-sandbox-SECRET')
    expect(JSON.stringify(db.tables.plaid_items)).not.toContain('access-sandbox-SECRET')

    expect(db.tables.assets).toEqual([expect.objectContaining({ plaid_account_id: 'chk', category: 'cash', current_value: 110, user_id: 'u1' })])
    expect(db.tables.debt_accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ plaid_account_id: 'cc', debt_type: 'credit_card', balance_usd: 410, apr_pct: 15.24 }),
      expect.objectContaining({ plaid_account_id: 'mtg', debt_type: 'mortgage', apr_pct: 3.99 }),
    ]))
    expect(db.tables.connected_account_profiles).toHaveLength(3)
    expect(db.tables.plaid_items[0]).toMatchObject({ institution_name: 'First Platypus Bank', status: 'active', user_id: 'u1' })
    // The access token is only ever sent TO Plaid, never anywhere else.
    expect(calls.every(c => c.path.startsWith('/'))).toBe(true)
  })

  it('a bank without Liabilities still syncs (no APRs)', async () => {
    mockPlaid({
      '/item/public_token/exchange': { access_token: 'access-x', item_id: 'item-2' },
      '/item/get': { item: { institution_id: null } },
      '/accounts/get': { accounts: ACCOUNTS },
      '/liabilities/get': () => new Response(JSON.stringify({ error_code: 'PRODUCTS_NOT_SUPPORTED', error_message: 'no' }), { status: 400 }),
    })
    const { exchangePublicToken } = await import('@/lib/plaid/service')
    const res = await exchangePublicToken(fakeAdmin(), 'u1', 'public-sandbox-2', 'bank')
    expect(res.ok).toBe(true)
    expect(db.tables.debt_accounts.every(d => d.apr_pct == null)).toBe(true)
  })
})

describe('sync lifecycle', () => {
  async function linked() {
    db.tables.plaid_items = [{ id: 'row1', user_id: 'u1', item_id: 'item-1', institution_name: 'Bank', link_kind: 'bank', status: 'active' }]
    db.tables.plaid_item_tokens = [{ item_id: 'item-1', user_id: 'u1', access_token_ciphertext: encryptToken('access-1') }]
    return import('@/lib/plaid/service')
  }
  it('ITEM_LOGIN_REQUIRED marks the link "sign in again" and flags its accounts', async () => {
    const { syncItem } = await linked()
    db.tables.connected_account_profiles = [{ user_id: 'u1', plaid_item_id: 'item-1', plaid_account_id: 'chk', data_quality: 'synced' }]
    mockPlaid({ '/accounts/get': () => new Response(JSON.stringify({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'x' }), { status: 400 }) })
    const r = await syncItem(fakeAdmin(), 'u1', 'item-1')
    expect(r).toMatchObject({ ok: false, status: 'login_required' })
    expect(db.tables.plaid_items[0].status).toBe('login_required')
    expect(db.tables.connected_account_profiles[0].data_quality).toBe('error')
  })
  it('an account that disappears from the link loses its mirrors', async () => {
    const { syncItem } = await linked()
    mockPlaid({ '/accounts/get': { accounts: ACCOUNTS }, '/liabilities/get': { liabilities: {} } })
    await syncItem(fakeAdmin(), 'u1', 'item-1')
    expect(db.tables.debt_accounts.some(d => d.plaid_account_id === 'cc')).toBe(true)
    mockPlaid({ '/accounts/get': { accounts: ACCOUNTS.filter(a => a.account_id !== 'cc') }, '/liabilities/get': { liabilities: {} } })
    await syncItem(fakeAdmin(), 'u1', 'item-1')
    expect(db.tables.debt_accounts.some(d => d.plaid_account_id === 'cc')).toBe(false)
    expect(db.tables.connected_account_profiles.some(d => d.plaid_account_id === 'cc')).toBe(false)
  })
  it('re-sync updates rows in place (no duplicates)', async () => {
    const { syncItem } = await linked()
    mockPlaid({ '/accounts/get': { accounts: ACCOUNTS }, '/liabilities/get': { liabilities: {} } })
    await syncItem(fakeAdmin(), 'u1', 'item-1')
    await syncItem(fakeAdmin(), 'u1', 'item-1')
    expect(db.tables.assets).toHaveLength(1)
    expect(db.tables.connected_account_profiles).toHaveLength(3)
  })
  it('another user can never sync someone else’s link', async () => {
    const { syncItem } = await linked()
    const f = mockPlaid({ '/accounts/get': { accounts: ACCOUNTS } })
    const r = await syncItem(fakeAdmin(), 'intruder', 'item-1')
    expect(r).toMatchObject({ ok: false, error: 'link not found' })
    expect(f).toHaveLength(0)
  })
  it('disconnect revokes at Plaid and deletes the link, its token, and every mirrored row', async () => {
    const { syncItem, removeItem } = await linked()
    mockPlaid({ '/accounts/get': { accounts: ACCOUNTS }, '/liabilities/get': { liabilities: {} } })
    await syncItem(fakeAdmin(), 'u1', 'item-1')
    const calls = mockPlaid({ '/item/remove': {} })
    expect(await removeItem(fakeAdmin(), 'u1', 'item-1')).toEqual({ ok: true })
    expect(calls.map(c => c.path)).toEqual(['/item/remove'])
    expect(calls[0].body.access_token).toBe('access-1')
    for (const t of ['plaid_items', 'plaid_item_tokens', 'assets', 'debt_accounts', 'connected_account_profiles']) {
      expect(db.tables[t] ?? [], t).toHaveLength(0)
    }
  })
})

// ─── Next dollar with linked debts ───────────────────────────────────────────

describe('linked debts and the best-next-dollar debt step', () => {
  const debt = (debtType: string, aprPct: number): DebtAccount =>
    ({ id: debtType, name: debtType, debtType, balanceUsd: 10_000, aprPct, minimumPaymentUsd: null, payoffPriority: null })
  const src = (debts: DebtAccount[]) => ({
    profile: {}, benefits: EMPTY_EMPLOYER_BENEFITS, debts, noHighInterestDebtConfirmed: false,
    constants: null, params: { debt_payoff_hurdle_apr: 0.06 }, yields: null, ladder: null, investableUsd: 0,
  })
  it('a mortgage is not "high-interest debt", and alone doesn’t prove there is no card debt', () => {
    expect(nextDollarInputsFrom(src([debt('mortgage', 6.5)])).highInterestDebtAprPct).toBeNull()
  })
  it('a card next to a mortgage is judged on the card', () => {
    expect(nextDollarInputsFrom(src([debt('mortgage', 6.5), debt('credit_card', 22)])).highInterestDebtAprPct).toBe(22)
  })
})

// ─── Contracts ───────────────────────────────────────────────────────────────

describe('contracts', () => {
  it('every server action verifies the session before touching the service role', () => {
    const src = read('lib/actions/plaid.ts')
    for (const fn of ['createUpdateLinkTokenAction', 'exchangePublicTokenAction', 'syncPlaidItemAction', 'removePlaidItemAction']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`))
      const nextFn = body.indexOf('export async function', 10)
      const own = nextFn > 0 ? body.slice(0, nextFn) : body
      expect(own.indexOf('await userId()'), fn).toBeGreaterThan(-1)
      expect(own.indexOf('await userId()'), fn).toBeLessThan(own.indexOf('createAdminClient()'))
    }
    // The panel reads with the user's own session (RLS), never the service role.
    const panel = src.slice(src.indexOf('export async function getPlaidPanel'), src.indexOf('export async function createLinkTokenAction'))
    expect(panel).not.toContain('createAdminClient')
    expect(panel).not.toContain('plaid_item_tokens')
  })
  it('the browser never sees an access token', () => {
    const ui = read('components/wealth/PlaidLinkPanel.tsx')
    expect(ui).not.toMatch(/access_token|accessToken|decryptToken|plaid_item_tokens|lib\/plaid\/service|lib\/plaid\/crypto/)
    const actions = read('lib/actions/plaid.ts')
    expect(actions).not.toMatch(/access_token|accessToken/)
  })
  it('migration: tokens table has NO user policy; items are read-only for users', () => {
    const sql = read('supabase/migrations/20260704p_plaid.sql')
    const tokens = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.plaid_item_tokens'), sql.indexOf('-- 3.'))
    expect(tokens).toContain('ENABLE ROW LEVEL SECURITY')
    expect(tokens).not.toMatch(/auth\.uid\(\)/)
    expect(tokens).toContain("auth.role() = 'service_role'")
    expect(sql).toMatch(/"users read own plaid items"\s+ON public\.plaid_items FOR SELECT USING \(user_id = auth\.uid\(\)\)/)
    for (const t of ['connected_account_profiles', 'assets', 'debt_accounts']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS plaid_account_id text`)
    }
  })
  it('the provider list reports Plaid honestly and the daily cron refreshes links', async () => {
    const { getAggregationProviders } = await import('@/lib/accounts/aggregation')
    expect(getAggregationProviders().find(p => p.id === 'plaid')!.statusLabel()).toMatch(/read-only linking available/)
    vi.stubEnv('PLAID_TOKEN_KEY', '')
    expect(getAggregationProviders().find(p => p.id === 'plaid')!.isConfigured()).toBe(false)
    expect(read('lib/cron/tasks.ts')).toContain('syncAllItems(supabase)')
  })
})
