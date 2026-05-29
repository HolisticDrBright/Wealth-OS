'use client'

import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import { OpportunityCard, type OppCardData } from '@/components/opportunities/OpportunityCard'
import { Button } from '@/components/ui/button'
import { Target } from 'lucide-react'
import Link from 'next/link'
import type { OpportunityView } from '@/lib/actions/command-center'

/** Map a screener score (0–100 by convention) to a sensible expected-edge %. */
function scoreToEdgePct(score: number | null): number | null {
  if (score == null || !isFinite(score)) return null
  // Only treat clearly-scaled scores as edge; otherwise omit rather than fabricate.
  if (score <= 0 || score > 100) return null
  // Conservative: a 100 score implies ~10% expected edge.
  return Math.round((score / 10) * 10) / 10
}

function actionToDirection(action: string | null): OppCardData['direction'] {
  if (!action) return 'neutral'
  const a = action.toLowerCase()
  if (a === 'buy') return 'long'
  if (a === 'sell') return 'short'
  return 'neutral'
}

export function OpportunitiesPanel({ opportunities }: { opportunities: OpportunityView[] }) {
  return (
    <Panel icon={Target} title="Today's Best Opportunities">
      {opportunities.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No opportunities surfaced yet"
          hint="Run the screener on /opportunities to populate fresh ideas."
          action={
            <Link href="/opportunities">
              <Button variant="outline" size="sm">Open screener</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {opportunities.map(o => {
            const opp: OppCardData = {
              id: o.id,
              action: o.action ? o.action.toUpperCase() : undefined,
              direction: actionToDirection(o.action),
              symbol: o.symbol ?? undefined,
              title: o.title,
              assetClass: o.assetClass ?? undefined,
              whyNow: o.whyNow ?? undefined,
              expectedEdgePct: scoreToEdgePct(o.score),
              // Dashboard ideas are suggestions only — paper-trade, never live.
              tradeability: 'paper_only',
            }
            return <OpportunityCard key={o.id} opp={opp} />
          })}
        </div>
      )}
    </Panel>
  )
}
