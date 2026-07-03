-- ─── system_flags: runtime kill switch state ─────────────────────────────────
--
-- Backs the pre-trade kill switch (lib/risk/kill-switch.ts).  A row with
-- key='trading_halted' and enabled=true stops ALL order submission:
--   user_id = NULL  → platform-wide halt (service role writes)
--   user_id set     → that user's own "Flatten & Halt"
--
-- The kill switch FAILS CLOSED: if this table is missing or unreadable the
-- pre-trade check blocks trading rather than assuming it is safe.

CREATE TABLE IF NOT EXISTS public.system_flags (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global
  key         text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  reason      text,
  updated_at  timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

-- One row per (user, key); one global row per key.
CREATE UNIQUE INDEX IF NOT EXISTS system_flags_user_key_idx
  ON public.system_flags(user_id, key) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS system_flags_global_key_idx
  ON public.system_flags(key) WHERE user_id IS NULL;

ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

-- Everyone can READ the global rows plus their own; only own rows are writable.
DROP POLICY IF EXISTS "users read global and own flags" ON public.system_flags;
CREATE POLICY "users read global and own flags"
  ON public.system_flags FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own flags" ON public.system_flags;
CREATE POLICY "users manage own flags"
  ON public.system_flags FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
