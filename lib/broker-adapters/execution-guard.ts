/**
 * Pre-execution guard — the ONE gate every real-broker submission must pass.
 *
 * Three layers, all fail-closed:
 *
 * 1. MASTER SWITCH: real broker execution requires LIVE_TRADING_ENABLED=true.
 *    Default (unset) = paper validation phase — no code path may reach a real
 *    broker adapter even when API keys exist in the environment.
 *
 * 2. GUARD TOKEN: both broker routers refuse submissions that don't carry a
 *    token issued by preExecutionGuard() (kill switch → cost gate → sleeve
 *    halt). Tokens live in a module-private WeakSet, so callers cannot forge
 *    them — a future code path that skips the checks simply cannot submit.
 *
 * 3. LIVE APPROVAL: the strategy must be explicitly live-approved —
 *    maturityStatus === 'live_candidate' AND user_enabled_strategies
 *    .live_enabled === true. `is_enabled` is display/general enablement and
 *    is NEVER a live-trading signal. paper_trading / backtest_ready / stub /
 *    retired / live_disabled strategies can never reach a live adapter.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { preTradeRiskCheck } from '@/lib/risk/kill-switch'
import { edgeClearsCosts } from '@/lib/costs/transaction-costs'
import { getStrategyConfig, isStrategyKey } from '@/lib/strategies/strategy-registry'

// ─── 1. Master switch ─────────────────────────────────────────────────────────

/** True only when live trading has been explicitly enabled by the operator. */
export function liveTradingEnabled(): boolean {
  return process.env.LIVE_TRADING_ENABLED === 'true'
}

export const PAPER_PHASE_REASON =
  'live trading disabled — paper validation phase (set LIVE_TRADING_ENABLED=true only after the runbook criteria pass)'

// ─── 2. Guard tokens ──────────────────────────────────────────────────────────

export interface GuardToken {
  userId: string
  issuedAt: number
  strategyKey?: string
}

const ISSUED_TOKENS = new WeakSet<GuardToken>()
const TOKEN_TTL_MS = 60_000

export type GuardVerdict =
  | { ok: true; token: GuardToken }
  | { ok: false; reason: string }

/**
 * Run every pre-execution check and mint a token on success.
 * Kill switch (drawdown / daily loss / sleeve halt / trading_halted flag) →
 * cost gate (when an expected edge is provided).
 */
export async function preExecutionGuard(args: {
  supabase: SupabaseClient
  userId: string
  strategyKey?: string
  sleeveId?: string
  /** When present, the edge must clear 2× the venue round trip. */
  expectedReturn?: number
  assetClass?: string
}): Promise<GuardVerdict> {
  const killSwitch = await preTradeRiskCheck({
    supabase: args.supabase,
    userId: args.userId,
    strategyKey: args.strategyKey,
    sleeveId: args.sleeveId,
  })
  if (!killSwitch.allowed) {
    return { ok: false, reason: `kill_switch: ${killSwitch.reason}` }
  }

  if (args.expectedReturn != null && args.assetClass) {
    const cost = edgeClearsCosts(Math.abs(args.expectedReturn), args.assetClass)
    if (!cost.clears) {
      return {
        ok: false,
        reason: `edge_below_cost_floor: gross=${cost.grossBps}bps < 2× round-trip ${cost.costBps}bps (venue=${args.assetClass})`,
      }
    }
  }

  const token: GuardToken = {
    userId: args.userId,
    issuedAt: Date.now(),
    strategyKey: args.strategyKey,
  }
  ISSUED_TOKENS.add(token)
  return { ok: true, token }
}

/** Routers call this — membership in the private WeakSet cannot be forged. */
export function isGuardTokenValid(token: GuardToken | undefined | null): boolean {
  if (!token) return false
  if (!ISSUED_TOKENS.has(token)) return false
  return Date.now() - token.issuedAt <= TOKEN_TTL_MS
}

// ─── 3. Hard live-approval gate ───────────────────────────────────────────────

/** The ONLY maturities allowed to touch a real broker. */
export const LIVE_APPROVED_MATURITIES = ['live_candidate'] as const

export interface LiveApprovalVerdict {
  approved: boolean
  reason: string
}

/**
 * A strategy may reach a real broker only when BOTH hold:
 *   - registry maturityStatus is explicitly live-approved
 *   - user_enabled_strategies.live_enabled === true for this user
 * `is_enabled` is intentionally ignored — it is display enablement only.
 */
export async function checkLiveApproval(
  supabase: SupabaseClient,
  userId: string,
  strategyKey: string
): Promise<LiveApprovalVerdict> {
  if (!isStrategyKey(strategyKey)) {
    return { approved: false, reason: `unknown strategy key ${strategyKey} — never live` }
  }
  const maturity = getStrategyConfig(strategyKey).maturityStatus
  if (!(LIVE_APPROVED_MATURITIES as readonly string[]).includes(maturity)) {
    return {
      approved: false,
      reason: `maturity ${maturity} is not live-approved (requires ${LIVE_APPROVED_MATURITIES.join('/')})`,
    }
  }

  try {
    const { data, error } = await supabase
      .from('user_enabled_strategies')
      .select('live_enabled')
      .eq('user_id', userId)
      .eq('strategy_key', strategyKey)
    if (error) {
      return { approved: false, reason: `live_enabled unreadable (${error.message}) — fail closed` }
    }
    const row = (data ?? [])[0] as { live_enabled?: boolean | null } | undefined
    if (row?.live_enabled !== true) {
      return { approved: false, reason: 'live_enabled is not true for this user/strategy' }
    }
  } catch (err) {
    return { approved: false, reason: `live approval check failed (${err instanceof Error ? err.message : err}) — fail closed` }
  }

  return { approved: true, reason: 'maturity live_candidate + live_enabled=true' }
}
