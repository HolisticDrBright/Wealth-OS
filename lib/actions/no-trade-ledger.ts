'use server'

/**
 * No-Trade Ledger data — recent decisions where Wealth OS declined to trade.
 *
 * Source: `audit_logs` rows with decision = 'block' (written by the strategy
 * pipeline). Each block is mapped to a human No-Trade reason via best-effort
 * inference from the recorded verdict scores and the strategy's maturity. When
 * the table is empty or unavailable we return an empty list — the UI then shows
 * an honest "no blocked calls" state rather than fabricated entries.
 */

import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import type { NoTradeReasonCode } from '@/lib/no-trade/reasons'

export interface NoTradeEntry {
  id: string
  symbol: string | null
  strategyKey: string | null
  strategyLabel: string
  assetClass: string | null
  reasonCode: NoTradeReasonCode
  detail: string | null
  at: string
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

  // Maturity overrides everything — a planned/retired strategy can never trade.
  if (cfg?.maturityStatus === 'stub') return { code: 'strategy_planned', detail: 'No live signal logic yet.' }
  if (cfg?.maturityStatus === 'retired') return { code: 'strategy_retired', detail: 'Strategy decommissioned.' }

  if (row.kronos_pass === false) return { code: 'agents_contradicted', detail: 'Kronos predictor did not confirm the signal.' }
  if (typeof row.mirofish_score === 'number' && row.mirofish_score < 45) {
    return { code: 'agents_contradicted', detail: `MiroFish conviction too low (${Math.round(row.mirofish_score)}/100).` }
  }
  if (typeof row.red_team_score === 'number' && row.red_team_score < 50) {
    return { code: 'red_team_rejected', detail: `Red Team flagged the thesis (${Math.round(row.red_team_score)}/100).` }
  }

  // metadata may carry an explicit reason from the pipeline.
  const metaReason = typeof row.metadata?.reason === 'string' ? (row.metadata.reason as string) : null
  if (metaReason) return { code: 'missing_data', detail: metaReason }

  return { code: 'missing_data', detail: null }
}

export async function getNoTradeLedger(limit = 25): Promise<NoTradeEntry[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, strategy_key, symbol, edge_type, decision, red_team_score, mirofish_score, kronos_pass, decided_at, metadata')
      .neq('decision', 'execute')
      .order('decided_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as AuditRow[]).map((row, i) => {
      const { code, detail } = inferReason(row)
      const assetClass = row.strategy_key
        ? STRATEGY_REGISTRY_CONFIG[row.strategy_key as StrategyKey]?.assetClass ?? null
        : null
      return {
        id: String(row.id ?? `${row.strategy_key ?? 'na'}-${row.decided_at ?? i}`),
        symbol: row.symbol ?? null,
        strategyKey: row.strategy_key ?? null,
        strategyLabel: row.strategy_key ? toDisplayName(row.strategy_key) : 'Unknown strategy',
        assetClass,
        reasonCode: code,
        detail,
        at: row.decided_at ?? new Date().toISOString(),
      }
    })
  } catch {
    return []
  }
}
