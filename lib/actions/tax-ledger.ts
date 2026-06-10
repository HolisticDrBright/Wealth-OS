'use server'

import { createClient } from '@/lib/supabase/server'
import { computeCarryforward, type TaxYearEntry } from '@/lib/tax/carryforward'

export interface TaxLossSummary {
  taxYear: number
  /** Losses harvested this calendar year (positive magnitude, USD) */
  currentYearHarvestedUsd: number
  /** Losses usable this year (against gains + up to $3k of income) */
  usableThisYearUsd: number
  usedAgainstGainsUsd: number
  usedAgainstIncomeUsd: number
  /** Carryforward into next year */
  carryforwardUsd: number
  carryforwardShortTermUsd: number
  carryforwardLongTermUsd: number
}

const EMPTY_SUMMARY: TaxLossSummary = {
  taxYear: new Date().getFullYear(),
  currentYearHarvestedUsd: 0,
  usableThisYearUsd: 0,
  usedAgainstGainsUsd: 0,
  usedAgainstIncomeUsd: 0,
  carryforwardUsd: 0,
  carryforwardShortTermUsd: 0,
  carryforwardLongTermUsd: 0,
}

/**
 * Summarize the user's tax-loss position: harvested losses this year
 * (from executed harvest candidates), prior-year ledger entries, and the
 * resulting carryforward under IRS netting rules.
 */
export async function getTaxLossSummary(): Promise<TaxLossSummary> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_SUMMARY

  try {
    const currentYear = new Date().getFullYear()
    const yearStart = `${currentYear}-01-01T00:00:00Z`

    const [ledgerRes, harvestedRes] = await Promise.all([
      supabase
        .from('tax_loss_ledger')
        .select('tax_year, short_term_losses_usd, long_term_losses_usd, short_term_gains_usd, long_term_gains_usd')
        .eq('user_id', user.id)
        .order('tax_year', { ascending: true }),
      supabase
        .from('harvest_candidates')
        .select('unrealized_loss_usd, purchase_date, harvested_at')
        .eq('user_id', user.id)
        .eq('status', 'harvested')
        .gte('harvested_at', yearStart),
    ])

    const entries = new Map<number, TaxYearEntry>()
    for (const row of ledgerRes.data ?? []) {
      entries.set(row.tax_year, {
        taxYear: row.tax_year,
        shortTermGainsUsd: row.short_term_gains_usd ?? 0,
        shortTermLossesUsd: row.short_term_losses_usd ?? 0,
        longTermGainsUsd: row.long_term_gains_usd ?? 0,
        longTermLossesUsd: row.long_term_losses_usd ?? 0,
      })
    }

    // Fold this year's executed harvests into the current-year entry.
    let harvestedThisYear = 0
    const current = entries.get(currentYear) ?? {
      taxYear: currentYear,
      shortTermGainsUsd: 0,
      shortTermLossesUsd: 0,
      longTermGainsUsd: 0,
      longTermLossesUsd: 0,
    }

    for (const h of harvestedRes.data ?? []) {
      const loss = Math.abs(h.unrealized_loss_usd ?? 0)
      harvestedThisYear += loss
      const harvestedAt = h.harvested_at ? new Date(h.harvested_at) : new Date()
      const heldMs = h.purchase_date
        ? harvestedAt.getTime() - new Date(h.purchase_date).getTime()
        : 0
      const isLongTerm = heldMs > 365.25 * 24 * 60 * 60 * 1000
      if (isLongTerm) current.longTermLossesUsd += loss
      else current.shortTermLossesUsd += loss
    }
    entries.set(currentYear, current)

    const result = computeCarryforward([...entries.values()])
    const thisYear = result.years.find(y => y.taxYear === currentYear)

    return {
      taxYear: currentYear,
      currentYearHarvestedUsd: Math.round(harvestedThisYear * 100) / 100,
      usableThisYearUsd: Math.round(((thisYear?.usedAgainstGainsUsd ?? 0) + (thisYear?.usedAgainstIncomeUsd ?? 0)) * 100) / 100,
      usedAgainstGainsUsd: thisYear?.usedAgainstGainsUsd ?? 0,
      usedAgainstIncomeUsd: thisYear?.usedAgainstIncomeUsd ?? 0,
      carryforwardUsd: result.finalCarryforwardUsd,
      carryforwardShortTermUsd: result.finalCarryforwardShortTermUsd,
      carryforwardLongTermUsd: result.finalCarryforwardLongTermUsd,
    }
  } catch {
    return EMPTY_SUMMARY
  }
}
