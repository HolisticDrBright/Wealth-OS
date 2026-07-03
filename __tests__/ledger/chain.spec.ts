/**
 * Hash-chained ledger (R5): tamper detection + batch throughput.
 */

import { describe, it, expect } from 'vitest'
import { chainBatch, verifyChain, GENESIS_HASH, payloadHash, chainHash } from '@/lib/ledger/chain'

function batchOf(n: number, head = GENESIS_HASH) {
  return chainBatch(head, Array.from({ length: n }, (_, i) => ({
    kind: 'decision' as const,
    sourceId: `d-${i}`,
    payload: { id: `d-${i}`, strategy: 'pead', confidence: 0.6 + (i % 10) / 100 },
  })))
}

describe('hash chain', () => {
  it('verifies a clean chain and returns its head', () => {
    const { entries, newHead } = batchOf(50)
    const rows = entries.map((e, i) => ({ seq: i + 1, ...e }))
    const v = verifyChain(rows)
    expect(v.valid).toBe(true)
    expect(v.head).toBe(newHead)
  })

  it('TAMPER DETECTION: mutating one historical row breaks verification at that seq', () => {
    const { entries } = batchOf(50)
    const rows = entries.map((e, i) => ({ seq: i + 1, ...e }))
    rows[20].payload_hash = payloadHash({ id: 'd-20', strategy: 'pead', confidence: 0.99 })
    const v = verifyChain(rows)
    expect(v.valid).toBe(false)
    expect(v.brokenAtSeq).toBe(21)
  })

  it('deleting a middle row also breaks the chain', () => {
    const { entries } = batchOf(20)
    const rows = entries.map((e, i) => ({ seq: i + 1, ...e })).filter(r => r.seq !== 10)
    expect(verifyChain(rows).valid).toBe(false)
  })

  it('appending resumes from the head; chain_hash = sha256(prev || payload)', () => {
    const a = batchOf(10)
    const b = chainBatch(a.newHead, [{ kind: 'outcome', sourceId: 'o-1', payload: { id: 'o-1' } }])
    expect(b.entries[0].prev_hash).toBe(a.newHead)
    expect(b.entries[0].chain_hash).toBe(chainHash(a.newHead, payloadHash({ id: 'o-1' })))
  })

  it('throughput: 10k entries hash in under a second (batch, no per-trade latency)', () => {
    const t0 = Date.now()
    batchOf(10_000)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})
