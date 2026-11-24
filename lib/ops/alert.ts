/**
 * Single ops alerting entry point (R7) — alerts table + console now,
 * pluggable (email/SMS/pager) later. Every ops path alerts through here.
 *
 * Roadmap #4 fix: this used to insert `type: 'ops'` and a `message` column,
 * which the base alerts table (supabase/schema.sql: type CHECK without
 * 'ops', text in `body`) rejects — so ops alerts were never saved. It now
 * writes the base shape (type 'system', `body`, metadata.source = 'ops'),
 * and falls back to the legacy shape only if a database was altered to it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OpsAlert {
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  userId?: string | null
  /** Where the alert should take the person (optional). */
  actionUrl?: string
}

export async function sendOpsAlert(supabase: SupabaseClient, alert: OpsAlert): Promise<void> {
  const line = `[ops:${alert.severity}] ${alert.title} — ${alert.message}`
  if (alert.severity === 'critical') console.error(line)
  else console.warn(line)
  try {
    const { error } = await supabase.from('alerts').insert({
      user_id: alert.userId ?? null,
      type: 'system',
      severity: alert.severity,
      title: alert.title,
      body: alert.message,
      action_url: alert.actionUrl ?? null,
      metadata: { source: 'ops' },
      created_at: new Date().toISOString(),
    })
    if (error) {
      const { error: legacy } = await supabase.from('alerts').insert({
        user_id: alert.userId ?? null, type: 'ops', severity: alert.severity,
        title: alert.title, message: alert.message, created_at: new Date().toISOString(),
      })
      if (legacy) console.error('[ops] alert persistence failed:', error.message, '/', legacy.message)
    }
  } catch (err) {
    console.error('[ops] alert persistence failed:', err)
  }
}
