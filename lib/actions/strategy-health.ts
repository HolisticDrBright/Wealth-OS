'use server'

/**
 * Strategy Health Board data assembly.
 *
 * Builds one auditable row per strategy key in STRATEGY_REGISTRY_CONFIG,
 * combining the static registry (maturity, edge, asset class, profiles,
 * required/optional env) with per-user enablement and a best-effort pass over
 * the metrics tables. Dev tables are typically empty — null metrics are
 * expected and surfaced as "Insufficient data" in the UI rather than fabricated.
 *
 * Everything returned is a plain, serializable object so it can be handed to a
 * client component from the page server component.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  STRATEGY_REGISTRY_CONFIG,
  type StrategyKey,
  type StrategyMaturityStatus,
  type AssetClass,
  type EdgeType,
  type ProfileKey,
} from '@/lib/strategies/strategy-registry'
import { toDisplayName, getMaturityMeta } from '@/lib/strategies/strategy-display'
import { getRollingBrier } from '@/lib/learning/rolling-brier'
import { getPnlByStrategy, getTradesByStrategy } from '@/lib/admin/paper-trading-queries'

export interface StrategyHealthRow {
  key: StrategyKey
  displayName: string
  assetClass: AssetClass
  edgeType: EdgeType
  maturityStatus: StrategyMaturityStatus
  enabledInProfiles: ProfileKey[]

  // Per-user enablement
  isEnabled: boolean
  paperEnabled: boolean
  liveEnabled: boolean

  // Integrations (server-side env presence)
  missingRequired: string[]
  missingOptional: string[]

  // Metrics (best-effort; null when the source is empty/unavailable)
  brier: number | null
  pnl30d: number | null
  tradeCount: number | null
  sharpe: number | null
  maxDrawdown: number | null
  lastSignal: string | null
  lastCalibration: string | null

  // Derived
  whyText: string
}

interface UserEnablement {
  is_enabled: boolean
  paper_enabled: boolean
  live_enabled: boolean
}

/**
 * Fetch per-user enablement. `live_enabled` may not exist in every environment,
 * so we select only the columns we know exist and default liveEnabled=false.
 */
async function getUserEnablement(): Promise<Map<string, UserEnablement>> {
  const map = new Map<string, UserEnablement>()
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return map

    const { data, error } = await supabase
      .from('user_enabled_strategies')
      .select('strategy_key, is_enabled, paper_enabled')
      .eq('user_id', user.id)

    if (error || !data) return map

    for (const row of data as Array<{ strategy_key: string; is_enabled: boolean | null; paper_enabled: boolean | null }>) {
      map.set(row.strategy_key, {
        is_enabled: row.is_enabled ?? false,
        paper_enabled: row.paper_enabled ?? false,
        live_enabled: false,
      })
    }
  } catch {
    // Auth/query failure — treat everything as not-enabled.
  }
  return map
}

interface AdminMetrics {
  pnl: Map<string, number>
  trades: Map<string, number>
  sharpe: Map<string, number | null>
  lastCalibration: Map<string, string | null>
}

/** Best-effort admin-scoped aggregates. Empty maps when unavailable. */
async function getAdminMetrics(): Promise<AdminMetrics> {
  const pnl = new Map<string, number>()
  const trades = new Map<string, number>()
  const sharpe = new Map<string, number | null>()
  const lastCalibration = new Map<string, string | null>()

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return { pnl, trades, sharpe, lastCalibration }
  }

  // 30d P&L proxy (queries are last-7-day, admin-scoped — acceptable proxy).
  try {
    const rows = await getPnlByStrategy(admin)
    for (const r of rows) pnl.set(r.strategy_key, r.realized_pnl_usd)
  } catch { /* empty → null */ }

  try {
    const rows = await getTradesByStrategy(admin)
    for (const r of rows) trades.set(r.strategy_key, r.trade_count)
  } catch { /* empty → null */ }

  // Sharpe + last calibration timestamp from the retirement audit trail.
  try {
    const { data } = await admin
      .from('strategy_retirement_log')
      .select('strategy_key, sharpe_90d, retired_at')
      .order('retired_at', { ascending: false })

    for (const row of (data ?? []) as Array<{ strategy_key: string; sharpe_90d: number | null; retired_at: string | null }>) {
      // Keep the most recent (first seen) entry per strategy.
      if (!sharpe.has(row.strategy_key)) sharpe.set(row.strategy_key, row.sharpe_90d ?? null)
      if (!lastCalibration.has(row.strategy_key)) lastCalibration.set(row.strategy_key, row.retired_at ?? null)
    }
  } catch { /* empty → null */ }

  return { pnl, trades, sharpe, lastCalibration }
}

/** Most recent decision timestamp per strategy from audit_logs (last signal). */
async function getLastSignals(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('audit_logs')
      .select('strategy_key, decided_at')
      .order('decided_at', { ascending: false })
      .limit(500)

    for (const row of (data ?? []) as Array<{ strategy_key: string | null; decided_at: string | null }>) {
      if (row.strategy_key && row.decided_at && !map.has(row.strategy_key)) {
        map.set(row.strategy_key, row.decided_at)
      }
    }
  } catch { /* empty → null */ }
  return map
}

/** Rolling Brier per strategy (anon client). Returns null where < min samples. */
async function getBrierScores(keys: StrategyKey[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const supabase = await createClient()
    const results = await Promise.all(
      keys.map(async k => {
        try {
          const r = await getRollingBrier(supabase, k, 30)
          return r ? ([k, r.brierScore] as const) : null
        } catch {
          return null
        }
      }),
    )
    for (const r of results) if (r) map.set(r[0], r[1])
  } catch { /* empty → null */ }
  return map
}

function computeWhyText(args: {
  maturityStatus: StrategyMaturityStatus
  enabledInProfiles: ProfileKey[]
  isEnabled: boolean
  paperEnabled: boolean
  missingRequired: string[]
}): string {
  const { maturityStatus, isEnabled, paperEnabled, missingRequired } = args

  if (maturityStatus === 'stub') return 'Planned — no signal logic, cannot trade'
  if (maturityStatus === 'retired') return 'Retired — decommissioned'
  if (!isEnabled && !paperEnabled && args.enabledInProfiles.length === 0) {
    return 'Outside your risk profile'
  }
  if (missingRequired.length > 0) return `Missing integration: ${missingRequired.join(', ')}`
  if (paperEnabled) return 'Paper trading active'
  if (isEnabled) return 'Enabled'
  return 'Available — not enabled'
}

export async function getStrategyHealthRows(): Promise<StrategyHealthRow[]> {
  const keys = Object.keys(STRATEGY_REGISTRY_CONFIG) as StrategyKey[]

  const [enablement, admin, lastSignals, brierScores] = await Promise.all([
    getUserEnablement(),
    getAdminMetrics(),
    getLastSignals(),
    getBrierScores(keys),
  ])

  const rows: StrategyHealthRow[] = keys.map(key => {
    const cfg = STRATEGY_REGISTRY_CONFIG[key]
    const ue = enablement.get(key)

    const missingRequired = (cfg.requiredEnv ?? []).filter(v => !process.env[v])
    const missingOptional = (cfg.optionalEnv ?? []).filter(v => !process.env[v])

    const isEnabled = ue?.is_enabled ?? false
    const paperEnabled = ue?.paper_enabled ?? false
    const liveEnabled = ue?.live_enabled ?? false

    return {
      key,
      displayName: toDisplayName(key),
      assetClass: cfg.assetClass,
      edgeType: cfg.edgeType,
      maturityStatus: cfg.maturityStatus,
      enabledInProfiles: cfg.enabledInProfiles,

      isEnabled,
      paperEnabled,
      liveEnabled,

      missingRequired,
      missingOptional,

      brier: brierScores.get(key) ?? null,
      pnl30d: admin.pnl.get(key) ?? null,
      tradeCount: admin.trades.get(key) ?? null,
      sharpe: admin.sharpe.get(key) ?? null,
      maxDrawdown: null, // No trivial per-strategy source available — InsufficientData.
      lastSignal: lastSignals.get(key) ?? null,
      lastCalibration: admin.lastCalibration.get(key) ?? null,

      whyText: computeWhyText({
        maturityStatus: cfg.maturityStatus,
        enabledInProfiles: cfg.enabledInProfiles,
        isEnabled,
        paperEnabled,
        missingRequired,
      }),
    }
  })

  // Default sort: maturity rank desc, then display name.
  rows.sort((a, b) => {
    const ra = getMaturityMeta(a.maturityStatus).rank
    const rb = getMaturityMeta(b.maturityStatus).rank
    if (rb !== ra) return rb - ra
    return a.displayName.localeCompare(b.displayName)
  })

  return rows
}
