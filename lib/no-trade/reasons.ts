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
    label: 'Edge disappeared after fees',
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
    label: 'Strategy planned only',
    blurb: 'This strategy is a placeholder with no live signal logic yet.',
    tone: 'neutral',
  },
  risk_profile_mismatch: {
    code: 'risk_profile_mismatch',
    label: 'Risk profile mismatch',
    blurb: 'This opportunity is outside the strategies your risk profile allows.',
    tone: 'info',
  },
  correlation_too_high: {
    code: 'correlation_too_high',
    label: 'Correlated exposure too high',
    blurb: 'Too similar to positions you already hold — would concentrate risk.',
    tone: 'caution',
  },
  jurisdiction_blocked: {
    code: 'jurisdiction_blocked',
    label: 'Jurisdiction blocked',
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
    label: 'MiroFish / Kronos contradicted',
    blurb: 'The simulation and predictor disagreed with the signal.',
    tone: 'caution',
  },
  missing_data: {
    code: 'missing_data',
    label: 'Missing required data',
    blurb: 'A required market feed or integration was unavailable.',
    tone: 'neutral',
  },
}

export function getNoTradeReason(code: NoTradeReasonCode | string | null | undefined): NoTradeReasonMeta {
  if (code && code in NO_TRADE_REASONS) return NO_TRADE_REASONS[code as NoTradeReasonCode]
  return NO_TRADE_REASONS.missing_data
}

export const ALL_NO_TRADE_REASONS: NoTradeReasonMeta[] = Object.values(NO_TRADE_REASONS)
