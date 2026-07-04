export const dynamic = 'force-dynamic'

import { Topbar } from '@/components/layout/topbar'
import { Badge } from '@/components/ui/badge'
import { getPaperValidationData } from '@/lib/actions/paper-validation'
import { PaperValidationClient } from './paper-validation-client'

export default async function PaperTradingPage() {
  const data = await getPaperValidationData()
  return (
    <div>
      <Topbar
        title="Paper Trading Validation"
        subtitle="Operator console for the multi-month paper validation phase — modeled fills, not live results"
        badge={
          data.safety.liveTradingEnabled
            ? <Badge variant="danger">LIVE SWITCH ON — PROTOCOL VIOLATION</Badge>
            : <Badge variant="success">Live trading disabled</Badge>
        }
      />
      <PaperValidationClient data={data} />
    </div>
  )
}
