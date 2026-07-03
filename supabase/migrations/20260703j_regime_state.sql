-- ─── regime_state: daily allocator regime persistence (R4) ───────────────────
CREATE TABLE IF NOT EXISTS public.regime_state (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of         date NOT NULL UNIQUE,
  regime        text NOT NULL CHECK (regime IN ('risk_on','risk_off','crisis','transition')),
  inputs        jsonb NOT NULL,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.regime_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read regime state" ON public.regime_state;
CREATE POLICY "authenticated read regime state" ON public.regime_state FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
