import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunity, PositionSize } from '@/lib/strategies/pipeline-types'
import type { AssetClass } from '@/lib/strategies/strategy-registry'
import { fetchCurrentPrice } from './price-feed'

// Realistic one-way slippage estimates per asset class (bps)
const SLIPPAGE_BPS: Partial<Record<AssetClass, number>> = {
  crypto:       5,
  stocks:      10,
  options:     20,
  forex:        3,
  polymarket:  15,
  'multi-asset': 10,
}

// Exit thresholds applied per position (overridable via metadata)
const DEFAULT_STOP_LOSS_PCT   = 0.02   // -2%
const DEFAULT_TAKE_PROFIT_PCT = 0.05   // +5%
const DEFAULT_MAX_HOLD_HOURS  = 24

// How many calendar days after open to grade the outcome in the learning loop
const LEARNING_HORIZON_DAYS: Partial<Record<AssetClass, number>> = {
  stocks:       5,
  options:      5,
  crypto:       3,
  forex:        2,
  'multi-asset': 3,
}

export class PaperBroker {
  // ── Open a new paper position ──────────────────────────────────────────────

  async fill(
    opp: Opportunity,
    size: PositionSize,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ id: string } | null> {
    // Deduplication: skip if this user already has an open position for this strategy+symbol
    const { count } = await supabase
      .from('paper_positions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('strategy_key', opp.strategyKey)
      .eq('symbol', opp.symbol)
      .eq('status', 'open')
    if ((count ?? 0) > 0) return null

    const price = await fetchCurrentPrice(opp.symbol, opp.assetClass)
    if (price == null || !isFinite(price) || price <= 0) {
      console.warn(`[PaperBroker] no price for ${opp.symbol} (${opp.assetClass}) — skipping fill`)
      return null
    }

    const slippageBps = SLIPPAGE_BPS[opp.assetClass] ?? 10
    const slip = price * slippageBps / 10_000
    // Longs pay the ask (+slip); shorts receive the bid (-slip); neutral enters at mid
    const fillPrice = opp.direction === 'long' ? price + slip
      : opp.direction === 'short' ? price - slip
      : price
    if (fillPrice <= 0) return null

    const quantity = size.notionalUsd / fillPrice

    const { data: pos, error } = await supabase
      .from('paper_positions')
      .insert({
        user_id:         userId,
        strategy_key:    opp.strategyKey,
        symbol:          opp.symbol,
        asset_class:     opp.assetClass,
        direction:       opp.direction,
        entry_price:     fillPrice,
        current_price:   price,
        quantity,
        notional_usd:    size.notionalUsd,
        stop_loss_pct:   DEFAULT_STOP_LOSS_PCT,
        take_profit_pct: DEFAULT_TAKE_PROFIT_PCT,
        max_hold_hours:  DEFAULT_MAX_HOLD_HOURS,
        metadata: {
          opportunityId: opp.id,
          strength:      opp.strength,
          expectedReturn: opp.expectedReturn,
          rationale:     size.rationale,
          ...opp.metadata,
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[PaperBroker] position insert error:', error.message)
      return null
    }

    await supabase.from('paper_trades').insert({
      user_id:        userId,
      position_id:    pos.id,
      strategy_key:   opp.strategyKey,
      symbol:         opp.symbol,
      asset_class:    opp.assetClass,
      direction:      opp.direction,
      side:           'open',
      fill_price:     fillPrice,
      quantity,
      notional_usd:   size.notionalUsd,
      slippage_bps:   slippageBps,
      opportunity_id: opp.id,
      metadata:       opp.metadata,
    })

    // Write to decision_log so the learning loop can grade this trade once the horizon passes.
    // Skip polymarket (conditionId-based symbols can't be priced via Yahoo Finance for grading).
    if (opp.assetClass !== 'polymarket') {
      const horizonDays = LEARNING_HORIZON_DAYS[opp.assetClass] ?? 5
      const resolutionDue = new Date(Date.now() + horizonDays * 86_400_000).toISOString()
      supabase.from('decision_log').insert({
        user_id:            userId,
        strategy:           opp.strategyKey,
        symbol:             opp.symbol,
        confidence:         Math.min(1, Math.max(0, opp.strength)),
        direction:          opp.direction,
        horizon_days:       horizonDays,
        resolution_due_at:  resolutionDue,
        outcome_graded:     false,
        paper_position_id:  pos.id,
      }).then(({ error: e }) => {
        if (e) console.warn('[PaperBroker] decision_log insert error:', e.message)
      })
    }

    console.log(
      `[PaperBroker] ✓ opened ${opp.strategyKey} ${opp.direction.toUpperCase()} ` +
      `${opp.symbol} @ $${fillPrice.toFixed(4)} notional=$${size.notionalUsd.toFixed(2)}`
    )
    return { id: pos.id }
  }

  // ── Mark all open positions to current market price ────────────────────────

  async markToMarket(supabase: SupabaseClient, userId: string): Promise<void> {
    const { data: positions } = await supabase
      .from('paper_positions')
      .select('id, symbol, asset_class, direction, entry_price, quantity, notional_usd')
      .eq('user_id', userId)
      .eq('status', 'open')

    if (!positions?.length) return

    await Promise.all(positions.map(async (pos) => {
      const currentPrice = await fetchCurrentPrice(
        pos.symbol as string,
        pos.asset_class as AssetClass
      )
      if (currentPrice == null) return

      const entryP = pos.entry_price as number
      const qty    = pos.quantity as number
      const pnlUsd = pos.direction === 'long'  ? (currentPrice - entryP) * qty
        : pos.direction === 'short' ? (entryP - currentPrice) * qty
        : 0
      const pnlPct = (pos.notional_usd as number) > 0 ? pnlUsd / (pos.notional_usd as number) : 0

      await supabase
        .from('paper_positions')
        .update({ current_price: currentPrice, unrealized_pnl_usd: pnlUsd, unrealized_pnl_pct: pnlPct })
        .eq('id', pos.id)
    }))
  }

  // ── Check and close positions that hit their exit conditions ───────────────

  async checkAndExitPositions(supabase: SupabaseClient, userId: string): Promise<number> {
    const { data: positions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')

    if (!positions?.length) return 0

    let closed = 0

    await Promise.all(positions.map(async (pos) => {
      const currentPrice = await fetchCurrentPrice(
        pos.symbol as string,
        pos.asset_class as AssetClass
      )
      if (currentPrice == null) return

      const entryPrice = pos.entry_price as number
      const pnlPct = pos.direction === 'long'  ? (currentPrice - entryPrice) / entryPrice
        : pos.direction === 'short' ? (entryPrice - currentPrice) / entryPrice
        : 0

      const ageHours = (Date.now() - new Date(pos.opened_at as string).getTime()) / 3_600_000

      let exitReason: string | null = null
      if      (pnlPct <= -(pos.stop_loss_pct   as number)) exitReason = 'stop_loss'
      else if (pnlPct >=  (pos.take_profit_pct as number)) exitReason = 'take_profit'
      else if (ageHours  >= (pos.max_hold_hours  as number)) exitReason = 'timeout'
      if (!exitReason) return

      // Exits also incur slippage (adverse to the position)
      const slippageBps = SLIPPAGE_BPS[pos.asset_class as AssetClass] ?? 10
      const slip = currentPrice * slippageBps / 10_000
      const exitPrice = pos.direction === 'long'  ? currentPrice - slip
        : pos.direction === 'short' ? currentPrice + slip
        : currentPrice

      const qty = pos.quantity as number
      const pnlUsd = pos.direction === 'long'  ? (exitPrice - entryPrice) * qty
        : pos.direction === 'short' ? (entryPrice - exitPrice) * qty
        : 0
      const realizedPct = (pos.notional_usd as number) > 0 ? pnlUsd / (pos.notional_usd as number) : 0

      await supabase.from('paper_positions').update({
        status:            'closed',
        closed_at:         new Date().toISOString(),
        current_price:     currentPrice,
        exit_price:        exitPrice,
        realized_pnl_usd:  pnlUsd,
        realized_pnl_pct:  realizedPct,
        exit_reason:       exitReason,
        unrealized_pnl_usd: null,
        unrealized_pnl_pct: null,
      }).eq('id', pos.id)

      await supabase.from('paper_trades').insert({
        user_id:      userId,
        position_id:  pos.id,
        strategy_key: pos.strategy_key,
        symbol:       pos.symbol,
        asset_class:  pos.asset_class,
        direction:    pos.direction,
        side:         'close',
        fill_price:   exitPrice,
        quantity:     pos.quantity,
        notional_usd: pos.notional_usd,
        slippage_bps: slippageBps,
        metadata:     { exit_reason: exitReason, pnl_pct: realizedPct, pnl_usd: pnlUsd },
      })

      const sign = pnlUsd >= 0 ? '+' : ''
      console.log(
        `[PaperBroker] ✓ closed ${pos.strategy_key as string} ${pos.symbol as string} ` +
        `→ ${exitReason} ${sign}${(realizedPct * 100).toFixed(2)}% (${sign}$${pnlUsd.toFixed(2)})`
      )
      closed++
    }))

    return closed
  }
}
