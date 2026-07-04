/**
 * Hash-chained decision ledger (Remaining brief R5) — every signal, vote,
 * size, fill, and outcome hashed and chained so history is tamper-evident
 * and third-party verifiable: chain_hash = sha256(prev_hash || payload_hash).
 * Batch hashing — zero per-trade latency; a nightly job syncs + verifies and
 * publishes the head hash.
 */

import { createHash } from 'crypto'

export const GENESIS_HASH = '0'.repeat(64)

export function payloadHash(payload: unknown): string {
  // Stable stringify: sort keys so hashing is representation-independent.
  const stable = JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort())
  return createHash('sha256').update(stable).digest('hex')
}

export function chainHash(prevHash: string, payloadHashHex: string): string {
  return createHash('sha256').update(prevHash + payloadHashHex).digest('hex')
}

export interface LedgerEntryInput {
  kind: 'decision' | 'order_intent' | 'outcome' | 'playbook'
  sourceId: string
  payload: unknown
}

export interface ChainedEntry {
  kind: string
  source_id: string
  payload_hash: string
  prev_hash: string
  chain_hash: string
}

/** Chain a batch onto the current head. */
export function chainBatch(headHash: string, entries: LedgerEntryInput[]): { entries: ChainedEntry[]; newHead: string } {
  let prev = headHash
  const out: ChainedEntry[] = []
  for (const e of entries) {
    const ph = payloadHash(e.payload)
    const ch = chainHash(prev, ph)
    out.push({ kind: e.kind, source_id: e.sourceId, payload_hash: ph, prev_hash: prev, chain_hash: ch })
    prev = ch
  }
  return { entries: out, newHead: prev }
}

export interface VerifyResult {
  valid: boolean
  entriesChecked: number
  brokenAtSeq: number | null
  head: string
}

/** Recompute the whole chain; any mutated row breaks it. */
export function verifyChain(
  rows: Array<{ seq: number; payload_hash: string; prev_hash: string; chain_hash: string }>
): VerifyResult {
  let prev = GENESIS_HASH
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.prev_hash !== prev || chainHash(r.prev_hash, r.payload_hash) !== r.chain_hash) {
      return { valid: false, entriesChecked: rows.length, brokenAtSeq: r.seq, head: prev }
    }
    prev = r.chain_hash
  }
  return { valid: true, entriesChecked: rows.length, brokenAtSeq: null, head: prev }
}
