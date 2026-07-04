/**
 * Ops hardening (R7): reconciliation diff, dead-man switch, key hygiene
 * (CI grep), and the chaos test — DB failure mid-execute must never
 * double-submit (Phase 0 idempotency).
 */

import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { diffPositions, findDeadWorkers } from '@/lib/ops/reconcile'
import { executeIdempotent } from '@/lib/broker-adapters/order-intents'
import { clientOrderId } from '@/lib/broker-adapters/idempotency'
import type { BrokerAdapter, BrokerResult } from '@/lib/broker-adapters/types'

// ─── R7a reconciliation ──────────────────────────────────────────────────────

describe('diffPositions', () => {
  const local = [
    { symbol: 'AAPL', assetClass: 'stocks', quantity: 10 },
    { symbol: 'BTC', assetClass: 'crypto', quantity: 0.5 },
  ]
  it('clean book → no mismatches', () => {
    expect(diffPositions(local, local)).toHaveLength(0)
  })
  it('flags missing, unknown, and drifted positions', () => {
    const broker = [
      { symbol: 'AAPL', assetClass: 'stocks', quantity: 8 },     // drift
      { symbol: 'ETH', assetClass: 'crypto', quantity: 2 },      // unknown locally
    ]
    const out = diffPositions(local, broker)
    expect(out.map(m => m.kind).sort()).toEqual(['missing_at_broker', 'quantity_drift', 'unknown_at_broker'])
  })
})

// ─── R7b dead-man switch ─────────────────────────────────────────────────────

describe('findDeadWorkers', () => {
  const now = Date.now()
  it('flags workers silent > max(3× cadence, 5min); fresh beats pass', () => {
    const rows = [
      { worker: 'position_monitor', last_seen: new Date(now - 60_000).toISOString() },   // 1m — fine
      { worker: 'position_monitor', last_seen: new Date(now - 6 * 60_000).toISOString() }, // 6m — dead
      { worker: 'unknown_worker', last_seen: new Date(now - 10 * 60_000).toISOString() },  // 10m — dead
    ]
    const dead = findDeadWorkers(rows, now)
    expect(dead).toHaveLength(2)
  })
})

// ─── R7c key hygiene (CI grep) ───────────────────────────────────────────────

describe('key hygiene', () => {
  /**
   * Cross-platform `git grep`: execFileSync with an argument ARRAY — no
   * shell, so no `|| true`, no quoting differences between bash/PowerShell.
   * git grep exits 1 when nothing matches (that's the PASS case) and >1 on
   * real errors, which we rethrow.
   */
  function gitGrepFiles(pattern: string): string {
    try {
      // Long-form pathspec magic — the short ':!' form is parsed differently
      // across git versions/platforms.
      return execFileSync(
        'git',
        // '-e' so patterns beginning with '-' are never parsed as options.
        ['grep', '-lE', '-e', pattern, '--', ':(exclude)__tests__/ops/hardening.spec.ts'],
        { encoding: 'utf8' }
      ).trim()
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string }
      if (e.status === 1) return ''   // no matches — clean
      throw err
    }
  }

  it('no live secrets committed to tracked source', () => {
    // Patterns assembled at runtime so this file never matches itself.
    const patterns = [
      'sk-' + 'ant-api', 'AKIA' + '[0-9A-Z]{16}', '-----BEGIN' + ' (RSA|EC|OPENSSH) PRIVATE KEY-----',
      'sbp_' + '[0-9a-f]{40}',
    ]
    for (const p of patterns) {
      const out = gitGrepFiles(p)
      expect(out, `secret pattern ${p} found in: ${out}`).toBe('')
    }
  })
})

// ─── R7d chaos: DB dies mid-execute → no duplicate orders ────────────────────

describe('chaos: DB failure mid-execute', () => {
  function chaosSupabase(failWrites: boolean, existingIntent: Record<string, unknown> | null) {
    return {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: existingIntent ? [existingIntent] : [], error: null }),
        }
        for (const m of ['select', 'eq', 'in']) builder[m] = () => builder
        builder.upsert = () => {
          if (failWrites) return Promise.reject(new Error('connection reset by peer'))
          return Promise.resolve({ error: null })
        }
        builder.update = () => builder
        return builder
      }),
    } as never
  }

  function adapter(calls: string[]): BrokerAdapter {
    return {
      config: { id: 'coinbase', displayName: 'CB', assetClasses: ['crypto'], requiredEnvVars: [] },
      execute: async (p: { client_order_id?: string }): Promise<BrokerResult> => {
        calls.push(p.client_order_id ?? 'none')
        return { status: 'open', broker_order_id: 'ord-1' }
      },
    } as unknown as BrokerAdapter
  }

  it('intent writes failing does NOT double-submit — same deterministic id throughout', async () => {
    const calls: string[] = []
    const params = { symbol: 'BTC', asset_class: 'crypto', side: 'buy' as const, notional_usd: 100 }

    // First attempt: DB writes explode mid-flight — order still goes out ONCE.
    const r1 = await executeIdempotent(adapter(calls), params, {
      supabase: chaosSupabase(true, null), userId: 'u1', opportunityId: 'opp-chaos',
      retry: { sleep: () => Promise.resolve() },
    })
    expect(r1.status).toBe('open')
    expect(calls).toHaveLength(1)

    // Recovery retry: DB is back and the intent row now exists → deduped,
    // ZERO additional broker calls.
    const r2 = await executeIdempotent(adapter(calls), params, {
      supabase: chaosSupabase(false, { status: 'submitted', broker_order_id: 'ord-1', broker: 'coinbase' }),
      userId: 'u1', opportunityId: 'opp-chaos',
      retry: { sleep: () => Promise.resolve() },
    })
    expect(r2.status).toBe('submitted')
    expect(calls).toHaveLength(1)

    // And if the broker were called again anyway, the id would be identical.
    expect(calls[0]).toBe(clientOrderId('opp-chaos', 'entry'))
  })
})
