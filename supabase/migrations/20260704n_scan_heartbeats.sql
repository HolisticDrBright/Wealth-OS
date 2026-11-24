-- Wealth-manager allocation, Phase 6: protect the track record.
--
-- 1. scan_heartbeats — one row per scan run (scheduled scan-all, the daily
--    cron pass, manual runs). Written at START ('running') and updated at the
--    end ('ok' / 'failed'), so a run that dies midway is still visible. Rows
--    with user_id NULL are system-wide scheduled scans and are readable by
--    every signed-in user (they hold no personal data: counts and timestamps).
CREATE TABLE IF NOT EXISTS public.scan_heartbeats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source               text NOT NULL,
  scheduled            boolean NOT NULL DEFAULT true,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  status               text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  users_scanned        integer,
  strategies_run       integer,
  opportunities_found  integer,
  positions_opened     integer,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_heartbeats_status_started_idx
  ON public.scan_heartbeats (scheduled, status, started_at DESC);
CREATE INDEX IF NOT EXISTS scan_heartbeats_user_started_idx
  ON public.scan_heartbeats (user_id, started_at DESC);

ALTER TABLE public.scan_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own and system scan heartbeats" ON public.scan_heartbeats;
CREATE POLICY "read own and system scan heartbeats"
  ON public.scan_heartbeats FOR SELECT
  USING (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()));
DROP POLICY IF EXISTS "users write own scan heartbeats" ON public.scan_heartbeats;
CREATE POLICY "users write own scan heartbeats"
  ON public.scan_heartbeats FOR INSERT
  WITH CHECK (user_id = auth.uid() AND scheduled = false);
DROP POLICY IF EXISTS "users update own scan heartbeats" ON public.scan_heartbeats;
CREATE POLICY "users update own scan heartbeats"
  ON public.scan_heartbeats FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND scheduled = false);
DROP POLICY IF EXISTS "service role manages scan heartbeats" ON public.scan_heartbeats;
CREATE POLICY "service role manages scan heartbeats"
  ON public.scan_heartbeats FOR ALL USING (auth.role() = 'service_role');

-- 2. worker_heartbeats — pre-existing gap: the position monitor upserts here
--    and the ops watchdog's dead-man switch reads it, but no migration ever
--    created it, so the dead-man switch could never fire. Created if missing.
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker     text PRIMARY KEY,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  pid        integer
);
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages worker heartbeats" ON public.worker_heartbeats;
CREATE POLICY "service role manages worker heartbeats"
  ON public.worker_heartbeats FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "signed-in users read worker heartbeats" ON public.worker_heartbeats;
CREATE POLICY "signed-in users read worker heartbeats"
  ON public.worker_heartbeats FOR SELECT USING (auth.uid() IS NOT NULL);
