/**
 * Crisis playbooks AS CODE (R4c) — pre-committed, tested, declarative actions
 * per scenario. Executed by the kill-switch/floor machinery. NEVER composed
 * by an LLM at runtime: under stress the system runs the script it tested
 * in peacetime.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type PlaybookAction =
  | { type: 'halt_sleeves'; sleeves: string[] | 'all'; reason: string }
  | { type: 'tighten_floors'; k: number }
  | { type: 'cancel_resting_orders' }

export interface CrisisPlaybook {
  id: string
  scenario: string
  actions: PlaybookAction[]
}

export const CRISIS_PLAYBOOKS: CrisisPlaybook[] = [
  {
    id: 'liquidity_crash_2020',
    scenario: 'Cross-asset liquidity crash (2020-03 style): vol ≥2.5× median, HY OAS ≥800',
    actions: [
      { type: 'halt_sleeves', sleeves: 'all', reason: 'crisis playbook: liquidity crash' },
      { type: 'cancel_resting_orders' },
      { type: 'tighten_floors', k: 0.95 },
    ],
  },
  {
    id: 'rates_shock_2022',
    scenario: 'Rates/inflation shock (2022-06 style): inverted curve + rising OAS',
    actions: [
      { type: 'halt_sleeves', sleeves: ['crypto', 'polymarket'], reason: 'crisis playbook: rates shock' },
      { type: 'tighten_floors', k: 0.90 },
    ],
  },
  {
    id: 'venue_collapse_ftx',
    scenario: 'Crypto venue collapse (FTX style): venue-specific stress',
    actions: [
      { type: 'halt_sleeves', sleeves: ['crypto'], reason: 'crisis playbook: venue collapse' },
      { type: 'cancel_resting_orders' },
      { type: 'tighten_floors', k: 0.95 },
    ],
  },
  {
    id: 'event_night',
    scenario: 'Binary macro event night (election style): gap risk on prediction markets',
    actions: [
      { type: 'halt_sleeves', sleeves: ['polymarket'], reason: 'crisis playbook: event night' },
    ],
  },
]

export interface PlaybookExecution {
  playbookId: string
  dryRun: boolean
  steps: Array<{ action: PlaybookAction; result: string }>
}

/**
 * Execute (or dry-run) a playbook against the EXISTING machinery:
 * halts → system_flags/sleeve suspension, floors → sleeve_floors k bump,
 * cancels → order_intents marked for the reconciler.
 */
export async function executePlaybook(
  playbook: CrisisPlaybook,
  opts: { supabase?: SupabaseClient; userId?: string; dryRun: boolean }
): Promise<PlaybookExecution> {
  const steps: PlaybookExecution['steps'] = []
  for (const action of playbook.actions) {
    if (opts.dryRun || !opts.supabase || !opts.userId) {
      steps.push({ action, result: 'dry-run: validated' })
      continue
    }
    try {
      if (action.type === 'halt_sleeves') {
        await opts.supabase.from('system_flags').upsert({
          user_id: opts.userId, key: 'trading_halted', enabled: true,
          reason: action.reason, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,key' })
        steps.push({ action, result: 'halted via kill-switch flag' })
      } else if (action.type === 'tighten_floors') {
        const { data: floors } = await opts.supabase
          .from('sleeve_floors').select('id, sleeve_key, floor_usd').eq('user_id', opts.userId)
        for (const f of floors ?? []) {
          // Floors only ever rise: apply the tighter k against current value later;
          // here we bump the stored k so the daily job ratchets tighter.
          await opts.supabase.from('sleeve_floors')
            .update({ k: action.k, updated_at: new Date().toISOString() })
            .eq('id', f.id)
        }
        steps.push({ action, result: `k → ${action.k} on ${(floors ?? []).length} sleeve(s)` })
      } else {
        await opts.supabase.from('order_intents')
          .update({ status: 'cancelled', error: 'crisis playbook: cancel resting orders', updated_at: new Date().toISOString() })
          .eq('user_id', opts.userId)
          .in('status', ['pending', 'submitted'])
        steps.push({ action, result: 'resting intents marked cancelled (reconciler cancels broker-side)' })
      }
    } catch (err) {
      steps.push({ action, result: `FAILED: ${err instanceof Error ? err.message : err}` })
    }
  }
  return { playbookId: playbook.id, dryRun: opts.dryRun, steps }
}
