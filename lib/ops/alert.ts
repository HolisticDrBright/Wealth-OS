/**
 * Single ops alerting entry point (R7) — alerts table + console now,
 * pluggable (email/SMS/pager) later. Every ops path alerts through here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OpsAlert {
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  userId?: string | null
}

export async function sendOpsAlert(supabase: SupabaseClient, alert: OpsAlert): Promise<void> {
  const line = `[ops:${alert.severity}] ${alert.title} — ${alert.message}`
  if (alert.severity === 'critical') console.error(line)
  else console.warn(line)
  try {
    await supabase.from('alerts').insert({
      user_id: alert.userId ?? null,
      type: 'ops',
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[ops] alert persistence failed:', err)
  }
}
