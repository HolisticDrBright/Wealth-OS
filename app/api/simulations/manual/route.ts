/**
 * POST /api/simulations/manual
 *
 * Lets an authenticated user manually fire a MiroFish simulation for any
 * eligible strategy. Respects the user's feature flag exactly like the
 * auto-simulate worker — 'skip' strategies are rejected, budget gating applies.
 *
 * Body: { strategyKey, marketId?, scenario?, regime? }
 *
 * Response:
 *   200 { skipped: false, score, report, costCents }
 *   200 { skipped: true,  reason }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { runAutoSimulate } from '@/lib/workers/auto-simulate'
import { isStrategyKey } from '@/lib/strategies/strategy-registry'
import type { SimulationRegime } from '@/lib/workers/auto-simulate'

export async function POST(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx

  const body = await req.json().catch(() => ({})) as {
    strategyKey?: string
    marketId?: string
    scenario?: string
    regime?: SimulationRegime
  }

  const { strategyKey, marketId, scenario, regime } = body

  if (!strategyKey) {
    return NextResponse.json({ error: 'strategyKey is required' }, { status: 400 })
  }
  if (!isStrategyKey(strategyKey)) {
    return NextResponse.json({ error: `Unknown strategyKey: ${strategyKey}` }, { status: 400 })
  }

  const result = await runAutoSimulate(supabase, {
    tradeId: `manual_${Date.now()}`,
    userId,
    strategyKey,
    seedContent: scenario ?? `Manual simulation for ${strategyKey}${marketId ? ` on market ${marketId}` : ''}`,
    predictionQuery: `What is the expected outcome for the ${strategyKey} strategy${marketId ? ` on market ${marketId}` : ''}?`,
    regime,
  })

  return NextResponse.json(result)
}
