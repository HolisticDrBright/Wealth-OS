export const dynamic = 'force-dynamic'

import { Topbar } from '@/components/layout/topbar'
import { Badge } from '@/components/ui/badge'
import { DashboardClient } from './dashboard-client'
import { getCommandCenterData } from '@/lib/actions/command-center'

const REGIME_BADGE: Record<
  string,
  { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  RISK_ON: { label: 'Risk On', variant: 'success' },
  NEUTRAL: { label: 'Neutral', variant: 'default' },
  RISK_OFF: { label: 'Risk Off', variant: 'warning' },
  CRISIS: { label: 'Crisis', variant: 'danger' },
}

export default async function DashboardPage() {
  const data = await getCommandCenterData()
  const badge = REGIME_BADGE[data.regime.regime] ?? REGIME_BADGE.NEUTRAL

  return (
    <div>
      <Topbar
        title="Command Center"
        subtitle="What to do with capital today — and why"
        badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
      />
      <DashboardClient data={data} />
    </div>
  )
}
