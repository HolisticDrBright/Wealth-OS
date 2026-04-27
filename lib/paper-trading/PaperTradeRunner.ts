import type { SupabaseClient } from '@supabase/supabase-js'
import { ALL_STRATEGIES } from '@/lib/strategies/all-pipeline-strategies'
import { CIODecisionEngine } from '@/lib/agents/cio-decision-engine'
import { PaperBroker } from './PaperBroker'
import type { PaperRunResult } from './types'

const engine = new CIODecisionEngine()
const broker = new PaperBroker()

/**
 * Run one pass of the paper trading system for a given user:
 * 1. Exit positions that hit stop-loss / take-profit / timeout
 * 2. Mark remaining open positions to market
 * 3. Run detectOpportunities for every strategy
 * 4. For each opportunity, run the CIO pipeline (paperMode=true → no real broker)
 * 5. Fill approved opportunities via PaperBroker
 */
export async function runPaperTradingPass(
  userId: string,
  supabase: SupabaseClient,
  enabledKeys?: string[]
): Promise<PaperRunResult> {
  const runAt = new Date().toISOString()
  const errors: string[] = []
  let opportunitiesFound = 0
  let decisionsExecute = 0
  let decisionsBlock = 0
  let positionsOpened = 0

  // Step 1 & 2 — housekeeping on existing positions
  const positionsClosed = await broker.checkAndExitPositions(supabase, userId)
  await broker.markToMarket(supabase, userId)

  // All strategy keys are enabled in paper mode (including default-disabled ones like cex_latency_arb)
  const allStrategyKeys = ALL_STRATEGIES.map(s => s.key as string)

  const ctx = {
    supabase,
    metadata: {
      userId,
      // Pass all keys so default-disabled strategies (cex_latency_arb) run in paper mode
      userEnabledStrategies: enabledKeys ?? allStrategyKeys,
    },
  }

  const strategiesToRun = enabledKeys
    ? ALL_STRATEGIES.filter(s => enabledKeys.includes(s.key))
    : ALL_STRATEGIES

  // Step 3–5 — detect → decide → fill
  for (const strategy of strategiesToRun) {
    let opps: Awaited<ReturnType<typeof strategy.detectOpportunities>> = []
    try {
      opps = await strategy.detectOpportunities(ctx)
      opportunitiesFound += opps.length
    } catch (err) {
      errors.push(`${strategy.key} detect: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    for (const opp of opps) {
      try {
        const decision = await engine.decide(opp, userId, supabase, undefined, { paperMode: true })

        if (decision.action === 'execute' || decision.action === 'reduce_size') {
          decisionsExecute++
          if (decision.size) {
            const fill = await broker.fill(opp, decision.size, userId, supabase)
            if (fill) positionsOpened++
          }
        } else {
          decisionsBlock++
        }
      } catch (err) {
        errors.push(
          `${strategy.key}/${opp.symbol}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return {
    runAt,
    strategiesRun:    strategiesToRun.length,
    opportunitiesFound,
    decisionsExecute,
    decisionsBlock,
    positionsOpened,
    positionsClosed,
    errors,
  }
}
