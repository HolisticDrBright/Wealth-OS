'use server'

/**
 * Tax planning calendar loader (upgrade item 4) — feeds the pure generator
 * with profile facts, seeded constants, and live wash-sale/harvest state.
 */

import { createClient } from '@/lib/supabase/server'
import { loadTaxConstants } from '@/lib/advisory/constants'
import { getFinancialProfile } from '@/lib/actions/advisory'
import { generateTaxCalendar, type CalendarEntry } from '@/lib/advisory/tax-calendar'
import {
  buildGovernanceStamp, evaluateStaleness, TAX_CALENDAR_RULE_VERSION,
  type GovernanceStamp, type StalenessVerdict,
} from '@/lib/advisory/suitability'

export interface TaxCalendarView {
  entries: CalendarEntry[]
  governance: GovernanceStamp
  staleness: StalenessVerdict
  disclaimer: string
  error?: string
}

const CALENDAR_DISCLAIMER =
  'Educational planning calendar. Deadlines shift for weekends, holidays, disaster relief, and state rules — ' +
  'confirm every date and amount with a CPA before acting.'

export async function getTaxCalendar(): Promise<TaxCalendarView> {
  const governance = buildGovernanceStamp({ ruleVersion: TAX_CALENDAR_RULE_VERSION })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { entries: [], governance, staleness: evaluateStaleness(governance), disclaimer: CALENDAR_DISCLAIMER, error: 'not signed in' }
  }

  try {
    const [profile, constants, washRes, harvestRes] = await Promise.all([
      getFinancialProfile().catch(() => null),
      loadTaxConstants(supabase).catch(() => null),
      supabase
        .from('wash_sale_blocklist')
        .select('symbol, blocked_until')
        .eq('user_id', user.id)
        .gte('blocked_until', new Date().toISOString())
        .limit(50)
        .then(r => r.data ?? [], () => []),
      supabase
        .from('harvest_candidates')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(100)
        .then(r => r.data ?? [], () => []),
    ])

    const entries = generateTaxCalendar({
      today: new Date(),
      constants,
      ageSelf: profile?.age_self ?? null,
      isBusinessOwner: profile?.business_entity == null ? null : profile.business_entity !== 'none',
      onHdhp: profile?.health_plan_type == null ? null : profile.health_plan_type === 'hdhp',
      ytdIraContributionUsd: profile?.ytd_ira_contribution_usd ?? null,
      ytdHsaContributionUsd: profile?.ytd_hsa_contribution_usd ?? null,
      ytd401kEmployeeUsd: profile?.ytd_401k_employee_usd ?? null,
      filingStatus: profile?.filing_status ?? null,
      washSaleWindows: (washRes as Array<{ symbol: string; blocked_until: string }>)
        .map(w => ({ symbol: w.symbol, blockedUntil: w.blocked_until })),
      harvestCandidates: harvestRes.length,
    })

    const stamp = buildGovernanceStamp({
      ruleVersion: TAX_CALENDAR_RULE_VERSION,
      constantsYear: constants ? new Date().getUTCFullYear() : null,
    })
    return {
      entries,
      governance: stamp,
      staleness: evaluateStaleness(stamp),
      disclaimer: CALENDAR_DISCLAIMER,
    }
  } catch (err) {
    return {
      entries: [], governance, staleness: evaluateStaleness(governance),
      disclaimer: CALENDAR_DISCLAIMER,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
