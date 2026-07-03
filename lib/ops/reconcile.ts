/**
 * Position reconciliation (R7a) — the position monitor trusts its own
 * database today; this diffs local state against BROKER TRUTH daily.
 * Any mismatch halts the affected sleeve and alerts: one unreconciled
 * position erases a year of alpha.
 */

export interface PositionSnapshot {
  symbol: string
  assetClass: string
  quantity: number
}

export interface ReconcileMismatch {
  symbol: string
  assetClass: string
  localQty: number
  brokerQty: number
  kind: 'missing_at_broker' | 'unknown_at_broker' | 'quantity_drift'
}

const QTY_TOLERANCE = 1e-6

/** Pure diff: local book vs broker truth. */
export function diffPositions(
  local: PositionSnapshot[],
  broker: PositionSnapshot[]
): ReconcileMismatch[] {
  const key = (p: PositionSnapshot) => `${p.assetClass}|${p.symbol}`
  const brokerMap = new Map(broker.map(p => [key(p), p]))
  const localMap = new Map(local.map(p => [key(p), p]))
  const out: ReconcileMismatch[] = []

  for (const p of local) {
    const b = brokerMap.get(key(p))
    if (!b) {
      out.push({ symbol: p.symbol, assetClass: p.assetClass, localQty: p.quantity, brokerQty: 0, kind: 'missing_at_broker' })
    } else if (Math.abs(b.quantity - p.quantity) > QTY_TOLERANCE * Math.max(1, Math.abs(p.quantity))) {
      out.push({ symbol: p.symbol, assetClass: p.assetClass, localQty: p.quantity, brokerQty: b.quantity, kind: 'quantity_drift' })
    }
  }
  for (const b of broker) {
    if (!localMap.has(key(b))) {
      out.push({ symbol: b.symbol, assetClass: b.assetClass, localQty: 0, brokerQty: b.quantity, kind: 'unknown_at_broker' })
    }
  }
  return out
}

/** Dead-man switch (R7b): workers silent > 3× cadence are flagged. */
export interface HeartbeatRow { worker: string; last_seen: string }

export const WORKER_CADENCE_MS: Record<string, number> = {
  position_monitor: 30_000,
}
const MIN_SILENCE_MS = 5 * 60_000

export function findDeadWorkers(rows: HeartbeatRow[], now = Date.now()): Array<{ worker: string; silentMs: number }> {
  const out: Array<{ worker: string; silentMs: number }> = []
  for (const r of rows) {
    const cadence = WORKER_CADENCE_MS[r.worker] ?? 60_000
    const threshold = Math.max(3 * cadence, MIN_SILENCE_MS)
    const silentMs = now - new Date(r.last_seen).getTime()
    if (silentMs > threshold) out.push({ worker: r.worker, silentMs })
  }
  return out
}
