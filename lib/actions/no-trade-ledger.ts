'use server'

/**
 * No-Trade Ledger data — recent decisions where Wealth OS declined to trade.
 *
 * Sources:
 * 1. `audit_logs` rows with decision != 'execute' (CIO-level blocks, written by the strategy pipeline)
 * 2. `paper_trade_runs.skipped_details` from the latest run (broker-level skips: already_open,
 *    missing_price, expired_market, venue_blocked, etc.)
 *
 * Both are mapped to NoTradeEntry with the canonical reason taxonomy so the same
 * ledger surface can show the full picture of what Wealth OS considered and declined.
 */

import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import type { NoTradeReasonCode } from '@/lib/no-trade/reasons'
import type { SkippedDetail } from '@/lib/paper-trading/types'

export interface NoTradeEntry {
  id: string
  symbol: string | null
  strategyKey: string | null
  strategyLabel: string
  assetClass: string | null
  reasonCode: NoTradeReasonCode
  detail: string | null
  at: string
  source: 'cio' | 'broker'
}

interface AuditRow {
  id?: string
  strategy_key?: string | null
  symbol?: string | null
  edge_type?: string | null
  decision?: string | null
  red_team_score?: number | null
  mirofish_score?: number | null
  kronos_pass?: boolean | null
  decided_at?: string | null
  metadata?: Record<string, unknown> | null
}

function inferReason(row: AuditRow): { code: NoTradeReasonCode; detail: string | null } {
  const key = row.strategy_key as StrategyKey | undefined
  const cfg = key ? STRATEGY_REGISTRY_CONFIG[key] : undefined

  if (cfg?.maturityStatus === 'stub') return { code: 'strategy_planned', detail: 'No live signal logic yet.' }
  if (cfg?.maturityStatus === 'retired') return { code: 'strategy_retired', detail: 'Strategy decommissioned.' }

  if (row.kronos_pass === false) return { code: 'agents_contradicted', detail: 'Kronos predictor did not confirm the signal.' }
  if (typeof row.mirofish_score === 'number' && row.mirofish_score < 45) {
    return { code: 'agents_contradicted', detail: `MiroFish conviction too low (${Math.round(row.mirofish_score)}/100).` }
  }
  if (typeof row.red_team_score === 'number' && row.red_team_score < 50) {
    return { code: 'red_team_rejected', detail: `Red Team flagged the thesis (${Math.round(row.red_team_score)}/100).` }
  }

  const metaReason = typeof row.metadata?.reason === 'string' ? (row.metadata.reason as string) : null
  if (metaReason) {
    const r = metaReason.toLowerCase()
    if (r.includes('profile') || r.includes('not enabled')) return { code: 'risk_profile_mismatch', detail: metaReason }
    if (r.includes('correlation')) return { code: 'correlation_too_high', detail: metaReason }
    if (r.includes('kronos')) return { code: 'agents_contradicted', detail: metaReason }
    if (r.includes('mirofish') || r.includes('bear')) return { code: 'agents_contradicted', detail: metaReason }
  }

  return { code: 'missing_data', detail: metaReason }
}

function brokerSkipCode(outcome: string, reason: string): NoTradeReasonCode {
  switch (outcome) {
    case 'already_open':  return 'already_open'
    case 'missing_price':
    case 'invalid_price':
    case 'no_active_book': return 'missing_price'
    case 'expired_market': return 'expired_market'
    case 'resolved_market': return 'resolved_market'
    case 'venueBlocked':
    case 'venue_blocked': return 'venue_blocked'
    case 'strategyImmature':
    case 'strategy_immature': return 'strategy_immature'
    case 'no_size': return 'no_size'
    case 'block': {
      const r = reason.toLowerCase()
      if (r.includes('profile') || r.includes('not enabled')) return 'risk_profile_mismatch'
      if (r.includes('kronos') || r.includes('mirofish') || r.includes('red team')) return 'agents_contradicted'
      if (r.includes('liquidity')) return 'liquidity_too_low'
      if (r.includes('correlation') || r.includes('cap')) return 'correlation_too_high'
      return 'red_team_rejected'
    }
    default: return 'missing_data'
  }
}

export async function getNoTradeLedger(limit = 25): Promise<NoTradeEntry[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // ── Source 1: CIO audit_logs blocks ──────────────────────────────────────
    const auditQuery = supabase
      .from('audit_logs')
      .select('id, strategy_key, symbol, edge_type, decision, red_team_score, mirofish_score, kronos_pass, decided_at, metadata')
      .neq('decision', 'execute')
      .order('decided_at', { ascending: false })
      .limit(limit)

    if (user) auditQuery.eq('user_id', user.id)

    const { data: auditData } = await auditQuery

    const cioEntries: NoTradeEntry[] = ((auditData ?? []) as AuditRow[]).map((row, i) => {
      const { code, detail } = inferReason(row)
      const assetClass = row.strategy_key
        ? STRATEGY_REGISTRY_CONFIG[row.strategy_key as StrategyKey]?.assetClass ?? null
        : null
      return {
        id: String(row.id ?? `cio-${row.strategy_key ?? 'na'}-${i}`),
        symbol: row.symbol ?? null,
        strategyKey: row.strategy_key ?? null,
        strategyLabel: row.strategy_key ? toDisplayName(row.strategy_key) : 'Unknown strategy',
        assetClass,
        reasonCode: code,
        detail,
        at: row.decided_at ?? new Date().toISOString(),
        source: 'cio' as const,
      }
    })

    // ── Source 2: Latest paper run broker skips ──────────────────────────────
    // Only include non-trivial skips (exclude already_open — those are operational noise)
    let brokerEntries: NoTradeEntry[] = []
    if (user) {
      const { data: runData } = await supabase
        .from('paper_trade_runs')
        .select('skipped_details, run_at')
        .eq('user_id', user.id)
        .order('run_at', { ascending: false })
        .limit(1)
        .single()

      if (runData) {
        const details = (runData.skipped_details as SkippedDetail[]) ?? []
        brokerEntries = details
          .filter(d => d.outcome !== 'already_open' && d.outcome !== 'opened')
          .map((d, i) => ({
            id: `broker-${d.strategyKey}-${d.symbol}-${i}`,
            symbol: d.symbol ?? null,
            strategyKey: d.strategyKey ?? null,
            strategyLabel: d.strategyKey ? toDisplayName(d.strategyKey) : 'Unknown',
            assetClass: d.assetClass ?? null,
            reasonCode: brokerSkipCode(d.outcome, d.reason),
            detail: d.reason,
            at: d.timestamp ?? (runData.run_at as string),
            source: 'broker' as const,
          }))
      }
    }

    // Merge: CIO blocks first (more authoritative), then broker skips, deduplicate by strategyKey+symbol
    const seen = new Set<string>()
    const merged: NoTradeEntry[] = []
    for (const e of [...cioEntries, ...brokerEntries]) {
      const k = `${e.strategyKey}:${e.symbol}`
      if (!seen.has(k)) {
        seen.add(k)
        merged.push(e)
      }
    }

    return merged.slice(0, limit)
  } catch {
    return []
  }
}
