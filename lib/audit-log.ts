/**
 * Audit log — append-only record of consequential actions.
 * Written via the Supabase admin client to bypass RLS (users cannot delete/update).
 *
 * Schema (add to supabase/schema.sql):
 *   CREATE TABLE audit_log (
 *     id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     created_at  timestamptz DEFAULT now() NOT NULL,
 *     user_id     uuid REFERENCES auth.users(id),
 *     action      text NOT NULL,
 *     resource    text NOT NULL,          -- e.g. 'order', 'sleeve', 'approval'
 *     resource_id text,
 *     metadata    jsonb DEFAULT '{}',
 *     ip_address  text,
 *     user_agent  text
 *   );
 *   ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
 *   -- Users can read their own log; no one can update/delete
 *   CREATE POLICY "users read own audit" ON audit_log FOR SELECT USING (auth.uid() = user_id);
 */

import { createAdminClient } from './supabase/admin'

export type AuditAction =
  | 'order.created'
  | 'order.cancelled'
  | 'order.filled'
  | 'approval.created'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.expired'
  | 'sleeve.created'
  | 'sleeve.halted'
  | 'sleeve.resumed'
  | 'sleeve.config_changed'
  | 'strategy.created'
  | 'strategy.toggled'
  | 'autopilot.rule_created'
  | 'autopilot.rule_deleted'
  | 'household.member_added'
  | 'household.member_removed'
  | 'advisor.client_added'
  | 'settings.changed'
  | 'auth.signin'
  | 'auth.signout'

export interface AuditEntry {
  user_id: string
  action: AuditAction
  resource: string
  resource_id?: string
  metadata?: Record<string, unknown>
  ip_address?: string
  user_agent?: string
}

/**
 * Append an entry to the audit log.
 * Fire-and-forget — errors are swallowed so they never break the main operation.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('audit_log').insert({
      user_id: entry.user_id,
      action: entry.action,
      resource: entry.resource,
      resource_id: entry.resource_id ?? null,
      metadata: entry.metadata ?? {},
      ip_address: entry.ip_address ?? null,
      user_agent: entry.user_agent ?? null,
    })
  } catch {
    // Never let audit failures propagate to the caller
  }
}

/**
 * Extract IP and user-agent from a Next.js Request for audit logging.
 */
export function extractRequestMeta(req: Request): { ip_address?: string; user_agent?: string } {
  return {
    ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    user_agent: req.headers.get('user-agent') ?? undefined,
  }
}
