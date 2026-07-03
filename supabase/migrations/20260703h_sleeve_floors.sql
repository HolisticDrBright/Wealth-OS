-- ─── sleeve_floors: persisted TIPP ratchet state (Remaining brief R2) ────────
-- The floor NEVER decreases except an explicit, logged user reset.
CREATE TABLE IF NOT EXISTS public.sleeve_floors (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sleeve_key  text NOT NULL,               -- asset-class sleeve (crypto, polymarket, …)
  floor_usd   numeric NOT NULL DEFAULT 0,
  hwm_usd     numeric NOT NULL DEFAULT 0,
  peak_cushion_usd numeric NOT NULL DEFAULT 0,
  k           numeric,                     -- snapshot of kb tipp_floor_k at last update
  multiplier  numeric,                     -- m used for this sleeve
  reset_log   jsonb NOT NULL DEFAULT '[]', -- explicit user resets, logged
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, sleeve_key)
);

ALTER TABLE public.sleeve_floors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own sleeve floors" ON public.sleeve_floors;
CREATE POLICY "users own sleeve floors"
  ON public.sleeve_floors FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
