import type { AutopilotRule } from './types'

export interface RuleMatchContext {
  symbol: string
  asset_class: string
  action: string
  notional_value: number
  trader_id: string
  trader_return_pct: number
  cio_score: number
}

export interface RuleActionResult {
  action_type: AutopilotRule['action_type']
  sizing_pct?: number
  sizing_mode?: AutopilotRule['action_sizing_mode']
  fixed_usd?: number
  max_daily_usd?: number
  broker_override?: string
  matched_rule_id: string
  matched_rule_name: string
}

function nowInWindow(start?: string, end?: string): boolean {
  if (!start || !end) return true
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return hhmm >= start && hhmm <= end
}

function matchesRule(rule: AutopilotRule, ctx: RuleMatchContext): boolean {
  if (!rule.is_active) return false

  if (rule.condition_symbols?.length && !rule.condition_symbols.includes(ctx.symbol)) return false
  if (rule.condition_asset_classes?.length && !rule.condition_asset_classes.includes(ctx.asset_class)) return false
  if (rule.condition_actions?.length && !rule.condition_actions.includes(ctx.action)) return false
  if (rule.condition_trader_ids?.length && !rule.condition_trader_ids.includes(ctx.trader_id)) return false

  if (rule.condition_min_notional != null && ctx.notional_value < rule.condition_min_notional) return false
  if (rule.condition_max_notional != null && ctx.notional_value > rule.condition_max_notional) return false
  if (rule.condition_min_trader_return_pct != null && ctx.trader_return_pct < rule.condition_min_trader_return_pct) return false
  if (rule.condition_min_cio_score != null && ctx.cio_score < rule.condition_min_cio_score) return false

  if (!nowInWindow(rule.condition_time_window_start, rule.condition_time_window_end)) return false

  return true
}

/**
 * Evaluate rules in priority order (lower number = higher priority).
 * Returns the first matching rule's action, or null for no match (fall-through).
 */
export function evaluateRules(
  rules: AutopilotRule[],
  ctx: RuleMatchContext
): RuleActionResult | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  for (const rule of sorted) {
    if (matchesRule(rule, ctx)) {
      return {
        action_type: rule.action_type,
        sizing_pct: rule.action_sizing_pct ?? undefined,
        sizing_mode: rule.action_sizing_mode ?? undefined,
        fixed_usd: rule.action_fixed_usd ?? undefined,
        max_daily_usd: rule.action_max_daily_usd ?? undefined,
        broker_override: rule.action_broker_override ?? undefined,
        matched_rule_id: rule.id,
        matched_rule_name: rule.name,
      }
    }
  }
  return null
}

/** Apply a matched rule's sizing to produce a final notional value */
export function applySizing(
  result: RuleActionResult,
  originalNotional: number,
  defaultPct: number
): number {
  if (result.sizing_mode === 'fixed_usd' && result.fixed_usd) {
    return Math.min(result.fixed_usd, 50000)
  }
  if (result.sizing_mode === 'fixed_pct' && result.sizing_pct) {
    return originalNotional * (result.sizing_pct / 100)
  }
  if (result.sizing_mode === 'proportional' && result.sizing_pct) {
    return originalNotional * (result.sizing_pct / defaultPct)
  }
  if (result.sizing_pct) {
    return originalNotional * (result.sizing_pct / defaultPct)
  }
  return originalNotional
}
