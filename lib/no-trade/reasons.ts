/**
 * No-Trade Ledger taxonomy — the canonical set of reasons Wealth OS declines to
 * act on an opportunity. Pure data + helpers, usable on server and client.
 *
 * The product stance: *not* trading is a deliberate, valuable decision. Every
 * skipped opportunity should map to one of these reasons so the user can see the
 * discipline at work rather than an empty list.
 */

import type { Tone } from '@/lib/strategies/strategy-display'

export type NoTradeReasonCode =
  // ── CIO decision-level codes ──────────────────────────────────────────────
  | 'edge_after_fees'
  | 'spread_too_wide'
  | 'liquidity_too_low'
  | 'calibration_weak'
  | 'strategy_retired'
  | 'strategy_planned'
  | 'risk_profile_mismatch'
  | 'correlation_too_high'
  | 'jurisdiction_blocked'
  | 'red_team_rejected'
  | 'agents_contradicted'
  | 'missing_data'
  // ── Broker / runner-level skip codes ─────────────────────────────────────
  | 'already_open'
  | 'missing_price'
  | 'expired_market'
  | 'resolved_market'
  | 'venue_blocked'
  | 'position_cap'
  | 'strategy_disabled'
  | 'strategy_immature'
  | 'no_size'

export interface NoTradeReasonMeta {
  code: NoTradeReasonCode
  label: string
  /** One-line, non-technical explanation shown under the label. */
  blurb: string
  tone: Tone
}

export const NO_TRADE_REASONS: Record<NoTradeReasonCode, NoTradeReasonMeta> = {
  edge_after_fees: {
    code: 'edge_after_fees',
    label: 'Edge after fees',
    blurb: 'The expected gain no longer covered trading costs and slippage.',
    tone: 'caution',
  },
  spread_too_wide: {
    code: 'spread_too_wide',
    label: 'Spread too wide',
    blurb: 'The bid/ask gap was too large to enter at a fair price.',
    tone: 'caution',
  },
  liquidity_too_low: {
    code: 'liquidity_too_low',
    label: 'Liquidity too low',
    blurb: 'Too thin to size the position without moving the market.',
    tone: 'caution',
  },
  calibration_weak: {
    code: 'calibration_weak',
    label: 'Calibration weak',
    blurb: 'The strategy/agents have not been accurate enough recently to trust this call.',
    tone: 'info',
  },
  strategy_retired: {
    code: 'strategy_retired',
    label: 'Strategy retired',
    blurb: 'This strategy was decommissioned and is not allowed to trade.',
    tone: 'danger',
  },
  strategy_planned: {
    code: 'strategy_planned',
    label: 'Strategy planned',
    blurb: 'This strategy is a placeholder with no live signal logic yet.',
    tone: 'neutral',
  },
  risk_profile_mismatch: {
    code: 'risk_profile_mismatch',
    label: 'Profile mismatch',
    blurb: 'This opportunity is outside the strategies your risk profile allows.',
    tone: 'info',
  },
  correlation_too_high: {
    code: 'correlation_too_high',
    label: 'Correlated exposure',
    blurb: 'Too similar to positions you already hold — would concentrate risk.',
    tone: 'caution',
  },
  jurisdiction_blocked: {
    code: 'jurisdiction_blocked',
    label: 'Jurisdiction',
    blurb: 'Not permitted in your state/country of residence.',
    tone: 'danger',
  },
  red_team_rejected: {
    code: 'red_team_rejected',
    label: 'Red Team rejected',
    blurb: 'The adversarial reviewer found a flaw that outweighed the thesis.',
    tone: 'danger',
  },
  agents_contradicted: {
    code: 'agents_contradicted',
    label: 'Agents contradicted',
    blurb: 'The simulation and predictor disagreed with the signal.',
    tone: 'caution',
  },
  missing_data: {
    code: 'missing_data',
    label: 'Missing data',
    blurb: 'A required market feed or integration was unavailable.',
    tone: 'neutral',
  },
  already_open: {
    code: 'already_open',
    label: 'Already open',
    blurb: 'This strategy already has an open position in this symbol.',
    tone: 'neutral',
  },
  missing_price: {
    code: 'missing_price',
    label: 'No price',
    blurb: 'The price feed returned no data for this symbol.',
    tone: 'caution',
  },
  expired_market: {
    code: 'expired_market',
    label: 'Market expired',
    blurb: 'This Polymarket contract passed its end date and is no longer tradable.',
    tone: 'neutral',
  },
  resolved_market: {
    code: 'resolved_market',
    label: 'Market resolved',
    blurb: 'This Polymarket contract already resolved — no fill possible.',
    tone: 'neutral',
  },
  venue_blocked: {
    code: 'venue_blocked',
    label: 'Venue blocked',
    blurb: 'This trading venue is not permitted in your state of residence.',
    tone: 'danger',
  },
  position_cap: {
    code: 'position_cap',
    label: 'Position cap',
    blurb: 'Adding this position would exceed your single-position or portfolio cap.',
    tone: 'info',
  },
  strategy_disabled: {
    code: 'strategy_disabled',
    label: 'Strategy off',
    blurb: 'Paper trading is not enabled for this strategy.',
    tone: 'neutral',
  },
  strategy_immature: {
    code: 'strategy_immature',
    label: 'Not ready',
    blurb: 'Strategy is still in planning/backtest phase — paper trading not permitted.',
    tone: 'neutral',
  },
  no_size: {
    code: 'no_size',
    label: 'No size',
    blurb: 'The position sizer returned zero notional after applying caps.',
    tone: 'info',
  },
}

export function getNoTradeReason(code: NoTradeReasonCode | string | null | undefined): NoTradeReasonMeta {
  if (code && code in NO_TRADE_REASONS) return NO_TRADE_REASONS[code as NoTradeReasonCode]
  return NO_TRADE_REASONS.missing_data
}

export const ALL_NO_TRADE_REASONS: NoTradeReasonMeta[] = Object.values(NO_TRADE_REASONS)
