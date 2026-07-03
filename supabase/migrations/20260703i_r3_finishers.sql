-- ─── R3 finishers: measured cost overrides + provider options ────────────────

-- Measured venue costs from TCA — overrides the static model when present.
CREATE TABLE IF NOT EXISTS public.cost_overrides (
  asset_class   text PRIMARY KEY,
  one_way_bps   numeric NOT NULL,
  fills_measured integer NOT NULL DEFAULT 0,
  measured_at   timestamptz DEFAULT now()
);
ALTER TABLE public.cost_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read cost overrides" ON public.cost_overrides;
CREATE POLICY "authenticated read cost overrides" ON public.cost_overrides FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Provider options for advisory cards — refreshed quarterly, never a hardcoded "best".
CREATE TABLE IF NOT EXISTS public.provider_options (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category      text NOT NULL,            -- 'hysa' | 'tbill' | 'business_checking' | 'business_card' | 'bookkeeping'
  name          text NOT NULL,
  url           text,
  note          text,
  refreshed_at  timestamptz DEFAULT now(),
  UNIQUE (category, name)
);
ALTER TABLE public.provider_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read provider options" ON public.provider_options;
CREATE POLICY "authenticated read provider options" ON public.provider_options FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
