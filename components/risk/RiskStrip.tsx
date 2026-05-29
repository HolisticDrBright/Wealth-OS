/**
 * RiskStrip — a compact, read-only row of the user's risk guardrails, so risk is
 * legible on every trading surface (not just /risk). Async server component:
 * reads risk_controls directly (no writes) and falls back to display defaults
 * when unset. Optionally shows a jurisdiction badge (e.g. on Polymarket).
 */
import { createClient } from '@/lib/supabase/server'
import { PositionCapBadge, DrawdownBadge, JurisdictionBadge } from './RiskBadges'
import type { RiskLevel } from '@/lib/risk/levels'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

function bandLevel(pct: number): RiskLevel {
  if (pct <= 10) return 'ok'
  if (pct <= 20) return 'caution'
  return 'risk'
}

interface Props {
  /** Optional jurisdiction status to surface (e.g. Polymarket state gate). */
  jurisdiction?: { level: RiskLevel; value: string } | null
  className?: string
}

export async function RiskStrip({ jurisdiction, className }: Props) {
  let capPct = 10
  let ddPct = 15
  let isDefault = true

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from('risk_controls')
        .select('max_single_position_pct, max_drawdown_pct')
        .eq('user_id', user.id)
        .maybeSingle()
      if (data) {
        capPct = data.max_single_position_pct ?? capPct
        ddPct = data.max_drawdown_pct ?? ddPct
        isDefault = false
      }
    }
  } catch {
    // read-only; fall back to display defaults
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500">
        <ShieldCheck className="h-3.5 w-3.5 text-gray-500" /> Guardrails
      </span>
      <PositionCapBadge level={bandLevel(capPct)} value={`${capPct}%`} title={`Max single position: ${capPct}% of capital`} />
      <DrawdownBadge level={bandLevel(ddPct)} value={`${ddPct}%`} title={`Max drawdown limit: ${ddPct}%`} />
      {jurisdiction && <JurisdictionBadge level={jurisdiction.level} value={jurisdiction.value} />}
      {isDefault && <span className="text-[11px] text-gray-600">defaults · set on Risk Room</span>}
    </div>
  )
}
