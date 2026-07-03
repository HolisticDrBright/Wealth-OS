-- ─── Adversarial-input defense (Gap brief Item B) ────────────────────────────
-- ingest_quarantine: flagged external content, kept for review, never fed to agents.
CREATE TABLE IF NOT EXISTS public.ingest_quarantine (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id    text NOT NULL,
  raw_content  text NOT NULL,
  flags        jsonb NOT NULL DEFAULT '[]',
  reason       text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE public.ingest_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages quarantine" ON public.ingest_quarantine;
CREATE POLICY "service role manages quarantine"
  ON public.ingest_quarantine FOR ALL USING (auth.role() = 'service_role');

-- source_scores: sources are admitted on evidence, like smart-money wallets.
CREATE TABLE IF NOT EXISTS public.source_scores (
  source_id        text PRIMARY KEY,
  rolling_hit_rate numeric,
  n_signals        integer NOT NULL DEFAULT 0,
  admitted         boolean NOT NULL DEFAULT false,
  last_recert      timestamptz,
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE public.source_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read source scores" ON public.source_scores;
CREATE POLICY "authenticated read source scores"
  ON public.source_scores FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
