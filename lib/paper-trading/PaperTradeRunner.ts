import type { SupabaseClient } from '@supabase/supabase-js'
import { ALL_STRATEGIES } from '@/lib/strategies/all-pipeline-strategies'
import { CIODecisionEngine } from '@/lib/agents/cio-decision-engine'
import { PaperBroker } from './PaperBroker'
import { ShadowBroker } from './ShadowBroker'
import type { PaperRunResult, SkippedDetail, SkipCounts } from './types'
import { emptySkipCounts } from './types'
import { getUserStateOfResidence, isVenueAllowedInState } from '@/lib/risk-profile/state-gate'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'
import { checkPolymarketValidity } from './polymarket-validity'
import { computeBookExposures, gateThroughBook } from '@/lib/risk/book-allocation'
import { bookFor } from '@/lib/strategies/strategy-books'
import { detectRegime } from '@/lib/regime/cross-asset-regime'

const engine = new CIODecisionEngine()
const broker = new PaperBroker()
const shadow = new ShadowBroker()

// Outcomes that warrant a shadow position — real market prices exist and the
// block is a decision gate decision, not a data quality issue.
const SHADOW_TRACKABLE = new Set(['block', 'profileBlocked', 'riskBlocked', 'venueBlocked', 'positionCapBlocked', 'liquidityBlocked'])

function classifyBlockReason(reason: string): keyof SkipCounts {
  const r = reason.toLowerCase()
  if (r.includes('not enabled for profile') || r.includes('profile')) return 'profileBlocked'
  if (r.includes('risk veto') || r.includes('risk ')) return 'riskBlocked'
  if (r.includes('kronos') || r.includes('mirofish') || r.includes('red team')) return 'riskBlocked'
  if (r.includes('order book') || r.includes('liquidity')) return 'liquidityBlocked'
  if (r.includes('correlation') || r.includes('cap')) return 'positionCapBlocked'
  return 'riskBlocked'
}

function skipDetail(
  strategyKey: string,
  symbol: string,
  assetClass: string,
  outcome: string,
  reason: string,
  direction?: string,
  opportunityId?: string,
): SkippedDetail {
  return { strategyKey, symbol, assetClass, direction, outcome, reason, opportunityId, timestamp: new Date().toISOString() }
}

/**
 * Run one pass of the paper trading system for a given user:
 * 1. Exit positions that hit stop-loss / take-profit / timeout
 * 2. Mark remaining open positions to market
 * 3. Run detectOpportunities for every strategy
 * 4. For each opportunity, run the CIO pipeline (paperMode=true → no real broker)
 * 5. Fill approved opportunities via PaperBroker
 * 6. Persist a full run record to paper_trade_runs
 */
export async function runPaperTradingPass(
  userId: string,
  supabase: SupabaseClient,
  enabledKeys?: string[]
): Promise<PaperRunResult> {
  const runAt = new Date().toISOString()
  const errors: string[] = []
  const skipped: SkipCounts = emptySkipCounts()
  const skippedDetails: SkippedDetail[] = []
  let opportunitiesFound = 0
  let decisionsExecute = 0
  let decisionsBlock = 0
  let positionsOpened = 0

  // Step 1 & 2 — housekeeping on existing positions
  const positionsClosed = await broker.checkAndExitPositions(supabase, userId)
  await broker.markToMarket(supabase, userId)
  await shadow.checkAndExitShadowPositions(supabase, userId)
  await shadow.markToMarket(supabase, userId)

  // Load user state once; used for venue gating below
  const userState = await getUserStateOfResidence(supabase, userId)

  // Book-level risk allocation: live exposure per book + current regime.
  // Both are defensive — failures fall back to neutral (no extra restriction
  // beyond the existing controls, which all still apply).
  const regime = await detectRegime().then(r => r.regime as string).catch(() => 'NEUTRAL')
  const bookState = await computeBookExposures(supabase, userId).catch(() => ({
    totalNotionalUsd: 0,
    byBook: {} as Record<string, number>,
  }))

  const allStrategyKeys = ALL_STRATEGIES.map(s => s.key as string)

  const ctx = {
    supabase,
    metadata: {
      userId,
      userEnabledStrategies: enabledKeys ?? allStrategyKeys,
    },
  }

  const strategiesToRun = enabledKeys
    ? ALL_STRATEGIES.filter(s => enabledKeys.includes(s.key))
    : ALL_STRATEGIES

  // Step 3–5 — detect → decide → fill
  for (const strategy of strategiesToRun) {
    const key = strategy.key as StrategyKey
    const cfg = STRATEGY_REGISTRY_CONFIG[key as keyof typeof STRATEGY_REGISTRY_CONFIG]

    // Immature strategies may not paper trade
    if (cfg?.maturityStatus === 'stub' || cfg?.maturityStatus === 'backtest_ready') {
      skipped.strategyImmature++
      skippedDetails.push(skipDetail(
        key, '—', cfg?.assetClass ?? 'unknown',
        'strategyImmature',
        `Strategy ${key} is ${cfg.maturityStatus} — not ready for paper trading.`,
      ))
      continue
    }

    // Gate venue-banned strategies (e.g. polymarket in MN)
    if (userState) {
      const venue = cfg?.assetClass === 'polymarket' ? cfg.defaultBroker : null
      if (venue && venue !== 'alpaca') {
        const allowed = await isVenueAllowedInState(supabase, venue, userState)
        if (!allowed) {
          skipped.venueBlocked++
          skippedDetails.push(skipDetail(
            key, '—', cfg?.assetClass ?? 'unknown',
            'venueBlocked',
            `Venue ${venue} is not permitted in ${userState}.`,
          ))
          continue
        }
      }
    }

    let opps: Awaited<ReturnType<typeof strategy.detectOpportunities>> = []
    try {
      opps = await strategy.detectOpportunities(ctx)
      opportunitiesFound += opps.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${key} detect: ${msg}`)
      continue
    }

    for (const opp of opps) {
      // Polymarket validity gate — check before handing to CIO or broker
      if (opp.assetClass === 'polymarket') {
        const validity = await checkPolymarketValidity(opp.symbol)
        if (!validity.valid) {
          const code = validity.code
          if (code === 'expired_market') skipped.expiredMarket++
          else if (code === 'resolved_market') skipped.resolvedMarket++
          else skipped.missingPrice++
          skippedDetails.push(skipDetail(
            key, opp.symbol, 'polymarket', code, validity.reason, opp.direction, opp.id,
          ))
          continue
        }
      }

      try {
        const decision = await engine.decide(opp, userId, supabase, undefined, { paperMode: true })

        if (decision.action === 'execute' || decision.action === 'reduce_size') {
          decisionsExecute++

          if (!decision.size || decision.size.notionalUsd <= 0) {
            skipped.noSize++
            skippedDetails.push(skipDetail(
              key, opp.symbol, opp.assetClass, 'noSize',
              'CIO engine returned execute but position sizer produced zero notional.',
              opp.direction, opp.id,
            ))
            continue
          }

          // Book-level gate: regime rotation + book notional cap. Only ever
          // reduces size — never bypasses or inflates upstream controls.
          const book = bookFor(key)
          const bookGate = gateThroughBook({
            strategyKey: key,
            proposedNotionalUsd: decision.size.notionalUsd,
            regime,
            totalNotionalUsd: bookState.totalNotionalUsd,
            bookNotionalUsd: bookState.byBook[book] ?? 0,
          })

          if (!bookGate.allowed) {
            skipped.positionCapBlocked++
            skippedDetails.push(skipDetail(
              key, opp.symbol, opp.assetClass, 'bookCapBlocked',
              bookGate.reason ?? `${book} book budget exhausted.`,
              opp.direction, opp.id,
            ))
            shadow.track(opp, 'positionCapBlocked', bookGate.reason, userId, supabase).catch(() => {})
            continue
          }

          const sizedNotional = decision.size.notionalUsd * bookGate.multiplier
          const gatedSize = bookGate.multiplier < 1
            ? { ...decision.size, notionalUsd: sizedNotional, rationale: `${decision.size.rationale} | ${bookGate.reason}` }
            : decision.size

          const fill = await broker.fill(opp, gatedSize, userId, supabase)

          if (fill.status === 'opened') {
            positionsOpened++
            // Keep book exposure current within this run so later
            // opportunities see the notional we just added.
            bookState.totalNotionalUsd += sizedNotional
            bookState.byBook[book] = (bookState.byBook[book] ?? 0) + sizedNotional
          } else {
            // Map broker result status to skip counter
            const { status, reason } = fill
            if (status === 'already_open') skipped.alreadyOpen++
            else if (status === 'missing_price' || status === 'invalid_price') skipped.missingPrice++
            else if (status === 'no_size') skipped.noSize++
            else if (status === 'insert_error') skipped.other++
            else skipped.other++
            skippedDetails.push(skipDetail(
              key, opp.symbol, opp.assetClass, status, reason, opp.direction, opp.id,
            ))
          }
        } else {
          // action === 'block'
          decisionsBlock++
          const reason = (decision as { reason?: string }).reason ?? 'blocked by CIO pipeline'
          const counter = classifyBlockReason(reason)
          skipped[counter]++
          skippedDetails.push(skipDetail(
            key, opp.symbol, opp.assetClass, 'block', reason, opp.direction, opp.id,
          ))
          // Shadow-track CIO blocks so we can compare them against accepted trades
          if (SHADOW_TRACKABLE.has('block')) {
            shadow.track(opp, counter, reason, userId, supabase).catch(() => {})
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${key}/${opp.symbol}: ${msg}`)
        skipped.other++
        skippedDetails.push(skipDetail(
          key, opp.symbol, opp.assetClass, 'error', msg, opp.direction, opp.id,
        ))
      }
    }
  }

  const result: PaperRunResult = {
    runAt,
    strategiesRun:    strategiesToRun.length,
    opportunitiesFound,
    decisionsExecute,
    decisionsBlock,
    positionsOpened,
    positionsClosed,
    skipped,
    skippedDetails,
    errors,
  }

  // Persist run record (fire-and-forget — never blocks the response)
  supabase.from('paper_trade_runs').insert({
    user_id:             userId,
    run_at:              runAt,
    strategies_run:      result.strategiesRun,
    opportunities_found: result.opportunitiesFound,
    decisions_execute:   result.decisionsExecute,
    decisions_block:     result.decisionsBlock,
    positions_opened:    result.positionsOpened,
    positions_closed:    result.positionsClosed,
    skipped:             result.skipped,
    skipped_details:     result.skippedDetails,
    errors:              result.errors,
  }).then(({ error }) => {
    if (error) console.warn('[paper-trading] run record error:', error.message)
  })

  return result
}
