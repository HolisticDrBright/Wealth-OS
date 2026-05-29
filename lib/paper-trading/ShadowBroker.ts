import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunity } from '@/lib/strategies/pipeline-types'
import type { AssetClass } from '@/lib/strategies/strategy-registry'
import { fetchCurrentPrice } from './price-feed'

// Mirror the same per-strategy exit thresholds as PaperBroker — shadow
// positions use identical holding constraints so comparisons are apples-to-apples.
const SHADOW_SLIPPAGE_BPS: Partial<Record<AssetClass, number>> = {
  crypto:       5,
  stocks:      10,
  options:     20,
  forex:        3,
  polymarket:  15,
  'multi-asset': 10,
}

interface ExitDefaults { sl: number; tp: number; hours: number }
const STRATEGY_EXIT: Record<string, ExitDefaults> = {
  polymarket_base_rate:          { sl: 0.10, tp: 0.15, hours:  72 },
  polymarket_resolution_rules:   { sl: 0.15, tp: 0.25, hours:  72 },
  polymarket_cross_market:       { sl: 0.25, tp: 0.45, hours: 168 },
  polymarket_liquidity_pocket:   { sl: 0.25, tp: 0.40, hours: 120 },
  polymarket_event_compression:  { sl: 0.20, tp: 0.35, hours: 120 },
  polymarket_narrative_fade:     { sl: 0.20, tp: 0.35, hours: 120 },
  dca_halving:          { sl: 0.10, tp: 0.30, hours: 336 },
  liquidation_hunting:  { sl: 0.02, tp: 0.05, hours:   8 },
  narrative_rotation:   { sl: 0.07, tp: 0.18, hours:  72 },
  onchain_signal:       { sl: 0.08, tp: 0.20, hours: 120 },
  defi_yield:           { sl: 0.05, tp: 0.12, hours: 168 },
  airdrop_farming:      { sl: 0.15, tp: 0.40, hours: 168 },
  memecoin_bondingcurve:{ sl: 0.20, tp: 0.60, hours:  48 },
  fx_trendfollowing:    { sl: 0.007, tp: 0.021, hours: 120 },
  cb_divergence:        { sl: 0.007, tp: 0.021, hours:  72 },
  correlation_divergence:{ sl: 0.010, tp: 0.030, hours: 72 },
  ict_smc:              { sl: 0.006, tp: 0.018, hours:  48 },
  carry_trade:          { sl: 0.015, tp: 0.045, hours: 336 },
  cot_positioning:      { sl: 0.012, tp: 0.036, hours: 240 },
  session_breakout:     { sl: 0.005, tp: 0.015, hours:  48 },
  macro_news_event:     { sl: 0.006, tp: 0.018, hours:  24 },
  triangular_arb:       { sl: 0.003, tp: 0.009, hours:   6 },
  pead:                 { sl: 0.03, tp: 0.08, hours: 120 },
  autopilot_congressional:{ sl: 0.05, tp: 0.15, hours: 240 },
  quant_momentum:       { sl: 0.05, tp: 0.12, hours: 120 },
  qvm_multifactor:      { sl: 0.06, tp: 0.15, hours: 168 },
  dividend_aristocrat:  { sl: 0.08, tp: 0.15, hours: 504 },
  sector_rotation:      { sl: 0.05, tp: 0.10, hours: 168 },
  options_wheel:        { sl: 0.10, tp: 0.20, hours: 336 },
  gamma_exposure:       { sl: 0.03, tp: 0.08, hours:  48 },
  merger_arb:           { sl: 0.03, tp: 0.05, hours: 336 },
  spinoff:              { sl: 0.07, tp: 0.20, hours: 504 },
  tail_risk_hedging:    { sl: 0.20, tp: 0.40, hours: 168 },
}

function exitFor(strategyKey: string): ExitDefaults {
  return STRATEGY_EXIT[strategyKey] ?? { sl: 0.02, tp: 0.05, hours: 72 }
}

export class ShadowBroker {
  /**
   * Create a shadow position for a blocked opportunity.
   * Returns true if a shadow position was created, false if no price was available.
   */
  async track(
    opp: Opportunity,
    skipReason: string,
    skipDetail: string | null,
    userId: string,
    supabase: SupabaseClient,
    notionalUsd = 500,
  ): Promise<boolean> {
    const price = await fetchCurrentPrice(opp.symbol, opp.assetClass)
    if (!price || price <= 0) return false

    const slippageBps = SHADOW_SLIPPAGE_BPS[opp.assetClass as AssetClass] ?? 10
    const slip = price * slippageBps / 10_000
    const entryPrice = opp.direction === 'short' ? price - slip : price + slip
    const qty = notionalUsd / entryPrice

    const exits = exitFor(opp.strategyKey)

    const { error } = await supabase.from('shadow_positions').insert({
      user_id:              userId,
      strategy_key:         opp.strategyKey,
      symbol:               opp.symbol,
      asset_class:          opp.assetClass,
      direction:            opp.direction ?? 'long',
      would_have_price:     entryPrice,
      would_have_notional:  notionalUsd,
      would_have_quantity:  qty,
      skip_reason:          skipReason,
      skip_detail:          skipDetail,
      stop_loss_pct:        exits.sl,
      take_profit_pct:      exits.tp,
      max_hold_hours:       exits.hours,
    })

    if (error) {
      console.warn('[shadow] insert error:', error.message)
      return false
    }
    return true
  }

  /** Mark all open shadow positions to current market price. */
  async markToMarket(supabase: SupabaseClient, userId: string): Promise<void> {
    const { data: positions } = await supabase
      .from('shadow_positions')
      .select('id, symbol, asset_class, direction, would_have_price, would_have_quantity, would_have_notional')
      .eq('user_id', userId)
      .eq('status', 'open')

    if (!positions?.length) return

    for (const pos of positions) {
      const currentPrice = await fetchCurrentPrice(pos.symbol, pos.asset_class)
      if (!currentPrice || currentPrice <= 0) continue

      const direction = pos.direction as 'long' | 'short'
      const rawPnlPct = direction === 'long'
        ? (currentPrice - pos.would_have_price) / pos.would_have_price
        : (pos.would_have_price - currentPrice) / pos.would_have_price
      const pnlUsd = rawPnlPct * (pos.would_have_notional ?? 500)

      await supabase
        .from('shadow_positions')
        .update({ current_price: currentPrice, unrealized_pnl_usd: pnlUsd, unrealized_pnl_pct: rawPnlPct })
        .eq('id', pos.id)
    }
  }

  /**
   * Check open shadow positions against stop-loss, take-profit, and timeout.
   * Returns the count of positions that were closed.
   */
  async checkAndExitShadowPositions(supabase: SupabaseClient, userId: string): Promise<number> {
    const { data: positions } = await supabase
      .from('shadow_positions')
      .select('id, symbol, asset_class, direction, would_have_price, would_have_quantity, would_have_notional, stop_loss_pct, take_profit_pct, max_hold_hours, created_at')
      .eq('user_id', userId)
      .eq('status', 'open')

    if (!positions?.length) return 0

    let closed = 0
    const now = Date.now()

    for (const pos of positions) {
      const currentPrice = await fetchCurrentPrice(pos.symbol, pos.asset_class)
      if (!currentPrice || currentPrice <= 0) continue

      const direction = pos.direction as 'long' | 'short'
      const rawPnlPct = direction === 'long'
        ? (currentPrice - pos.would_have_price) / pos.would_have_price
        : (pos.would_have_price - currentPrice) / pos.would_have_price

      const hoursHeld = (now - new Date(pos.created_at).getTime()) / 3_600_000
      const hitStop   = rawPnlPct <= -(pos.stop_loss_pct ?? 0.02)
      const hitTarget = rawPnlPct >= (pos.take_profit_pct ?? 0.05)
      const timedOut  = hoursHeld >= (pos.max_hold_hours ?? 72)

      if (!hitStop && !hitTarget && !timedOut) continue

      const exitReason = hitStop ? 'stop_loss' : hitTarget ? 'take_profit' : 'timeout'
      const pnlUsd = rawPnlPct * (pos.would_have_notional ?? 500)

      await supabase
        .from('shadow_positions')
        .update({
          status:            'closed',
          exit_price:        currentPrice,
          exit_reason:       exitReason,
          realized_pnl_usd:  pnlUsd,
          realized_pnl_pct:  rawPnlPct,
          resolved_at:       new Date().toISOString(),
        })
        .eq('id', pos.id)

      closed++
    }

    return closed
  }
}
