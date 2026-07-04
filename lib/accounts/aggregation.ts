/**
 * Provider-neutral account aggregation (upgrade item 1) — pure core.
 *
 * The architecture supports plaid/teller/finicity/broker_import providers,
 * but NO live credentials are configured: only the ManualProvider is real
 * today. The UI must say "manual or not connected" — never pretend an
 * institution is linked.
 */

import { panelQualityOf, type PanelQuality } from '@/lib/advisory/data-quality'

export const ACCOUNT_TYPES = [
  'checking', 'savings', 'credit_card', 'brokerage',
  'ira', 'roth_ira', '401k', 'hsa', 'loan', 'mortgage',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_PROVIDERS = ['manual', 'plaid', 'teller', 'finicity', 'broker_import'] as const
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number]

export interface ConnectedAccount {
  id: string
  institutionName: string
  accountName: string | null
  accountType: AccountType
  provider: AccountProvider
  balanceUsd: number | null
  aprPct: number | null
  lastSyncedAt: string | null
  staleAfter: string | null
  syncError: string | null
  dataQuality: 'manual' | 'synced' | 'stale' | 'error'
}

// ─── Provider interface (mock-safe; only ManualProvider is implemented) ──────

export interface AggregationProvider {
  readonly id: AccountProvider
  /** True when real credentials exist for this provider. */
  isConfigured(): boolean
  /** Human status for the integrations page — always honest. */
  statusLabel(): string
}

export class ManualProvider implements AggregationProvider {
  readonly id = 'manual' as const
  isConfigured(): boolean { return true }
  statusLabel(): string { return 'Manual entry — balances are user-maintained, not synced' }
}

class UnconfiguredProvider implements AggregationProvider {
  constructor(readonly id: AccountProvider, private readonly envKeys: string[]) {}
  isConfigured(): boolean { return this.envKeys.every(k => !!process.env[k]) }
  statusLabel(): string {
    return this.isConfigured()
      ? `${this.id} credentials present — sync implementation pending (accounts still manual)`
      : `${this.id} not connected — no credentials configured`
  }
}

export function getAggregationProviders(): AggregationProvider[] {
  return [
    new ManualProvider(),
    new UnconfiguredProvider('plaid', ['PLAID_CLIENT_ID', 'PLAID_SECRET']),
    new UnconfiguredProvider('teller', ['TELLER_APPLICATION_ID']),
    new UnconfiguredProvider('finicity', ['FINICITY_PARTNER_ID', 'FINICITY_APP_KEY']),
    new UnconfiguredProvider('broker_import', ['BROKER_IMPORT_ENABLED']),
  ]
}

// ─── Summary math (pure) ──────────────────────────────────────────────────────

const CASH_TYPES: AccountType[] = ['checking', 'savings']
const DEBT_TYPES: AccountType[] = ['credit_card', 'loan', 'mortgage']
const INVESTMENT_TYPES: AccountType[] = ['brokerage']
const RETIREMENT_TYPES: AccountType[] = ['ira', 'roth_ira', '401k', 'hsa']

export interface AccountsSummary {
  cashUsd: number
  debtUsd: number
  investmentUsd: number
  retirementUsd: number
  netUsd: number
  accountCount: number
  byType: Partial<Record<AccountType, { count: number; totalUsd: number }>>
  /** Account categories with zero records — the honest gaps list. */
  missingCategories: string[]
  /** Providers actually connected vs manual-only. */
  connectedProviders: AccountProvider[]
  allManual: boolean
  quality: PanelQuality
}

export function summarizeAccounts(accounts: ConnectedAccount[]): AccountsSummary {
  const sum = (types: AccountType[]) =>
    accounts
      .filter(a => types.includes(a.accountType) && a.balanceUsd != null)
      .reduce((s, a) => s + (a.balanceUsd as number), 0)

  const byType: AccountsSummary['byType'] = {}
  for (const a of accounts) {
    const entry = byType[a.accountType] ?? { count: 0, totalUsd: 0 }
    entry.count += 1
    entry.totalUsd += a.balanceUsd ?? 0
    byType[a.accountType] = entry
  }

  const has = (types: AccountType[]) => accounts.some(a => types.includes(a.accountType))
  const missingCategories: string[] = []
  if (!has(CASH_TYPES)) missingCategories.push('cash accounts (checking/savings)')
  if (!has(DEBT_TYPES)) missingCategories.push('debt accounts (credit card/loan/mortgage)')
  if (!has(INVESTMENT_TYPES)) missingCategories.push('brokerage accounts')
  if (!has(RETIREMENT_TYPES)) missingCategories.push('retirement accounts (IRA/401k/HSA)')

  const connectedProviders = [...new Set(
    accounts.filter(a => a.provider !== 'manual').map(a => a.provider)
  )]
  const lastUpdated = accounts
    .map(a => a.lastSyncedAt)
    .filter((v): v is string => v != null)
    .sort()
    .pop() ?? null

  const cashUsd = sum(CASH_TYPES)
  const debtUsd = sum(DEBT_TYPES)
  const investmentUsd = sum(INVESTMENT_TYPES)
  const retirementUsd = sum(RETIREMENT_TYPES)

  return {
    cashUsd,
    debtUsd,
    investmentUsd,
    retirementUsd,
    netUsd: cashUsd + investmentUsd + retirementUsd - debtUsd,
    accountCount: accounts.length,
    byType,
    missingCategories,
    connectedProviders,
    allManual: connectedProviders.length === 0,
    quality: panelQualityOf({
      presentCount: accounts.length,
      requiredMissing: [],
      optionalMissing: missingCategories,
      source: accounts.length === 0 ? 'none' : connectedProviders.length === 0 ? 'manual' : 'mixed',
      lastUpdated,
      // Manual balances don't go stale on a sync clock; synced ones do.
      staleAfterMs: connectedProviders.length === 0 ? Number.POSITIVE_INFINITY : undefined,
    }),
  }
}
