/**
 * Item 1 — account aggregation: manual-mode summaries, honest provider
 * labels, missing-category detection. Item 11 — the shared panel-quality
 * backbone.
 */

import { describe, it, expect } from 'vitest'
import { summarizeAccounts, getAggregationProviders, type ConnectedAccount } from '@/lib/accounts/aggregation'
import { panelQualityOf } from '@/lib/advisory/data-quality'

function acct(over: Partial<ConnectedAccount>): ConnectedAccount {
  return {
    id: 'a1', institutionName: 'Bank', accountName: null, accountType: 'checking',
    provider: 'manual', balanceUsd: 1000, aprPct: null, lastSyncedAt: null,
    staleAfter: null, syncError: null, dataQuality: 'manual',
    ...over,
  }
}

describe('summarizeAccounts', () => {
  it('empty → zero balances, every category missing, source none', () => {
    const s = summarizeAccounts([])
    expect(s.accountCount).toBe(0)
    expect(s.netUsd).toBe(0)
    expect(s.missingCategories).toHaveLength(4)
    expect(s.allManual).toBe(true)
    expect(s.quality.source).toBe('none')
    expect(s.quality.state).toBe('empty')
  })

  it('buckets cash/debt/investment/retirement and nets correctly', () => {
    const s = summarizeAccounts([
      acct({ id: '1', accountType: 'checking', balanceUsd: 5_000 }),
      acct({ id: '2', accountType: 'savings', balanceUsd: 10_000 }),
      acct({ id: '3', accountType: 'credit_card', balanceUsd: 2_000 }),
      acct({ id: '4', accountType: 'brokerage', balanceUsd: 20_000 }),
      acct({ id: '5', accountType: 'roth_ira', balanceUsd: 30_000 }),
      acct({ id: '6', accountType: 'hsa', balanceUsd: 4_000 }),
    ])
    expect(s.cashUsd).toBe(15_000)
    expect(s.debtUsd).toBe(2_000)
    expect(s.investmentUsd).toBe(20_000)
    expect(s.retirementUsd).toBe(34_000)
    expect(s.netUsd).toBe(15_000 + 20_000 + 34_000 - 2_000)
    expect(s.missingCategories).toHaveLength(0)
    expect(s.quality.state).toBe('complete')
    expect(s.quality.source).toBe('manual')
  })

  it('manual-only balances never report as synced or stale', () => {
    const s = summarizeAccounts([acct({})])
    expect(s.allManual).toBe(true)
    expect(s.quality.source).toBe('manual')
    expect(s.quality.state).not.toBe('stale')
  })

  it('flags the categories the user has not tracked', () => {
    const s = summarizeAccounts([acct({ accountType: 'checking' })])
    expect(s.missingCategories).toContain('retirement accounts (IRA/401k/HSA)')
    expect(s.missingCategories).toContain('brokerage accounts')
    expect(s.quality.state).toBe('partial')
  })
})

describe('aggregation providers — honest status', () => {
  it('only manual is configured; others say not connected', () => {
    const providers = getAggregationProviders()
    const manual = providers.find(p => p.id === 'manual')!
    expect(manual.isConfigured()).toBe(true)
    for (const p of providers.filter(x => x.id !== 'manual')) {
      expect(p.isConfigured()).toBe(false)
      expect(p.statusLabel()).toContain('not connected')
    }
    // Nothing claims to be linked or syncing.
    for (const p of providers) {
      expect(p.statusLabel().toLowerCase()).not.toContain('linked')
    }
  })
})

describe('panelQualityOf (item 11 backbone)', () => {
  it('missing required → missing_required with a note', () => {
    const q = panelQualityOf({ presentCount: 2, requiredMissing: ['age'], source: 'manual' })
    expect(q.state).toBe('missing_required')
    expect(q.note).toContain('age')
  })

  it('synced data past the freshness window → stale', () => {
    const q = panelQualityOf({
      presentCount: 3, requiredMissing: [], source: 'synced',
      lastUpdated: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    })
    expect(q.state).toBe('stale')
    expect(q.note).toContain('refresh')
  })

  it('complete when nothing is missing and data is fresh', () => {
    const q = panelQualityOf({
      presentCount: 3, requiredMissing: [], source: 'manual',
      lastUpdated: new Date().toISOString(),
    })
    expect(q.state).toBe('complete')
    expect(q.note).toBeNull()
  })
})
