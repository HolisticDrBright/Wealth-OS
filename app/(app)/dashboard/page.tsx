export const dynamic = 'force-dynamic'

import { Topbar } from '@/components/layout/topbar'
import { Badge } from '@/components/ui/badge'
import { DashboardClient } from './dashboard-client'
import { BriefPanel } from '@/components/wealth/BriefPanel'
import { getCommandCenterData } from '@/lib/actions/command-center'
import { getWealthBrief } from '@/lib/actions/wealth-brief'

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
  const [data, brief] = await Promise.all([
    getCommandCenterData(),
    getWealthBrief().catch(() => null),
  ])
  const badge = REGIME_BADGE[data.regime.regime] ?? REGIME_BADGE.NEUTRAL

  return (
    <div>
      <Topbar
        title="Command Center"
        subtitle="What to do with capital today — and why"
        badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
      />
      {brief && <div className="px-6 pt-4"><BriefPanel brief={brief} /></div>}
      <DashboardClient data={data} />
    </div>
  )
}
