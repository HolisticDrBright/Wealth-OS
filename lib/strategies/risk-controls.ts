/**
 * Risk control helpers — reads user's RiskControl row and provides
 * per-strategy sizing utilities used by every sizePosition() override.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskControl } from '@/lib/types'

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_RISK_CONTROL: Omit<RiskControl, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  max_portfolio_risk_pct: 2,      // 2% of portfolio at risk at any time
  max_single_position_pct: 10,   // 10% per position max
  max_drawdown_pct: 20,          // exit if portfolio DD > 20%
  stop_loss_enabled: true,
  daily_loss_limit_usd: undefined,
  volatility_threshold: 'medium',
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function getRiskControl(
  supabase: SupabaseClient,
  userId: string
): Promise<typeof DEFAULT_RISK_CONTROL> {
  try {
    const { data } = await supabase
      .from('risk_controls')
      .select('max_portfolio_risk_pct, max_single_position_pct, max_drawdown_pct, stop_loss_enabled, daily_loss_limit_usd, volatility_threshold')
      .eq('user_id', userId)
      .single()
    return data ?? DEFAULT_RISK_CONTROL
  } catch {
    return DEFAULT_RISK_CONTROL
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Compute dollar risk per trade from account size and risk controls.
 *
 * @param portfolioUsd   Total portfolio value
 * @param riskPctPerTrade  e.g. 0.01 for 1% risk per trade
 * @param rc             User's risk control settings
 */
export function computePositionSize(
  portfolioUsd: number,
  riskPctPerTrade: number,
  rc: typeof DEFAULT_RISK_CONTROL,
  entryPrice: number,
  stopPrice: number
): { notionalUsd: number; shares: number; fraction: number } {
  const dollarRisk = portfolioUsd * Math.min(riskPctPerTrade, rc.max_portfolio_risk_pct / 100)
  const priceRisk = Math.abs(entryPrice - stopPrice)
  const shares = priceRisk > 0 ? Math.floor(dollarRisk / priceRisk) : 0
  const notionalUsd = Math.min(shares * entryPrice, portfolioUsd * (rc.max_single_position_pct / 100))
  const fraction = notionalUsd / portfolioUsd
  return { notionalUsd, shares: Math.floor(notionalUsd / entryPrice), fraction }
}

/**
 * Quarter-Kelly sizing cap.
 *
 * @param winProb   Estimated win probability [0,1]
 * @param winLoss   Average win-to-loss ratio (e.g. 2 = wins are 2× losses)
 * @returns Fraction of capital [0,1]
 */
export function quarterKelly(winProb: number, winLoss: number): number {
  const q = 1 - winProb
  const kelly = winProb - q / winLoss
  return Math.max(0, kelly / 4)  // quarter-Kelly for conservatism
}

/**
 * Apply confluence haircuts from MiroFish / Kronos verdicts.
 *
 * -25% if MiroFish verdict is neutral/bear
 * -50% if Kronos blocks (pass=false)
 */
export function applyConfluenceHaircut(
  baseFraction: number,
  miroScore: number | null,
  kronosPass: boolean | null
): number {
  let f = baseFraction
  if (miroScore !== null && miroScore < 55) f *= 0.75   // -25% for weak/bear MF
  if (kronosPass === false) f *= 0.50                    // -50% for Kronos block
  return f
}

/**
 * Fetch the user's total portfolio value from the assets table.
 *
 * Returns null when equity cannot be established (query error, no assets,
 * zero value). Callers must REFUSE to size on null — sizing off a default
 * means live orders sized off fiction.
 */
export async function getPortfolioUsd(
  supabase: SupabaseClient,
  userId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('assets')
      .select('current_value')
      .eq('user_id', userId)
    if (error) return null
    const total = (data ?? []).reduce(
      (s: number, r: { current_value: number }) => s + (r.current_value ?? 0), 0)
    return total > 0 ? total : null
  } catch {
    return null
  }
}
