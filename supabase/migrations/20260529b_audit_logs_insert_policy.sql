-- ─── audit_logs: add INSERT row-level security policy ────────────────────────
--
-- The existing policy only covers SELECT. BasePipelineStrategy.logAudit()
-- inserts rows with user_id set from the authenticated session; without an
-- INSERT policy those inserts are blocked by RLS even when the row's user_id
-- matches auth.uid().
--

DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own audit logs"
  ON public.audit_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
