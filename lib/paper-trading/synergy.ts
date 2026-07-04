/**
 * Strategy synergy / portfolio-level view (validation item 12) — how the
 * paper book's strategies work TOGETHER, for validation review first, not
 * live trading:
 *
 *   exposure by asset class and strategy family, correlated clusters,
 *   directional conflicts, drawdown overlap, concentration warnings, and a
 *   regime-aware allocation note. All pure functions over position rows.
 */

import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'

export interface OpenPositionRow {
  strategyKey: string
  symbol: string
  assetClass: string
  direction: string
  notionalUsd: number
}

export interface ClosedPositionRow {
  strategyKey: string
  closedAt: string          // ISO
  realizedPnlUsd: number
}

export interface ExposureSlice {
  key: string
  notionalUsd: number
  fraction: number
  strategies: string[]
}

export interface StrategyCluster {
  /** e.g. "crypto/structural" — assetClass/edgeType family. */
  family: string
  strategies: string[]
  notionalUsd: number
  fraction: number
}

export interface DirectionalConflict {
  symbol: string
  long: string[]
  short: string[]
  detail: string
}

export interface DrawdownOverlapPair {
  a: string
  b: string
  /** Fraction of a's loss-days on which b also lost (0..1). */
  overlap: number
  sharedLossDays: number
}

export interface SynergyWarning {
  severity: 'warning' | 'info'
  message: string
}

export interface SynergyReport {
  totalOpenNotionalUsd: number
  byAssetClass: ExposureSlice[]
  byFamily: ExposureSlice[]
  clusters: StrategyCluster[]
  conflicts: DirectionalConflict[]
  drawdownOverlap: DrawdownOverlapPair[]
  warnings: SynergyWarning[]
  regimeNote: string | null
}

/** Family = assetClass/edgeType from the registry; unknown keys get assetClass only. */
export function familyOf(strategyKey: string, fallbackAssetClass: string): string {
  const cfg = STRATEGY_REGISTRY_CONFIG[strategyKey as StrategyKey]
  if (!cfg) return fallbackAssetClass
  return `${cfg.assetClass}/${cfg.edgeType}`
}

function slices(
  positions: OpenPositionRow[],
  keyOf: (p: OpenPositionRow) => string,
  total: number
): ExposureSlice[] {
  const byKey = new Map<string, { notional: number; strategies: Set<string> }>()
  for (const p of positions) {
    const k = keyOf(p)
    const cur = byKey.get(k) ?? { notional: 0, strategies: new Set<string>() }
    cur.notional += p.notionalUsd
    cur.strategies.add(p.strategyKey)
    byKey.set(k, cur)
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      notionalUsd: Math.round(v.notional * 100) / 100,
      fraction: total > 0 ? Math.round((v.notional / total) * 10_000) / 10_000 : 0,
      strategies: [...v.strategies].sort(),
    }))
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
}

export function detectConflicts(positions: OpenPositionRow[]): DirectionalConflict[] {
  const bySymbol = new Map<string, { long: Set<string>; short: Set<string> }>()
  for (const p of positions) {
    const cur = bySymbol.get(p.symbol) ?? { long: new Set<string>(), short: new Set<string>() }
    if (p.direction === 'long') cur.long.add(p.strategyKey)
    else if (p.direction === 'short') cur.short.add(p.strategyKey)
    bySymbol.set(p.symbol, cur)
  }
  const out: DirectionalConflict[] = []
  for (const [symbol, { long, short }] of bySymbol) {
    if (long.size > 0 && short.size > 0) {
      out.push({
        symbol,
        long: [...long].sort(),
        short: [...short].sort(),
        detail: `${[...long].join(', ')} long vs ${[...short].join(', ')} short — paying costs both ways on the same instrument`,
      })
    }
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/**
 * Drawdown overlap: for each strategy pair, on the days A realized a loss,
 * how often did B also realize a loss? High overlap = the diversification
 * between them is cosmetic. Only pairs with ≥3 shared loss-days reported.
 */
export function computeDrawdownOverlap(closed: ClosedPositionRow[]): DrawdownOverlapPair[] {
  const lossDaysBy = new Map<string, Set<string>>()
  for (const c of closed) {
    if (c.realizedPnlUsd >= 0) continue
    const day = c.closedAt.slice(0, 10)
    const set = lossDaysBy.get(c.strategyKey) ?? new Set<string>()
    set.add(day)
    lossDaysBy.set(c.strategyKey, set)
  }
  const keys = [...lossDaysBy.keys()].sort()
  const out: DrawdownOverlapPair[] = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = lossDaysBy.get(keys[i])!
      const b = lossDaysBy.get(keys[j])!
      const shared = [...a].filter(d => b.has(d)).length
      if (shared < 3) continue
      const overlap = shared / Math.min(a.size, b.size)
      out.push({
        a: keys[i], b: keys[j],
        overlap: Math.round(overlap * 100) / 100,
        sharedLossDays: shared,
      })
    }
  }
  return out.sort((x, y) => y.overlap - x.overlap)
}

/** Cluster fraction above which "same risk" concentration warnings fire. */
export const CLUSTER_CONCENTRATION_LIMIT = 0.5
export const ASSET_CONCENTRATION_LIMIT = 0.6
export const CROWDED_STRATEGY_COUNT = 3

export function buildSynergyReport(args: {
  openPositions: OpenPositionRow[]
  closedPositions: ClosedPositionRow[]
  regime: string | null
}): SynergyReport {
  const total = args.openPositions.reduce((s, p) => s + p.notionalUsd, 0)
  const byAssetClass = slices(args.openPositions, p => p.assetClass, total)
  const byFamily = slices(args.openPositions, p => familyOf(p.strategyKey, p.assetClass), total)

  const clusters: StrategyCluster[] = byFamily
    .filter(f => f.strategies.length > 1)
    .map(f => ({
      family: f.key,
      strategies: f.strategies,
      notionalUsd: f.notionalUsd,
      fraction: f.fraction,
    }))

  const conflicts = detectConflicts(args.openPositions)
  const drawdownOverlap = computeDrawdownOverlap(args.closedPositions)

  const warnings: SynergyWarning[] = []
  for (const cluster of clusters) {
    if (cluster.strategies.length >= CROWDED_STRATEGY_COUNT && cluster.fraction > CLUSTER_CONCENTRATION_LIMIT) {
      warnings.push({
        severity: 'warning',
        message: `${cluster.strategies.length} strategies (${cluster.strategies.join(', ')}) are chasing the same ${cluster.family} risk — ${(cluster.fraction * 100).toFixed(0)}% of the open book`,
      })
    }
  }
  for (const slice of byAssetClass) {
    if (slice.fraction > ASSET_CONCENTRATION_LIMIT && byAssetClass.length > 1) {
      warnings.push({
        severity: 'warning',
        message: `${(slice.fraction * 100).toFixed(0)}% of open notional is in ${slice.key} — a single asset-class shock hits most of the book`,
      })
    }
  }
  for (const pair of drawdownOverlap.filter(p => p.overlap >= 0.7)) {
    warnings.push({
      severity: 'warning',
      message: `${pair.a} and ${pair.b} lose on the same days ${(pair.overlap * 100).toFixed(0)}% of the time (${pair.sharedLossDays} shared loss-days) — their diversification is cosmetic`,
    })
  }
  for (const c of conflicts) {
    warnings.push({ severity: 'info', message: `Directional conflict on ${c.symbol}: ${c.detail}` })
  }

  const regimeNote = args.regime == null ? null
    : args.regime === 'crisis'
      ? 'CRISIS regime: regime-conditional capital weights are zeroed; the allocator would close everything but hedges.'
    : args.regime === 'risk_off'
      ? 'RISK_OFF regime: regime-conditional weights carry a 50% haircut — expect smaller paper sizes than the strategies request.'
    : args.regime === 'transition'
      ? 'TRANSITION regime: weights carry a 25% haircut until the regime resolves.'
      : 'RISK_ON regime: no regime haircut on capital weights.'

  return {
    totalOpenNotionalUsd: Math.round(total * 100) / 100,
    byAssetClass,
    byFamily,
    clusters,
    conflicts,
    drawdownOverlap,
    warnings,
    regimeNote,
  }
}
