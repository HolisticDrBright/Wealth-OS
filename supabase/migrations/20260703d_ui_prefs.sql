-- ─── user_ui_prefs: per-user UI preferences (advisor/terminal density) ───────
CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  density     text NOT NULL DEFAULT 'advisor' CHECK (density IN ('advisor', 'terminal')),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own ui prefs" ON public.user_ui_prefs;
CREATE POLICY "users own ui prefs"
  ON public.user_ui_prefs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
