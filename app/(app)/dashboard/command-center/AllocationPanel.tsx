'use client'

/**
 * Command Center allocation panel — the recommended WHOLE-portfolio mix from
 * the single allocation policy (Core funds + the Explore slice).
 *
 * Previously this compared open strategy positions (all Explore) against the
 * risk_profiles.alloc_* seed, which recommended crypto/options/forex as if
 * they were the whole portfolio. Per-slice "current" values appear once Core
 * holds real paper positions; until then only targets are shown — never
 * fabricated balances.
 */

import { CapitalAllocation } from '@/components/portfolio/CapitalAllocation'
import { policySlices } from '@/components/portfolio/policy-slices'

export function AllocationPanel({ profileKey }: { profileKey: string | null }) {
  return <CapitalAllocation slices={policySlices(profileKey)} currentUnavailable />
}
