'use client'

import { CapitalAllocation, type AllocationSlice } from '@/components/portfolio/CapitalAllocation'
import type { RiskProfileRow } from '@/lib/actions/asset-risk-profile'
import type { RiskSummary } from '@/lib/actions/risk'

interface BucketDef {
  key: string
  label: string
  color: string
  /** Recommended target percent from the profile row. */
  recommended: (p: RiskProfileRow) => number | undefined
  /** Asset-class keys that map into this bucket for current-share grouping. */
  match: string[]
}

const BUCKETS: BucketDef[] = [
  { key: 'stocks', label: 'Stocks', color: 'bg-indigo-500', recommended: p => p.alloc_stocks, match: ['stocks'] },
  { key: 'options', label: 'Options', color: 'bg-violet-500', recommended: p => p.alloc_options, match: ['options'] },
  { key: 'crypto', label: 'Crypto', color: 'bg-emerald-500', recommended: p => p.alloc_crypto, match: ['crypto'] },
  { key: 'forex', label: 'Forex', color: 'bg-sky-500', recommended: p => p.alloc_forex, match: ['forex'] },
  { key: 'polymarket', label: 'Polymarket', color: 'bg-amber-500', recommended: p => p.alloc_polymarket, match: ['polymarket'] },
  { key: 'multi-asset', label: 'Multi-asset', color: 'bg-rose-500', recommended: p => p.alloc_multi_asset, match: ['multi-asset', 'multi_asset'] },
]

export function AllocationPanel({
  profile,
  risk,
}: {
  profile: RiskProfileRow | null
  risk: RiskSummary
}) {
  // Current shares grouped by asset class (only if there are real positions).
  const total = risk.total_open_notional
  const byClass = new Map<string, number>()
  for (const pos of risk.positions) {
    const k = (pos.asset_class ?? 'multi-asset').toLowerCase()
    byClass.set(k, (byClass.get(k) ?? 0) + (pos.notional_value ?? 0))
  }
  const haveCurrent = total > 0 && risk.positions.length > 0

  const slices: AllocationSlice[] = BUCKETS.map(b => {
    const currentUsd = haveCurrent
      ? b.match.reduce((sum, m) => sum + (byClass.get(m) ?? 0), 0)
      : null
    return {
      key: b.key,
      label: b.label,
      color: b.color,
      recommendedPct: profile ? b.recommended(profile) ?? null : null,
      currentUsd,
      currentPct: haveCurrent && currentUsd != null && total > 0 ? (currentUsd / total) * 100 : null,
    }
  })

  return <CapitalAllocation slices={slices} currentUnavailable={!haveCurrent} />
}
