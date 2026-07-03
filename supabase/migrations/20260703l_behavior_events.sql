-- ─── user_behavior_events: the personalization layer (R8) ────────────────────
-- Logs overrides, cancelled sweeps, panic actions, ignored recommendations —
-- with the honest counterfactual outcome. Per-user rows, RLS, deletable.
CREATE TABLE IF NOT EXISTS public.user_behavior_events (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event              text NOT NULL CHECK (event IN
    ('override_sweep','cancel_derisk','panic_liquidation','ignore_recommendation','manual_trade_override')),
  context            jsonb NOT NULL DEFAULT '{}',
  /** realized − if-followed counterfactual: negative = the override COST money. */
  outcome_usd_delta  numeric,
  ts                 timestamptz DEFAULT now()
);

ALTER TABLE public.user_behavior_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own behavior events" ON public.user_behavior_events;
CREATE POLICY "users own behavior events"
  ON public.user_behavior_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_behavior_events_user_ts_idx
  ON public.user_behavior_events(user_id, ts DESC);
