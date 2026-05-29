'use server'

/**
 * Command Center data assembly — a single server-side read that fans out to the
 * existing shared actions and a couple of direct table reads, then returns one
 * fully-serializable object the /dashboard client renders.
 *
 * Every section is defensively try/caught to an empty/null shape so a missing
 * table or unavailable feed degrades to an honest empty state in the UI rather
 * than throwing. Nothing here fabricates balances or metrics.
 */

import { createClient } from '@/lib/supabase/server'
import {
  STRATEGY_REGISTRY_CONFIG,
  type StrategyKey,
} from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import { getNoTradeLedger, type NoTradeEntry } from '@/lib/actions/no-trade-ledger'
import {
  getActivePaperPositions,
  getPaperTradingSummary,
  getLastPaperRun,
  type PaperPosition,
  type PaperTradingSummary,
  type PaperRunView,
} from '@/lib/actions/paper-trading'
import { getRiskSummary, getRiskControls, type RiskSummary } from '@/lib/actions/risk'
import { getOpportunities } from '@/lib/actions/opportunities'
import {
  getAssetRiskProfileData,
  type RiskProfileRow,
} from '@/lib/actions/asset-risk-profile'
import { detectRegime, CrossAssetRegime } from '@/lib/regime/cross-asset-regime'

// ─── Serializable shapes (no Date/enum/functions cross the boundary) ──────────

export interface RegimeView {
  regime: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'CRISIS'
  vix: number | null
  hyOas: number | null
  /** ISO string — converted from the numeric `resolvedAt` epoch. */
  asOf: string
}

export interface RiskControlsView {
  maxSinglePositionPct: number
  maxDrawdownPct: number
  maxPortfolioRiskPct: number
  /** True when the user has never customized controls (defaults only). */
  isDefault: boolean
}

export interface OpportunityView {
  id: string
  action: string | null
  symbol: string | null
  assetClass: string | null
  title: string
  whyNow: string | null
  score: number | null
  confidence: 'high' | 'medium' | 'low' | null
}

export interface PaperView {
  positions: PaperPosition[]
  summary: PaperTradingSummary
  lastRun: PaperRunView | null
}

export interface TrustEntry {
  strategyKey: string
  strategyLabel: string
  maturityStatus: string
  reason: string
}

export interface TrustView {
  gaining: TrustEntry[]
  losing: TrustEntry[]
  /** True only when both lists are empty (drives an InsufficientData note). */
  insufficient: boolean
}

export type DecisionKind = 'review_candidate' | 'missing_env' | 'risk_controls'

export interface DecisionItem {
  id: string
  kind: DecisionKind
  text: string
  href: string
}

export interface AiUsageView {
  available: boolean
  spendUsdToday: number
  callsToday: number
}

export interface CommandCenterData {
  regime: RegimeView
  risk: RiskSummary
  riskControls: RiskControlsView | null
  opportunities: OpportunityView[]
  noTrade: NoTradeEntry[]
  paper: PaperView
  allocationProfileKey: string
  allocationProfile: RiskProfileRow | null
  trust: TrustView
  decisions: DecisionItem[]
  aiUsage: AiUsageView
}

// ─── Section assemblers ───────────────────────────────────────────────────────

async function loadRegime(): Promise<RegimeView> {
  try {
    const r = await detectRegime()
    return {
      regime: r.regime,
      vix: r.vix,
      hyOas: r.hyOas,
      asOf: new Date(r.resolvedAt).toISOString(),
    }
  } catch {
    return {
      regime: CrossAssetRegime.NEUTRAL,
      vix: null,
      hyOas: null,
      asOf: new Date().toISOString(),
    }
  }
}

async function loadRisk(): Promise<RiskSummary> {
  try {
    return await getRiskSummary()
  } catch {
    return {
      total_open_notional: 0,
      largest_position_pct: 0,
      open_position_count: 0,
      today_pnl: 0,
      positions: [],
    }
  }
}

async function loadRiskControls(): Promise<RiskControlsView | null> {
  try {
    const c = await getRiskControls()
    if (!c) return null
    return {
      maxSinglePositionPct: c.max_single_position_pct,
      maxDrawdownPct: c.max_drawdown_pct,
      maxPortfolioRiskPct: c.max_portfolio_risk_pct,
      // The default upsert lands on 10/15/20 — treat that exact triple as "unset".
      isDefault:
        c.max_single_position_pct === 10 &&
        c.max_drawdown_pct === 15 &&
        c.max_portfolio_risk_pct === 20,
    }
  } catch {
    return null
  }
}

async function loadOpportunities(): Promise<OpportunityView[]> {
  try {
    const opps = await getOpportunities()
    return [...opps]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 4)
      .map(o => ({
        id: o.id,
        action: o.action ?? null,
        symbol: o.symbol ?? null,
        assetClass: o.asset_class ?? null,
        title: o.title,
        whyNow: o.description ?? null,
        score: typeof o.score === 'number' ? o.score : null,
        confidence: o.confidence ?? null,
      }))
  } catch {
    return []
  }
}

async function loadNoTrade(): Promise<NoTradeEntry[]> {
  try {
    return await getNoTradeLedger(6)
  } catch {
    return []
  }
}

async function loadPaper(): Promise<PaperView> {
  const emptySummary: PaperTradingSummary = {
    openCount: 0,
    closedCount: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    winRate: null,
    hasData: false,
  }
  try {
    const [positions, summary, lastRun] = await Promise.all([
      getActivePaperPositions(),
      getPaperTradingSummary(),
      getLastPaperRun(),
    ])
    return { positions, summary, lastRun }
  } catch {
    return { positions: [], summary: emptySummary, lastRun: null }
  }
}

interface AllocationResult {
  profileKey: string
  profile: RiskProfileRow | null
}

async function loadAllocation(): Promise<AllocationResult> {
  try {
    const data = await getAssetRiskProfileData('all')
    const profileKey = data.userProfile?.profile_key ?? 'balanced'
    const profile =
      data.profiles.find(p => p.profile_key === profileKey) ??
      data.profiles.find(p => p.profile_key === 'balanced') ??
      null
    return { profileKey, profile }
  } catch {
    return { profileKey: 'balanced', profile: null }
  }
}

/**
 * "Losing trust" comes from the strategy_retirement_log table (written by the
 * calibration monitor). If that table is empty/missing we fall back to registry
 * strategies already classified retired / live_disabled, so the panel still
 * communicates the trust story honestly.
 */
async function loadTrust(): Promise<TrustView> {
  // Gaining — promotion candidates from the registry.
  const gaining: TrustEntry[] = (Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, (typeof STRATEGY_REGISTRY_CONFIG)[StrategyKey]][])
    .filter(([, cfg]) => cfg.maturityStatus === 'live_candidate')
    .map(([key]) => ({
      strategyKey: key,
      strategyLabel: toDisplayName(key),
      maturityStatus: 'live_candidate',
      reason: 'Meets the live bar — pending review.',
    }))
    .slice(0, 8)

  // Losing — prefer the retirement log; fall back to registry status.
  const losing: TrustEntry[] = []
  const seen = new Set<string>()

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('strategy_retirement_log')
      .select('strategy_key, retired_at, reason')
      .order('retired_at', { ascending: false })
      .limit(8)

    if (!error && data) {
      for (const row of data as Array<{ strategy_key: string | null; reason: string | null }>) {
        const key = row.strategy_key ?? 'unknown'
        if (seen.has(key)) continue
        seen.add(key)
        const cfg = STRATEGY_REGISTRY_CONFIG[key as StrategyKey]
        losing.push({
          strategyKey: key,
          strategyLabel: toDisplayName(key),
          maturityStatus: cfg?.maturityStatus ?? 'retired',
          reason: row.reason ?? 'Retired by the calibration monitor.',
        })
      }
    }
  } catch {
    // ignore — fall through to registry fallback
  }

  if (losing.length === 0) {
    const fallback = (Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, (typeof STRATEGY_REGISTRY_CONFIG)[StrategyKey]][])
      .filter(([, cfg]) => cfg.maturityStatus === 'retired' || cfg.maturityStatus === 'live_disabled')
      .slice(0, 8)
    for (const [key, cfg] of fallback) {
      if (seen.has(key)) continue
      seen.add(key)
      losing.push({
        strategyKey: key,
        strategyLabel: toDisplayName(key),
        maturityStatus: cfg.maturityStatus,
        reason:
          cfg.maturityStatus === 'retired'
            ? 'Decommissioned — no longer allowed to trade.'
            : 'Approved for live but intentionally paused.',
      })
    }
  }

  return {
    gaining,
    losing,
    insufficient: gaining.length === 0 && losing.length === 0,
  }
}

async function loadDecisions(
  trust: TrustView,
  riskControls: RiskControlsView | null,
): Promise<DecisionItem[]> {
  const items: DecisionItem[] = []

  // (a) live_candidate strategies awaiting review.
  for (const c of trust.gaining) {
    items.push({
      id: `review-${c.strategyKey}`,
      kind: 'review_candidate',
      text: `${c.strategyLabel} is a live candidate awaiting your review.`,
      href: '/strategies',
    })
  }

  // (b) strategies with missing required env (server-side check only).
  try {
    const missing = (Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, (typeof STRATEGY_REGISTRY_CONFIG)[StrategyKey]][])
      .filter(([, cfg]) => {
        if (!cfg.requiredEnv || cfg.requiredEnv.length === 0) return false
        // Only surface strategies that could otherwise produce signals.
        if (cfg.maturityStatus === 'stub' || cfg.maturityStatus === 'retired') return false
        return cfg.requiredEnv.some(env => !process.env[env])
      })
    for (const [key, cfg] of missing.slice(0, 6)) {
      const absent = (cfg.requiredEnv ?? []).filter(env => !process.env[env])
      items.push({
        id: `env-${key}`,
        kind: 'missing_env',
        text: `${toDisplayName(key)} is missing required config (${absent.join(', ')}).`,
        href: '/settings',
      })
    }
  } catch {
    // ignore — env checks are best-effort
  }

  // (c) risk controls null / still on defaults.
  if (!riskControls) {
    items.push({
      id: 'risk-controls-unset',
      kind: 'risk_controls',
      text: 'Set your risk limits — no risk controls are configured.',
      href: '/risk',
    })
  } else if (riskControls.isDefault) {
    items.push({
      id: 'risk-controls-default',
      kind: 'risk_controls',
      text: 'Review your risk limits — still on the default position/drawdown caps.',
      href: '/risk',
    })
  }

  return items
}

async function loadAiUsage(): Promise<AiUsageView> {
  const unavailable: AiUsageView = { available: false, spendUsdToday: 0, callsToday: 0 }
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return unavailable

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('ai_usage_logs')
      .select('cost_usd')
      .eq('user_id', user.id)
      .gte('created_at', dayStart.toISOString())

    if (error || !data) return unavailable

    const rows = data as Array<{ cost_usd: number | null }>
    const spend = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    return { available: true, spendUsdToday: spend, callsToday: rows.length }
  } catch {
    return unavailable
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────

export async function getCommandCenterData(): Promise<CommandCenterData> {
  const [regime, risk, riskControls, opportunities, noTrade, paper, allocation, trust] =
    await Promise.all([
      loadRegime(),
      loadRisk(),
      loadRiskControls(),
      loadOpportunities(),
      loadNoTrade(),
      loadPaper(),
      loadAllocation(),
      loadTrust(),
    ])

  const [decisions, aiUsage] = await Promise.all([
    loadDecisions(trust, riskControls),
    loadAiUsage(),
  ])

  return {
    regime,
    risk,
    riskControls,
    opportunities,
    noTrade,
    paper,
    allocationProfileKey: allocation.profileKey,
    allocationProfile: allocation.profile,
    trust,
    decisions,
    aiUsage,
  }
}
