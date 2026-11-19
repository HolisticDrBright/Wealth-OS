/**
 * Recommended-allocation slices for CapitalAllocation, from the single
 * allocation policy (lib/allocation/policy.ts).
 */
import { recommendedPortfolio, type RecommendedSlice } from '@/lib/allocation/policy'
import type { AllocationSlice } from '@/components/portfolio/CapitalAllocation'

const SLICE_COLOR: Record<RecommendedSlice['key'], string> = {
  us_stocks:   'bg-accent-cyan',
  intl_stocks: 'bg-sky-500',
  bonds:       'bg-emerald-500',
  cash:        'bg-text-2',
  explore:     'bg-accent-violet',
}

export function policySlices(profileKey: string | null, exploreCapFraction?: number): AllocationSlice[] {
  return recommendedPortfolio(profileKey, exploreCapFraction).map(s => ({
    key: s.key,
    label: s.label,
    recommendedPct: s.pct,
    color: SLICE_COLOR[s.key],
  }))
}
